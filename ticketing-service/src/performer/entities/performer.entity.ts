import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('performers')
export class Performer {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column()
    description: string;

    @Column()
    imageUrl: string;
}
