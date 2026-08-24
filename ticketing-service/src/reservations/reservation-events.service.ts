import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

export const RESERVATION_CREATED_CHANNEL = 'reservations:created';
export const RESERVATION_CLEARED_CHANNEL = 'reservations:cleared';
export const RESERVATION_EXPIRED_CHANNEL = 'reservations:expired';

export interface ReservationCreatedEvent {
    orderId: string;
    ticketId: string;
    expiresAtMs: number;
}

export interface ReservationClearedEvent {
    orderId: string;
}

export interface ReservationExpiredEvent {
    orderId: string;
    ticketId: string;
    ticket: any;
}

/**
 * The wire between the API process and the reservation worker.
 *
 * Deliberately plain Redis Pub/Sub rather than the Socket.IO redis-adapter
 * that's already in the app: that adapter speaks an internal msgpack packet
 * format meant for fanning Socket.IO packets between Socket.IO servers, and
 * the worker has no Socket.IO server at all. A small JSON envelope keeps the
 * worker free of any socket.io coupling.
 *
 * Direction of travel:
 *   API  -> worker : created (arm a timer now, don't wait for reconcile)
 *   API  -> worker : cleared (drop a timer early; purely an optimisation,
 *                    a missed one just means a timer fires and no-ops)
 *   worker -> API  : expired (so the gateway can broadcast to clients)
 */
@Injectable()
export class ReservationEventsService implements OnModuleDestroy {
    private readonly logger = new Logger(ReservationEventsService.name);
    private subscriberClient?: Redis;

    constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

    publishReservationCreated(event: ReservationCreatedEvent) {
        return this.publish(RESERVATION_CREATED_CHANNEL, event);
    }

    publishReservationCleared(event: ReservationClearedEvent) {
        return this.publish(RESERVATION_CLEARED_CHANNEL, event);
    }

    publishReservationExpired(event: ReservationExpiredEvent) {
        console.log('Reservation Expired');
        return this.publish(RESERVATION_EXPIRED_CHANNEL, event);
    }

    onReservationCreated(handler: (event: ReservationCreatedEvent) => void) {
        this.subscribe(RESERVATION_CREATED_CHANNEL, handler);
    }

    onReservationCleared(handler: (event: ReservationClearedEvent) => void) {
        this.subscribe(RESERVATION_CLEARED_CHANNEL, handler);
    }

    onReservationExpired(handler: (event: ReservationExpiredEvent) => void) {
        this.subscribe(RESERVATION_EXPIRED_CHANNEL, handler);
    }

    /**
     * Publishing is best-effort by design: none of these messages carry
     * state that isn't already durable in Redis/SQL, so a failed publish
     * must never fail the request that triggered it. Worst case the worker
     * picks the reservation up on its next reconciliation pass.
     */
    private async publish(channel: string, event: unknown): Promise<void> {
        try {
            await this.redisClient.publish(channel, JSON.stringify(event));
        } catch (err) {
            this.logger.error(
                `Failed to publish on ${channel}: ${(err as Error).message}`,
            );
        }
    }

    private subscribe(channel: string, handler: (event: any) => void) {
        // A subscribed ioredis connection can't run ordinary commands, so
        // subscribers get their own connection - same pattern as the
        // Socket.IO adapter's pub/sub pair.
        if (!this.subscriberClient) {
            this.subscriberClient = this.redisClient.duplicate({
                lazyConnect: false,
            });
            this.subscriberClient.on('error', (err: Error) => {
                this.logger.error(
                    `Reservation event subscriber error: ${err.message}`,
                );
            });
        }

        const sub = this.subscriberClient;
        sub.subscribe(channel).catch((err: Error) => {
            this.logger.error(
                `Failed to subscribe to ${channel}: ${err.message}`,
            );
        });

        sub.on('message', (incomingChannel: string, message: string) => {
            if (incomingChannel !== channel) return;
            try {
                handler(JSON.parse(message));
            } catch (err) {
                this.logger.error(
                    `Failed to handle message on ${channel}: ${(err as Error).message}`,
                );
            }
        });
    }

    onModuleDestroy() {
        this.subscriberClient?.disconnect();
    }
}
