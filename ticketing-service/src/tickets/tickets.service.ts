import {
    Inject,
    Injectable,
    NotFoundException,
    BadRequestException,
    ServiceUnavailableException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { Ticket } from './entities/ticket.entity';
import { Order } from './entities/order.entity';
import { TicketStatus, OrderStatus } from '../shared/enum';
import { SeedService } from '../seed/seed.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ReservationsService } from '../reservations/reservations.service';
import { ReservationEventsService } from '../reservations/reservation-events.service';
import { TicketViewService } from '../reservations/ticket-view.service';
import {
    OrderLike,
    OrderRecord,
    RESERVATIONS_KEY,
    orderKey,
    ticketDataKey,
    ticketOrdersKey,
    ticketStockKey,
} from '../reservations/reservation.types';

@Injectable()
export class TicketsService {
    private readonly logger = new Logger(TicketsService.name);
    private readonly reservationTtlMs =
        parseInt(process.env.RESERVATION_TTL_SECONDS || '60', 10) * 1000;

    // The worker owns this hold: once the customer is on Stripe, the worker
    // expires the Checkout session after CHECKOUT_HOLD_SECONDS (default 60s,
    // matching the pre-checkout hold).
    private readonly checkoutHoldMs =
        parseInt(process.env.CHECKOUT_HOLD_SECONDS || '60', 10) * 1000;

    // A payment that lands right at the expiry instant must still confirm, so
    // the record's expiresAt (what confirmPayment checks) lags the worker's
    // timer by this short grace window.
    private static readonly CHECKOUT_HOLD_GRACE_MS = 60_000;

    constructor(
        @InjectRepository(Ticket)
        private readonly ticketRepository: Repository<Ticket>,
        @InjectRepository(Order)
        private readonly orderRepository: Repository<Order>,
        @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
        private readonly seedService: SeedService,
        private readonly reservationsService: ReservationsService,
        private readonly reservationEvents: ReservationEventsService,
        private readonly ticketViewService: TicketViewService,
    ) {}

    async seed(force = false) {
        await this.seedService.seed(force);
        return this.findAll();
    }

    private toOrderSummary(order: OrderLike) {
        return {
            id: order.id,
            ticketId: order.ticketId,
            status: order.status,
            quantity: order.quantity,
            totalPrice: Number(order.totalPrice),
            expiresAt: order.expiresAt ? new Date(order.expiresAt) : null,
        };
    }

    /**
     * Tells the reservation worker it can drop its timer for this order.
     * Purely an optimisation - the order is already out of the expiry ZSET
     * by this point, and the worker re-checks PENDING status before
     * releasing anything, so a lost message costs at most one no-op timer.
     */
    private notifyReservationCleared(orderId: string) {
        void this.reservationEvents.publishReservationCleared({ orderId });
    }

    async getOrder(orderId: string) {
        const found = await this.reservationsService.findOrderRecord(orderId);
        if (!found) {
            throw new NotFoundException(`Order with ID ${orderId} not found`);
        }
        return this.toOrderSummary(found.record);
    }

    async confirmPayment(orderId: string) {
        const found = await this.reservationsService.findOrderRecord(orderId);
        if (!found) {
            throw new NotFoundException(`Order with ID ${orderId} not found`);
        }
        const { record, inRedis } = found;

        const expiresAtMs = record.expiresAt
            ? new Date(record.expiresAt).getTime()
            : null;

        if (
            record.status === OrderStatus.PENDING &&
            expiresAtMs &&
            expiresAtMs <= Date.now()
        ) {
            await this.reservationsService.releaseReservation(record, inRedis);
            this.notifyReservationCleared(orderId);
            throw new BadRequestException(
                'Reservation expired before payment was confirmed',
            );
        }

        if (record.status !== OrderStatus.PENDING) {
            throw new BadRequestException(
                `Order is ${record.status.toLowerCase()} and can no longer be confirmed`,
            );
        }

        let confirmed: OrderLike;
        if (inRedis) {
            const updated: OrderRecord = {
                ...(record as OrderRecord),
                status: OrderStatus.PAID,
            };
            await this.redisClient.set(
                orderKey(orderId),
                JSON.stringify(updated),
            );
            confirmed = updated;
        } else {
            const updateResult = await this.orderRepository
                .createQueryBuilder()
                .update(Order)
                .set({ status: OrderStatus.PAID })
                .where('id = :id AND status = :pending', {
                    id: orderId,
                    pending: OrderStatus.PENDING,
                })
                .execute();

            if (!updateResult.affected) {
                throw new BadRequestException(
                    'Order was already confirmed, cancelled, or expired',
                );
            }
            confirmed = (await this.orderRepository.findOneBy({
                id: orderId,
            }))!;
        }

        await this.reservationsService.unreserve(orderId);
        this.notifyReservationCleared(orderId);
        const ticket = await this.ticketViewService.findOne(record.ticketId);
        return { order: this.toOrderSummary(confirmed), ticket };
    }

    async cancelOrder(orderId: string) {
        const found = await this.reservationsService.findOrderRecord(orderId);
        if (!found) {
            throw new NotFoundException(`Order with ID ${orderId} not found`);
        }
        if (found.record.status !== OrderStatus.PENDING) {
            throw new BadRequestException(
                `Order is ${found.record.status.toLowerCase()} and cannot be cancelled`,
            );
        }

        const ticket = await this.reservationsService.releaseReservation(
            found.record,
            found.inRedis,
        );
        this.notifyReservationCleared(orderId);
        const after = await this.reservationsService.findOrderRecord(orderId);
        return {
            order: this.toOrderSummary(after ? after.record : found.record),
            ticket,
        };
    }

    /**
     * Hands a reservation to Stripe once a Checkout session exists, and
     * re-arms the expiry worker for the shorter checkout hold
     * (CHECKOUT_HOLD_SECONDS). The worker now stays in charge: we record the
     * session id, re-score the ZSET to the checkout hold, and publish
     * `reservations:created` so the worker re-arms its timer. When it fires it
     * expires the Stripe session (cutting the customer off) before releasing
     * the stock. Stripe's 30-min expires_at remains only as a dead-man backstop.
     */
    async startCheckoutHold(orderId: string, sessionId: string) {
        const found = await this.reservationsService.findOrderRecord(orderId);
        if (!found) return;

        const holdUntilMs = Date.now() + this.checkoutHoldMs;
        const expiresAt = new Date(
            holdUntilMs + TicketsService.CHECKOUT_HOLD_GRACE_MS,
        );

        if (found.inRedis) {
            const record = found.record as OrderRecord;
            record.checkoutSessionId = sessionId;
            record.expiresAt = expiresAt.toISOString();
            await this.redisClient.set(
                orderKey(orderId),
                JSON.stringify(record),
            );
        } else {
            // Ticket was paused mid-checkout, so the order now lives in SQL.
            await this.orderRepository.update(
                { id: orderId },
                { checkoutSessionId: sessionId, expiresAt },
            );
        }

        // Re-score the ZSET and re-arm the worker's in-memory timer for the
        // shorter checkout hold (replacing the 60s score from buyTicket).
        await this.redisClient.zadd(RESERVATIONS_KEY, holdUntilMs, orderId);
        await this.reservationEvents.publishReservationCreated({
            orderId,
            ticketId: found.record.ticketId,
            expiresAtMs: holdUntilMs,
        });
    }

    async create(createTicketDto: CreateTicketDto) {
        const ticket = this.ticketRepository.create(createTicketDto);
        const saved = await this.ticketRepository.save(ticket);
        const populated = await this.ticketViewService.populate(saved);

        if (saved.status === TicketStatus.AVAILABLE) {
            await this.enableSaleInRedis(saved.id, populated);
        }

        return populated;
    }

    async findAll() {
        const tickets = await this.ticketRepository.find();
        return Promise.all(
            tickets.map(async (t) => {
                // If present in Redis, return live Redis inventory status
                try {
                    const redisStock = await this.redisClient.get(
                        ticketStockKey(t.id),
                    );
                    const redisData = await this.redisClient.get(
                        ticketDataKey(t.id),
                    );
                    if (redisStock !== null && redisData !== null) {
                        const parsed = JSON.parse(redisData);
                        parsed.quantity = parseInt(redisStock, 10);
                        return parsed;
                    }
                } catch {
                    // Fallback to SQL
                }
                return this.ticketViewService.populate(t);
            }),
        );
    }

    findOne(id: string) {
        return this.ticketViewService.findOne(id);
    }

    /**
     * Admin updates ticket status or details.
     * Moving event data to Redis on AVAILABLE, and syncing back to SQL on PAUSED.
     */
    async update(id: string, updateTicketDto: UpdateTicketDto) {
        const ticket = await this.ticketRepository.findOneBy({ id });
        if (!ticket) {
            throw new NotFoundException(`Ticket with ID ${id} not found`);
        }

        const targetStatus = updateTicketDto.status || ticket.status;

        // If pausing or turning off sales, sync Redis data (remaining stock
        // & any buffered orders) back to SQL DB
        if (
            targetStatus !== TicketStatus.AVAILABLE &&
            ticket.status === TicketStatus.AVAILABLE
        ) {
            return this.pauseSaleAndSyncToDB(id, targetStatus);
        }

        Object.assign(ticket, updateTicketDto);
        const saved = await this.ticketRepository.save(ticket);
        const populated = await this.ticketViewService.populate(saved);

        // If sales enabled, push/move event data & stock to Redis instance
        if (saved.status === TicketStatus.AVAILABLE) {
            await this.enableSaleInRedis(id, populated);
        }

        return populated;
    }

    /**
     * Pushes event data & stock into Redis for high-concurrency ticket buying.
     */
    private async enableSaleInRedis(id: string, populatedTicket: any) {
        try {
            this.logger.log(
                `[Redis Cache] Moving Ticket ${id} to Redis Instance (Stock: ${populatedTicket.quantity})`,
            );
            await this.redisClient.set(
                ticketStockKey(id),
                populatedTicket.quantity.toString(),
            );
            await this.redisClient.set(
                ticketDataKey(id),
                JSON.stringify(populatedTicket),
            );
            // Defensive reset in case a prior on-sale period left orders behind
            await this.redisClient.del(ticketOrdersKey(id));
        } catch (err) {
            this.logger.error(
                `Failed to move ticket ${id} to Redis: ${(err as Error).message}`,
            );
        }
    }

    /**
     * Reserves stock for a purchase attempt. While a ticket is on sale, this
     * never touches SQL: stock is decremented atomically in Redis (via Lua,
     * to stay race-free under concurrency) and the order itself is buffered
     * entirely in Redis as PENDING with an expiry. Only once the ticket is
     * paused/sold-out does pauseSaleAndSyncToDB() persist buffered orders to
     * SQL. If payment isn't confirmed via confirmPayment() before expiresAt,
     * the reservation worker releases the stock and cancels the order,
     * wherever it currently lives.
     */
    async buyTicket(id: string, qty: number) {
        const expiresAt = new Date(Date.now() + this.reservationTtlMs);

        try {
            const stockKey = ticketStockKey(id);
            const redisStock = await this.redisClient.get(stockKey);

            if (redisStock !== null) {
                const redisDataStr = await this.redisClient.get(
                    ticketDataKey(id),
                );
                const ticketData = redisDataStr ? JSON.parse(redisDataStr) : {};

                const orderRecord: OrderRecord = {
                    id: randomUUID(),
                    ticketId: id,
                    eventId: ticketData.eventId ?? null,
                    quantity: qty,
                    totalPrice: Number(ticketData.price || 0) * qty,
                    status: OrderStatus.PENDING,
                    createdAt: new Date().toISOString(),
                    expiresAt: expiresAt.toISOString(),
                };

                // Atomic Lua script: the stock check+decrement AND the order
                // bookkeeping (order record, ticket's order set, reservation
                // timer) happen as a single Redis transaction. Either all of
                // it lands or none of it does - there's no window where
                // stock is decremented but the order that accounts for it
                // doesn't exist yet.
                const luaScript = `
                    local stockKey = KEYS[1]
                    local ordersSetKey = KEYS[2]
                    local reservationsKey = KEYS[3]
                    local orderKey = KEYS[4]

                    local qty = tonumber(ARGV[1])
                    local orderId = ARGV[2]
                    local orderJson = ARGV[3]
                    local expiresAtMs = ARGV[4]

                    local currentStock = tonumber(redis.call('get', stockKey) or '-1')

                    if currentStock == -1 then
                        return { -1, "NOT_IN_REDIS" }
                    end
                    if currentStock < qty then
                        return { -2, "INSUFFICIENT_STOCK", currentStock }
                    end

                    local newStock = redis.call('decrby', stockKey, qty)

                    redis.call('set', orderKey, orderJson)
                    redis.call('sadd', ordersSetKey, orderId)
                    redis.call('zadd', reservationsKey, expiresAtMs, orderId)

                    return { 0, "SUCCESS", newStock }
                `;

                const result: any = await this.redisClient.eval(
                    luaScript,
                    4,
                    stockKey,
                    ticketOrdersKey(id),
                    RESERVATIONS_KEY,
                    orderKey(orderRecord.id),
                    qty,
                    orderRecord.id,
                    JSON.stringify(orderRecord),
                    expiresAt.getTime(),
                );
                const code = result[0];

                if (code === -2) {
                    throw new BadRequestException(
                        'Insufficient ticket inventory in Redis',
                    );
                }

                if (code === 0) {
                    const newStock = result[2];
                    this.logger.log(
                        `[Redis Flash Sale] Atomic Decr for Ticket ${id}: Remaining = ${newStock}`,
                    );

                    // Hand the hold to the reservation worker immediately so
                    // it arms a timer for the exact expiry instead of waiting
                    // for its next reconciliation pass.
                    await this.reservationEvents.publishReservationCreated({
                        orderId: orderRecord.id,
                        ticketId: id,
                        expiresAtMs: expiresAt.getTime(),
                    });

                    ticketData.quantity = newStock;

                    if (newStock === 0) {
                        ticketData.status = TicketStatus.SOLD_OUT;
                        const populated = await this.pauseSaleAndSyncToDB(
                            id,
                            TicketStatus.SOLD_OUT,
                        );
                        return {
                            ...populated,
                            order: this.toOrderSummary(orderRecord),
                        };
                    }

                    await this.redisClient.set(
                        ticketDataKey(id),
                        JSON.stringify(ticketData),
                    );
                    return {
                        ...ticketData,
                        order: this.toOrderSummary(orderRecord),
                    };
                }
            }
        } catch (err) {
            if (err instanceof BadRequestException) throw err;
            this.logger.warn(
                `Redis buyTicket fallback to SQL: ${(err as Error).message}`,
            );
        }

        // Ticket isn't currently buffered in Redis (or Redis is unreachable) -
        // don't silently fall back to a stale SQL purchase path, just ask the
        // client to reload so it picks up current inventory state.
        throw new ServiceUnavailableException(
            'Ticket sales data is temporarily unavailable. Please reload and try again.',
        );
    }

    /**
     * Sync point: flushes the live Redis stock count and every order
     * buffered during the on-sale period into SQL. This is the only place
     * Redis-buffered orders are ever written to Postgres. Reservation timers
     * for orders still PENDING at sync time are left in place - the worker
     * will find their SQL row via findOrderRecord() once Redis no longer has
     * them buffered.
     */
    private async pauseSaleAndSyncToDB(id: string, newStatus: TicketStatus) {
        this.logger.log(
            `[Redis Write-back] Syncing Redis data for Ticket ${id} back to SQL Database...`,
        );
        let finalStock = 0;
        let bufferedOrderIds: string[] = [];

        try {
            const redisStockStr = await this.redisClient.get(
                ticketStockKey(id),
            );
            if (redisStockStr !== null) {
                finalStock = Math.max(0, parseInt(redisStockStr, 10));
            }
            bufferedOrderIds = await this.redisClient.smembers(
                ticketOrdersKey(id),
            );
        } catch (err) {
            this.logger.error(
                `Error reading Redis keys during sync: ${(err as Error).message}`,
            );
        }

        const bufferedOrders: OrderRecord[] = [];
        for (const bufferedOrderId of bufferedOrderIds) {
            try {
                const raw = await this.redisClient.get(
                    orderKey(bufferedOrderId),
                );
                if (raw) {
                    bufferedOrders.push(JSON.parse(raw) as OrderRecord);
                }
            } catch {
                // Ignore malformed entry
            }
        }

        const updatedTicket = await this.ticketRepository.manager.transaction(
            async (manager) => {
                const tkt = await manager.findOneBy(Ticket, { id });
                if (tkt) {
                    tkt.quantity = finalStock;
                    tkt.status = newStatus;
                    await manager.save(Ticket, tkt);
                }

                if (bufferedOrders.length > 0) {
                    const orderEntities = bufferedOrders.map((bo) =>
                        manager.create(Order, {
                            id: bo.id,
                            ticketId: bo.ticketId,
                            eventId: bo.eventId ?? (tkt ? tkt.eventId : null),
                            quantity: bo.quantity,
                            totalPrice: bo.totalPrice,
                            status: bo.status,
                            createdAt: new Date(bo.createdAt),
                            expiresAt: bo.expiresAt
                                ? new Date(bo.expiresAt)
                                : null,
                            checkoutSessionId: bo.checkoutSessionId ?? null,
                        }),
                    );
                    await manager.save(Order, orderEntities);
                    this.logger.log(
                        `[SQL Write-back] Persisted ${orderEntities.length} buffered order(s) from Redis into SQL DB`,
                    );
                }

                return tkt;
            },
        );

        // Clean up Redis keys
        try {
            await this.redisClient.del(ticketStockKey(id));
            await this.redisClient.del(ticketDataKey(id));
            if (bufferedOrderIds.length > 0) {
                await this.redisClient.del(
                    ...bufferedOrderIds.map((oid) => orderKey(oid)),
                );
            }
            await this.redisClient.del(ticketOrdersKey(id));
        } catch {
            // Ignore cleanup error
        }

        const resultTicket =
            updatedTicket || (await this.ticketRepository.findOneBy({ id }));
        return this.ticketViewService.populate(resultTicket!);
    }

    async remove(id: string) {
        const ticket = await this.ticketRepository.findOneBy({ id });
        if (!ticket) {
            throw new NotFoundException(`Ticket with ID ${id} not found`);
        }
        try {
            const bufferedOrderIds = await this.redisClient.smembers(
                ticketOrdersKey(id),
            );
            if (bufferedOrderIds.length > 0) {
                await this.redisClient.del(
                    ...bufferedOrderIds.map((oid) => orderKey(oid)),
                );
            }
            await this.redisClient.del(ticketStockKey(id));
            await this.redisClient.del(ticketDataKey(id));
            await this.redisClient.del(ticketOrdersKey(id));
        } catch {
            // Ignore cleanup
        }
        return this.ticketRepository.remove(ticket);
    }
}
