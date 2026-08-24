import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketsService } from './tickets.service';
import { TicketsGateway, TicketsHttpController } from './tickets.controller';
import { Ticket } from './entities/ticket.entity';
import { Order } from './entities/order.entity';
import { SeedModule } from '../seed/seed.module';
import { ReservationsModule } from '../reservations/reservations.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Ticket, Order]),
        SeedModule,
        ReservationsModule,
    ],
    controllers: [TicketsHttpController],
    providers: [TicketsService, TicketsGateway],
    exports: [TicketsService, TicketsGateway],
})
export class TicketsModule {}
