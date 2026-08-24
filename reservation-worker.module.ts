import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { StripeModule } from '../stripe/stripe.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { ExpiryWorkerService } from './expiry-worker.service';

/**
 * Root module of the reservation worker process.
 *
 * Intentionally minimal - just Postgres, Redis and the reservation logic.
 * None of the API's feature modules are imported: the worker serves no
 * traffic, so a smaller tree means a faster boot and a smaller blast radius.
 */
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        DatabaseModule,
        RedisModule,
        StripeModule,
        ReservationsModule,
    ],
    providers: [ExpiryWorkerService],
})
export class ReservationWorkerModule {}
