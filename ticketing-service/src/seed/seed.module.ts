import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeedService } from './seed.service';
import { SeedController } from './seed.controller';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Category } from '../category/entities/category.entity';
import { Event } from '../events/entities/event.entity';
import { Performer } from '../performer/entities/performer.entity';
import { Venue } from '../venue/entities/venue.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([Ticket, Category, Event, Performer, Venue]),
    ],
    controllers: [SeedController],
    providers: [SeedService],
    exports: [SeedService],
})
export class SeedModule {}
