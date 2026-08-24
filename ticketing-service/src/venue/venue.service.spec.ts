import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VenueService } from './venue.service';
import { Venue } from './entities/venue.entity';

describe('VenueService', () => {
    let service: VenueService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                VenueService,
                {
                    provide: getRepositoryToken(Venue),
                    useValue: {
                        create: jest.fn(),
                        save: jest.fn(),
                        find: jest.fn(),
                        findOneBy: jest.fn(),
                        remove: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<VenueService>(VenueService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
