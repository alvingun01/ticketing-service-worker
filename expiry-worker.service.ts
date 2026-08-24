import {
    Inject,
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import Stripe from 'stripe';
import { REDIS_CLIENT } from '../redis/redis.module';
import { STRIPE_CLIENT } from '../stripe/stripe.module';
import { OrderStatus } from '../shared/enum';
import { ReservationsService } from '../reservations/reservations.service';
import { ReservationEventsService } from '../reservations/reservation-events.service';
import {
    OrderRecord,
    RESERVATIONS_KEY,
} from '../reservations/reservation.types';

const RECONCILIATION_INTERVAL_MS = 60_000;

/**
 * Owns reservation expiry for the whole system - the only place timers are
 * armed. Runs in its own process so that this work never shares a Redis
 * connection with the API's flash-sale buy path.
 *
 * One in-memory timer per pending reservation, firing at exactly its expiry
 * rather than polling, with the Redis ZSET as the durable backing store:
 *   - a `reservations:created` message from the API arms a timer instantly
 *   - startup rehydration re-arms everything still in the ZSET
 *   - a slow reconciliation pass re-arms anything that slipped through
 */
@Injectable()
export class ExpiryWorkerService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ExpiryWorkerService.name);
    private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
    private reconciliationInterval!: NodeJS.Timeout;

    constructor(
        private readonly reservationsService: ReservationsService,
        private readonly reservationEvents: ReservationEventsService,
        @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
        @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    ) {}

    onModuleInit() {
        this.reservationEvents.onReservationCreated(
            ({ orderId, expiresAtMs }) => {
                this.scheduleExpiryTimer(orderId, expiresAtMs);
            },
        );
        this.reservationEvents.onReservationCleared(({ orderId }) => {
            // The API already removed it from the ZSET; just drop our timer.
            this.clearLocalTimer(orderId);
        });

        void this.rehydrateExpiryTimers();
        this.reconciliationInterval = setInterval(() => {
            void this.reconcileExpiryTimers();
        }, RECONCILIATION_INTERVAL_MS);

        this.logger.log(
            'Reservation expiry worker ready - listening for reservations',
        );
    }

    onModuleDestroy() {
        clearInterval(this.reconciliationInterval);
        for (const timer of this.expiryTimers.values()) {
            clearTimeout(timer);
        }
        this.expiryTimers.clear();
    }

    private clearLocalTimer(orderId: string) {
        const timer = this.expiryTimers.get(orderId);
        if (timer) {
            clearTimeout(timer);
            this.expiryTimers.delete(orderId);
        }
    }

    /**
     * Arms (or re-arms) a per-reservation timer that fires exactly at
     * expiresAtMs, rather than relying on a loop that re-scans Redis.
     */
    private scheduleExpiryTimer(orderId: string, expiresAtMs: number) {
        this.clearLocalTimer(orderId);

        const delay = Math.max(0, expiresAtMs - Date.now());
        const timer = setTimeout(() => {
            this.executeExpiry(orderId).catch((err) => {
                this.logger.error(
                    `Failed to execute expiry for order ${orderId}: ${(err as Error).message}`,
                );
            });
        }, delay);
        this.expiryTimers.set(orderId, timer);
    }

    private async executeExpiry(orderId: string) {
        this.expiryTimers.delete(orderId);

        const found = await this.reservationsService.findOrderRecord(orderId);
        if (!found || found.record.status !== OrderStatus.PENDING) {
            // Already paid/cancelled elsewhere - just tidy up the ZSET.
            await this.reservationsService.unreserve(orderId);
            return;
        }

        // A Checkout session exists: cut the customer off first (Stripe can't
        // be shortened below 30 min via expires_at), then release the stock.
        const sessionId = (found.record as OrderRecord).checkoutSessionId;
        if (sessionId) {
            const safeToRelease = await this.expireCheckoutSession(sessionId);
            if (!safeToRelease) {
                // The customer paid at the exact expiry instant: the session is
                // complete, so the checkout.session.completed webhook confirms
                // the order. Don't release the hold underneath it.
                this.logger.log(
                    `[Reservation Expired] Order ${orderId}: Checkout ${sessionId} already complete - deferring to webhook`,
                );
                return;
            }
        }

        const ticket = await this.reservationsService.releaseReservation(
            found.record,
            found.inRedis,
        );
        this.logger.log(
            `[Reservation Expired] Order ${orderId} timed out - stock released`,
        );

        await this.reservationEvents.publishReservationExpired({
            orderId,
            ticketId: found.record.ticketId,
            ticket,
        });
    }

    /**
     * Expires a Stripe Checkout session so the customer can't complete
     * payment. Returns true when it is safe to release the hold; false when
     * the session is already `complete` (the customer paid, and the
     * checkout.session.completed webhook owns the outcome).
     */
    private async expireCheckoutSession(sessionId: string): Promise<boolean> {
        let status: Stripe.Checkout.Session['status'];
        try {
            const session =
                await this.stripe.checkout.sessions.expire(sessionId);
            status = session.status; // 'expired'
        } catch (err) {
            // expire() can fail because the session is already complete (paid)
            // or already expired. Retrieve to decide rather than guess.
            this.logger.warn(
                `[Reservation Expired] expire(${sessionId}) failed: ${(err as Error).message} - retrieving status`,
            );
            const session =
                await this.stripe.checkout.sessions.retrieve(sessionId);
            status = session.status;
        }
        return status !== 'complete';
    }

    /**
     * Startup recovery: schedules a timer for every reservation still
     * pending in Redis, so restarts don't lose in-flight expirations.
     * Already-past-due entries fire almost immediately.
     */
    private async rehydrateExpiryTimers() {
        try {
            const entries = await this.redisClient.zrange(
                RESERVATIONS_KEY,
                0,
                -1,
                'WITHSCORES',
            );
            for (let i = 0; i < entries.length; i += 2) {
                this.scheduleExpiryTimer(entries[i], Number(entries[i + 1]));
            }
            if (entries.length > 0) {
                this.logger.log(
                    `Rehydrated ${entries.length / 2} pending reservation(s) from Redis`,
                );
            }
        } catch (err) {
            this.logger.error(
                `Failed to rehydrate expiry timers: ${(err as Error).message}`,
            );
        }
    }

    /**
     * Low-frequency safety net: catches reservations with no in-memory
     * timer here (e.g. a `reservations:created` message published while
     * this worker was down). Never releases anything itself - it only
     * (re)schedules, so it stays cheap.
     */
    private async reconcileExpiryTimers() {
        try {
            const entries = await this.redisClient.zrange(
                RESERVATIONS_KEY,
                0,
                -1,
                'WITHSCORES',
            );
            for (let i = 0; i < entries.length; i += 2) {
                const orderId = entries[i];
                if (this.expiryTimers.has(orderId)) continue;
                this.scheduleExpiryTimer(orderId, Number(entries[i + 1]));
            }
        } catch (err) {
            this.logger.error(
                `Reservation reconciliation failed: ${(err as Error).message}`,
            );
        }
    }
}
