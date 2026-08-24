import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { Venue } from './entities/venue.entity';

@Injectable()
export class VenueService {
    constructor(
        @InjectRepository(Venue)
        private readonly venueRepository: Repository<Venue>,
    ) {}

    create(createVenueDto: CreateVenueDto) {
        const venue = this.venueRepository.create(createVenueDto);
        return this.venueRepository.save(venue);
    }

    findAll() {
        return this.venueRepository.find();
    }

    async findOne(id: string) {
        const venue = await this.venueRepository.findOneBy({ id });
        if (!venue) {
            throw new NotFoundException(`Venue with ID ${id} not found`);
        }
        return venue;
    }

    async update(id: string, updateVenueDto: UpdateVenueDto) {
        const venue = await this.findOne(id);
        Object.assign(venue, updateVenueDto);
        return this.venueRepository.save(venue);
    }

    async remove(id: string) {
        const venue = await this.findOne(id);
        return this.venueRepository.remove(venue);
    }
}
