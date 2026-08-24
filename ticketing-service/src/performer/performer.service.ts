import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatePerformerDto } from './dto/create-performer.dto';
import { UpdatePerformerDto } from './dto/update-performer.dto';
import { Performer } from './entities/performer.entity';

@Injectable()
export class PerformerService {
    constructor(
        @InjectRepository(Performer)
        private readonly performerRepository: Repository<Performer>,
    ) {}

    create(createPerformerDto: CreatePerformerDto) {
        const performer = this.performerRepository.create(createPerformerDto);
        return this.performerRepository.save(performer);
    }

    findAll() {
        return this.performerRepository.find();
    }

    async findOne(id: string) {
        const performer = await this.performerRepository.findOneBy({ id });
        if (!performer) {
            throw new NotFoundException(`Performer with ID ${id} not found`);
        }
        return performer;
    }

    async update(id: string, updatePerformerDto: UpdatePerformerDto) {
        const performer = await this.findOne(id);
        Object.assign(performer, updatePerformerDto);
        return this.performerRepository.save(performer);
    }

    async remove(id: string) {
        const performer = await this.findOne(id);
        return this.performerRepository.remove(performer);
    }
}
