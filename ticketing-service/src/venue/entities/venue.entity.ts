import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('venues')
export class Venue {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column()
    address: string;

    @Column()
    city: string;

    @Column()
    capacity: number;

    @Column()
    seatMap: string;
}
