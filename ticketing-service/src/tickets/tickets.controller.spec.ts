import { Test, TestingModule } from '@nestjs/testing';
import { TicketsGateway } from './tickets.controller';
import { TicketsService } from './tickets.service';

describe('TicketsGateway', () => {
    let gateway: TicketsGateway;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TicketsGateway,
                {
                    provide: TicketsService,
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

        gateway = module.get<TicketsGateway>(TicketsGateway);
    });

    it('should be defined', () => {
        expect(gateway).toBeDefined();
    });
});
