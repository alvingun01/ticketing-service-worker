import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReservationsService } from './reservations.service';
import { ReservationEventsService } from './reservation-events.service';
import { TicketViewService } from './ticket-view.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Order } from '../tickets/entities/order.entity';
import { Category } from '../category/entities/category.entity';
import { Event } from '../events/entities/event.entity';
import { Performer } from '../performer/entities/performer.entity';
import { Venue } from '../venue/entities/venue.entity';

/**
 * Reservation logic with no HTTP/WebSocket surface, imported by both the
 * API (TicketsModule) and the standalone reservation worker.
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([
            Ticket,
            Order,
            Category,
            Event,
            Performer,
            Venue,
        ]),
    ],
    providers: [
        ReservationsService,
        TicketViewService,
        ReservationEventsService,
    ],
    exports: [ReservationsService, TicketViewService, ReservationEventsService],
})
export class ReservationsModule {}
