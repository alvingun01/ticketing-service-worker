import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ReservationWorkerModule } from './reservation-worker.module';

/**
 * Entrypoint for the reservation-expiry worker container.
 *
 * An application context rather than an HTTP app - this process serves no
 * traffic, it just holds expiry timers and talks to Redis/Postgres.
 */
async function bootstrap() {
    const logger = new Logger('ReservationWorkerBootstrap');
    const app = await NestFactory.createApplicationContext(
        ReservationWorkerModule,
    );

    // Without this, SIGTERM (docker stop) kills the process before
    // onModuleDestroy gets to clear timers and close connections.
    app.enableShutdownHooks();

    logger.log('⏱️  Reservation expiry worker started (no HTTP/WS listener)');
}

void bootstrap();
