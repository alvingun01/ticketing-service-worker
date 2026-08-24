import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { EventsModule } from './events/events.module';
import { CategoryModule } from './category/category.module';
import { VenueModule } from './venue/venue.module';
import { PerformerModule } from './performer/performer.module';
import { GatewayModule } from './gateway/gateway.module';
import { TicketsModule } from './tickets/tickets.module';
import { SeedModule } from './seed/seed.module';
import { PaymentGatewayModule } from './paymentGateway/paymentGateway.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        DatabaseModule,
        RedisModule,
        UsersModule,
        EventsModule,
        CategoryModule,
        VenueModule,
        PerformerModule,
        GatewayModule,
        TicketsModule,
        SeedModule,
        PaymentGatewayModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
