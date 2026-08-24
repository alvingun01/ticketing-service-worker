import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Order } from '../tickets/entities/order.entity';
import { TicketStatus, OrderStatus } from '../shared/enum';
import { TicketViewService } from './ticket-view.service';
import {
    OrderLike,
    OrderRecord,
    RESERVATIONS_KEY,
    isValidUuid,
    orderKey,
    ticketDataKey,
    ticketStockKey,
} from './reservation.types';

/**
 * The stock-release half of the reservation lifecycle, shared verbatim by
 * both processes: the API calls it for user-initiated cancel/confirm, and
 * the reservation worker calls it when a hold times out. Keeping it in one
 * place is what stops the two processes from drifting apart on the rules
 * for crediting stock back.
 *
 * Deliberately owns no timers - the worker owns those.
 */
@Injectable()
export class ReservationsService {
    private readonly logger = new Logger(ReservationsService.name);

    constructor(
        @InjectRepository(Ticket)
        private readonly ticketRepository: Repository<Ticket>,
        @InjectRepository(Order)
        private readonly orderRepository: Repository<Order>,
        @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
        private readonly ticketViewService: TicketViewService,
    ) {}

    /**
     * Looks up an order wherever it currently lives: Redis while the ticket
     * is on sale (no SQL writes happen during that period), or SQL once the
     * ticket has been paused/sold-out and its buffered orders synced.
     */
    async findOrderRecord(
        orderId: string,
    ): Promise<{ record: OrderLike; inRedis: boolean } | null> {
        const raw = await this.redisClient.get(orderKey(orderId));
        if (raw) {
            return { record: JSON.parse(raw) as OrderRecord, inRedis: true };
        }

        if (!isValidUuid(orderId)) {
            return null;
        }

        const order = await this.orderRepository.findOneBy({ id: orderId });
        return order ? { record: order, inRedis: false } : null;
    }

    /**
     * Drops the reservation from the expiry ZSET so it's no longer a
     * candidate for release. Safe to call from either process and safe to
     * call twice - zrem on a missing member is a no-op.
     */
    async unreserve(orderId: string): Promise<void> {
        await this.redisClient.zrem(RESERVATIONS_KEY, orderId);
    }

    /**
     * Releases a pending reservation's held stock back to inventory and
     * marks the order CANCELLED - in Redis if the order still lives there,
     * otherwise via a conditional SQL UPDATE (status must still be PENDING)
     * so a concurrent confirmPayment/cancel/expiry can't double-release the
     * same stock. That status guard is also what makes it safe for the
     * worker and the API to race on the same order.
     */
    async releaseReservation(order: OrderLike, inRedis: boolean) {
        const { id: orderId, ticketId, quantity } = order;
        let alreadyFinal = false;

        if (inRedis) {
            const record = order as OrderRecord;
            if (record.status !== OrderStatus.PENDING) {
                alreadyFinal = true;
            } else {
                record.status = OrderStatus.CANCELLED;
                await this.redisClient.set(
                    orderKey(orderId),
                    JSON.stringify(record),
                );
            }
        } else {
            const updateResult = await this.orderRepository
                .createQueryBuilder()
                .update(Order)
                .set({ status: OrderStatus.CANCELLED })
                .where('id = :id AND status = :pending', {
                    id: orderId,
                    pending: OrderStatus.PENDING,
                })
                .execute();
            alreadyFinal = !updateResult.affected;
        }

        await this.unreserve(orderId);

        if (alreadyFinal) {
            return this.ticketViewService.findOne(ticketId);
        }

        const stockKey = ticketStockKey(ticketId);
        const dataKey = ticketDataKey(ticketId);
        const redisTracked = (await this.redisClient.exists(stockKey)) === 1;

        if (redisTracked) {
            const newStock = await this.redisClient.incrby(stockKey, quantity);
            try {
                const raw = await this.redisClient.get(dataKey);
                if (raw) {
                    const data = JSON.parse(raw);
                    data.quantity = newStock;
                    if (newStock > 0 && data.status === TicketStatus.SOLD_OUT) {
                        data.status = TicketStatus.AVAILABLE;
                    }
                    await this.redisClient.set(dataKey, JSON.stringify(data));
                }
            } catch (err) {
                this.logger.warn(
                    `Failed to refresh cached ticket data for ${ticketId}: ${(err as Error).message}`,
                );
            }
        } else {
            await this.ticketRepository.manager.transaction(async (manager) => {
                const tkt = await manager.findOneBy(Ticket, {
                    id: ticketId,
                });
                if (tkt) {
                    tkt.quantity += quantity;
                    if (
                        tkt.status === TicketStatus.SOLD_OUT &&
                        tkt.quantity > 0
                    ) {
                        tkt.status = TicketStatus.AVAILABLE;
                    }
                    await manager.save(Ticket, tkt);
                }
            });
        }

        this.logger.log(
            `[Reservation Released] Order ${orderId} released ${quantity} unit(s) of Ticket ${ticketId} back to inventory`,
        );

        return this.ticketViewService.findOne(ticketId);
    }
}
