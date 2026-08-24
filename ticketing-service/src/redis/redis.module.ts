import { Global, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import Redis from 'ioredis';

/**
 * Injection token for the process-wide ioredis command connection.
 *
 * One connection per process: the API process and the reservation worker
 * each get their own, which is the whole point of splitting the worker out
 * - expiry traffic no longer queues behind flash-sale buy traffic on a
 * shared connection.
 *
 * NOTE: a connection that has issued SUBSCRIBE can no longer run ordinary
 * commands, so anything that subscribes must duplicate() this client
 * rather than reuse it (see ReservationEventsService).
 */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export function createRedisClient(): Redis {
    return new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        lazyConnect: true,
        maxRetriesPerRequest: 3,
    });
}

@Global()
@Module({
    providers: [
        {
            provide: REDIS_CLIENT,
            useFactory: (): Redis => {
                const logger = new Logger('RedisModule');
                const client = createRedisClient();
                client.connect().catch((err: Error) => {
                    logger.warn(
                        `Redis connection lazy init warning: ${err.message}`,
                    );
                });
                return client;
            },
        },
    ],
    exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
    constructor(private readonly moduleRef: ModuleRef) {}

    onApplicationShutdown() {
        const client = this.moduleRef.get<Redis>(REDIS_CLIENT, {
            strict: false,
        });
        client?.disconnect();
    }
}
