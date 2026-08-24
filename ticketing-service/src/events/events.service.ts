import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { Event } from './entities/event.entity';

@Injectable()
export class EventsService {
    constructor(
        @InjectRepository(Event)
        private readonly eventRepository: Repository<Event>,
    ) {}

    create(createEventDto: CreateEventDto) {
        const event = this.eventRepository.create(createEventDto);
        return this.eventRepository.save(event);
    }

    findAll() {
        return this.eventRepository.find();
    }

    async findOne(id: string) {
        const event = await this.eventRepository.findOneBy({ id });
        if (!event) {
            throw new NotFoundException(`Event with ID ${id} not found`);
        }
        return event;
    }

    async update(id: string, updateEventDto: UpdateEventDto) {
        const event = await this.findOne(id);
        Object.assign(event, updateEventDto);
        return this.eventRepository.save(event);
    }

    async remove(id: string) {
        const event = await this.findOne(id);
        return this.eventRepository.remove(event);
    }
}
