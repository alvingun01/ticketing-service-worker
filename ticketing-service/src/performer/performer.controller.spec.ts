import { Test, TestingModule } from '@nestjs/testing';
import { PerformerController } from './performer.controller';
import { PerformerService } from './performer.service';

describe('PerformerController', () => {
    let controller: PerformerController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PerformerController],
            providers: [
                {
                    provide: PerformerService,
                    useValue: {
                        create: jest.fn(),
                        findAll: jest.fn(),
                        findOne: jest.fn(),
                        update: jest.fn(),
                        remove: jest.fn(),
                    },
                },
            ],
        }).compile();

        controller = module.get<PerformerController>(PerformerController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
