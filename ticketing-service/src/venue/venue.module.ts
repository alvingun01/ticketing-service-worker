import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VenueService } from './venue.service';
import { VenueController } from './venue.controller';
import { Venue } from './entities/venue.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Venue])],
    controllers: [VenueController],
    providers: [VenueService],
})
export class VenueModule {}
