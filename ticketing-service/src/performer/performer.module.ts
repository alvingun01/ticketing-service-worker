import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PerformerService } from './performer.service';
import { PerformerController } from './performer.controller';
import { Performer } from './entities/performer.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Performer])],
    controllers: [PerformerController],
    providers: [PerformerService],
})
export class PerformerModule {}
