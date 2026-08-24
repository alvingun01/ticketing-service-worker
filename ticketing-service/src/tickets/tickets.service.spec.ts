import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TicketsService } from './tickets.service';
import { Ticket } from './entities/ticket.entity';
import { Order } from './entities/order.entity';
import { Category } from '../category/entities/category.entity';
import { Event } from '../events/entities/event.entity';
import { Performer } from '../performer/entities/performer.entity';
import { Venue } from '../venue/entities/venue.entity';
import { SeedService } from '../seed/seed.service';

describe('TicketsService', () => {
    let service: TicketsService;

    const mockRepo = {
        create: jest.fn(),
        save: jest.fn(),
        find: jest.fn(),
        findOneBy: jest.fn(),
        remove: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        delete: jest.fn(),
        manager: {
            transaction: jest.fn((cb) => cb(mockRepo)),
        },
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TicketsService,
                {
                    provide: getRepositoryToken(Ticket),
                    useValue: mockRepo,
                },
                {
                    provide: getRepositoryToken(Order),
                    useValue: mockRepo,
                },
                {
                    provide: getRepositoryToken(Category),
                    useValue: mockRepo,
                },
                {
                    provide: getRepositoryToken(Event),
                    useValue: mockRepo,
                },
                {
                    provide: getRepositoryToken(Performer),
                    useValue: mockRepo,
                },
                {
                    provide: getRepositoryToken(Venue),
                    useValue: mockRepo,
                },
                {
                    provide: SeedService,
                    useValue: {
                        seed: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<TicketsService>(TicketsService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
