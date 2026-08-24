import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PerformerService } from './performer.service';
import { Performer } from './entities/performer.entity';

describe('PerformerService', () => {
    let service: PerformerService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PerformerService,
                {
                    provide: getRepositoryToken(Performer),
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

        service = module.get<PerformerService>(PerformerService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
