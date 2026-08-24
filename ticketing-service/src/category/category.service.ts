import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from './entities/category.entity';

@Injectable()
export class CategoryService {
    constructor(
        @InjectRepository(Category)
        private readonly categoryRepository: Repository<Category>,
    ) {}

    create(createCategoryDto: CreateCategoryDto) {
        const category = this.categoryRepository.create(createCategoryDto);
        return this.categoryRepository.save(category);
    }

    findAll() {
        return this.categoryRepository.find();
    }

    async findOne(id: string) {
        const category = await this.categoryRepository.findOneBy({ id });
        if (!category) {
            throw new NotFoundException(`Category with ID ${id} not found`);
        }
        return category;
    }

    async update(id: string, updateCategoryDto: UpdateCategoryDto) {
        const category = await this.findOne(id);
        Object.assign(category, updateCategoryDto);
        return this.categoryRepository.save(category);
    }

    async remove(id: string) {
        const category = await this.findOne(id);
        return this.categoryRepository.remove(category);
    }
}
