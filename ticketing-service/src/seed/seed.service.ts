import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Category } from '../category/entities/category.entity';
import { Event } from '../events/entities/event.entity';
import { Performer } from '../performer/entities/performer.entity';
import { Venue } from '../venue/entities/venue.entity';
import { TicketStatus } from '../shared/enum';

@Injectable()
export class SeedService implements OnModuleInit {
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
    ) {}

    async onModuleInit() {
        await this.seed();
    }

    async seed(force = false) {
        const ticketCount = await this.ticketRepository.count();
        const eventCount = await this.eventRepository.count();
        const performerCount = await this.performerRepository.count();
        const venueCount = await this.venueRepository.count();

        if (
            force ||
            ticketCount === 0 ||
            eventCount === 0 ||
            performerCount === 0 ||
            venueCount === 0
        ) {
            if (force) {
                await this.ticketRepository.query('DELETE FROM ticket');
                await this.categoryRepository.query('DELETE FROM categories');
                await this.eventRepository.query('DELETE FROM events');
                await this.performerRepository.query('DELETE FROM performers');
                await this.venueRepository.query('DELETE FROM venues');
            }

            // 1. Seed Performers
            const taylor = await this.performerRepository.save({
                name: 'Taylor Swift',
                description: 'Global superstar performing The Eras Tour.',
                imageUrl:
                    'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80',
            });

            const coldplay = await this.performerRepository.save({
                name: 'Coldplay',
                description:
                    'British rock icon performing Music of the Spheres Live.',
                imageUrl:
                    'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=800&q=80',
            });

            const neonHorizon = await this.performerRepository.save({
                name: 'Neon Horizon',
                description:
                    'Synthwave & Cyberpunk electronic live experience.',
                imageUrl:
                    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80',
            });

            // 2. Seed Venues
            const wembley = await this.venueRepository.save({
                name: 'Wembley Stadium',
                address: 'HA9 0WS, London',
                city: 'London',
                capacity: 90000,
                seatMap: 'Standard Arena Map',
            });

            const arena = await this.venueRepository.save({
                name: 'Grand Olympic Arena',
                address: '1000 Olympic Blvd',
                city: 'Los Angeles',
                capacity: 45000,
                seatMap: 'Arena Floor Map',
            });

            // 3. Seed Events
            const eventEras = await this.eventRepository.save({
                title: 'The Eras Tour - Finale',
                description:
                    'Taylor Swift performing all eras live in stadium spectacle.',
                date: new Date('2026-10-10T20:00:00Z'),
                venueId: wembley.id,
                performerId: taylor.id,
            });

            const eventColdplay = await this.eventRepository.save({
                title: 'Music of the Spheres Tour',
                description:
                    'Coldplay live with sustainable LED wristbands and fireworks.',
                date: new Date('2026-09-20T19:30:00Z'),
                venueId: wembley.id,
                performerId: coldplay.id,
            });

            const eventNeon = await this.eventRepository.save({
                title: 'Neon Pulse World Tour 2026',
                description: 'An immersive cyberpunk laser soundscape event.',
                date: new Date('2026-08-15T21:00:00Z'),
                venueId: arena.id,
                performerId: neonHorizon.id,
            });

            const eventsList = [eventEras, eventColdplay, eventNeon];

            // 4. Seed Categories & Tickets for each event
            for (const ev of eventsList) {
                const catVip = await this.categoryRepository.save({
                    name: 'VIP Front Stage Pit',
                    description:
                        'Exclusive front row access with priority entry and merch.',
                    eventId: ev.id,
                });

                const cat1 = await this.categoryRepository.save({
                    name: 'CAT 1 Premium Seated',
                    description:
                        'Center view padded seating with unobstructed view.',
                    eventId: ev.id,
                });

                const cat2 = await this.categoryRepository.save({
                    name: 'CAT 2 General Floor',
                    description: 'General admission standing floor near stage.',
                    eventId: ev.id,
                });

                const cat3 = await this.categoryRepository.save({
                    name: 'CAT 3 Upper Balcony',
                    description: 'Panoramic upper tier seating.',
                    eventId: ev.id,
                });

                const isErasTour = ev.id === eventEras.id;

                // Save Tickets
                await this.ticketRepository.save([
                    {
                        eventId: ev.id,
                        categoryId: catVip.id,
                        price: 299.0,
                        quantity: 15,
                        status: TicketStatus.AVAILABLE,
                    },
                    {
                        eventId: ev.id,
                        categoryId: cat1.id,
                        price: 189.0,
                        quantity: 40,
                        status: TicketStatus.AVAILABLE,
                    },
                    {
                        eventId: ev.id,
                        categoryId: cat2.id,
                        price: 119.0,
                        quantity: isErasTour ? 1 : 75,
                        status: TicketStatus.AVAILABLE,
                    },
                    {
                        eventId: ev.id,
                        categoryId: cat3.id,
                        price: 79.0,
                        quantity: 120,
                        status: TicketStatus.AVAILABLE,
                    },
                ]);
            }

            console.log(
                '[SeedService] Seeded Performers, Venues, Events, Categories, and Tickets!',
            );
        }

        return {
            message: 'Database seeded successfully',
            status: 'success',
        };
    }
}
