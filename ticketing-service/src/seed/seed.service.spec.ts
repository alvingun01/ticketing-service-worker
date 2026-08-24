import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SeedService } from './seed.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Category } from '../category/entities/category.entity';
import { Event } from '../events/entities/event.entity';
import { Performer } from '../performer/entities/performer.entity';
import { Venue } from '../venue/entities/venue.entity';

describe('SeedService', () => {
    let service: SeedService;

    const mockRepo = {
        count: jest.fn().mockResolvedValue(1),
        delete: jest.fn(),
        save: jest.fn().mockResolvedValue({ id: 'test-id' }),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SeedService,
                { provide: getRepositoryToken(Ticket), useValue: mockRepo },
                { provide: getRepositoryToken(Category), useValue: mockRepo },
                { provide: getRepositoryToken(Event), useValue: mockRepo },
                { provide: getRepositoryToken(Performer), useValue: mockRepo },
                { provide: getRepositoryToken(Venue), useValue: mockRepo },
            ],
        }).compile();

        service = module.get<SeedService>(SeedService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
