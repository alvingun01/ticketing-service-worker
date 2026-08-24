import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Category } from '../category/entities/category.entity';
import { Event } from '../events/entities/event.entity';
import { Performer } from '../performer/entities/performer.entity';
import { Venue } from '../venue/entities/venue.entity';
import { ticketDataKey, ticketStockKey } from './reservation.types';

/**
 * Read model for a ticket: joins the SQL rows into the flat shape clients
 * expect, preferring live Redis inventory while a ticket is on sale.
 *
 * Lives here rather than in TicketsService because the reservation worker
 * needs it too - it builds the ticket payload broadcast when a reservation
 * expires, and shouldn't have to duplicate the join.
 */
@Injectable()
export class TicketViewService {
    constructor(
        @InjectRepository(Ticket)
        private readonly ticketRepository: Repository<Ticket>,
        @InjectRepository(Category)
        private readonly categoryRepository: Repository<Category>,
        @InjectRepository(Event)
        private readonly eventRepository: Repository<Event>,
        @InjectRepository(Performer)
        private readonly performerRepository: Repository<Performer>,
        @InjectRepository(Venue)
        private readonly venueRepository: Repository<Venue>,
        @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    ) {}

    async populate(ticket: Ticket) {
        const category = await this.categoryRepository.findOneBy({
            id: ticket.categoryId,
        });
        const event = await this.eventRepository.findOneBy({
            id: ticket.eventId,
        });
        const performer = event
            ? await this.performerRepository.findOneBy({
                  id: event.performerId,
              })
            : null;
        const venue = event
            ? await this.venueRepository.findOneBy({ id: event.venueId })
            : null;

        return {
            id: ticket.id,
            eventId: ticket.eventId,
            eventTitle: event ? event.title : 'Concert Event',
            eventDescription: event ? event.description : '',
            eventDate: event ? event.date : null,
            performerId: performer ? performer.id : null,
            performerName: performer ? performer.name : 'Main Performer',
            performerDescription: performer ? performer.description : '',
            performerImage: performer ? performer.imageUrl : '',
            venueName: venue ? venue.name : 'Concert Arena',
            venueCity: venue ? venue.city : '',
            categoryId: ticket.categoryId,
            categoryName: category ? category.name : ticket.categoryId,
            categoryDescription: category ? category.description : '',
            price: Number(ticket.price),
            quantity: ticket.quantity,
            status: ticket.status,
        };
    }

    async findOne(id: string) {
        try {
            const redisStock = await this.redisClient.get(ticketStockKey(id));
            const redisData = await this.redisClient.get(ticketDataKey(id));
            if (redisStock !== null && redisData !== null) {
                const parsed = JSON.parse(redisData);
                parsed.quantity = parseInt(redisStock, 10);
                return parsed;
            }
        } catch {
            // Fallback
        }

        const ticket = await this.ticketRepository.findOneBy({ id });
        if (!ticket) {
            throw new NotFoundException(`Ticket with ID ${id} not found`);
        }
        return this.populate(ticket);
    }
}
