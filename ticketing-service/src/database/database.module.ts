import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * Shared Postgres connection, imported by both entrypoints (the API's
 * AppModule and the reservation worker's ReservationWorkerModule) so the
 * connection config lives in exactly one place.
 *
 * DB_SYNCHRONIZE exists because TypeORM's schema sync runs DDL on every
 * bootstrap - with two processes now starting against the same database,
 * only one of them should do it (the worker runs with it disabled).
 */
@Module({
    imports: [
        TypeOrmModule.forRootAsync({
            useFactory: () => ({
                type: 'postgres' as const,
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT || '5432', 10),
                username: process.env.DB_USERNAME || 'postgres',
                password: process.env.DB_PASSWORD || 'postgres',
                database: process.env.DB_DATABASE || 'ticketing',
                autoLoadEntities: true,
                synchronize: process.env.DB_SYNCHRONIZE !== 'false', // Only for development/demo
            }),
        }),
    ],
    exports: [TypeOrmModule],
})
export class DatabaseModule {}
