import { TicketStatus } from '../../shared/enum';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Ticket {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    eventId: string;

    @Column()
    categoryId: string;

    @Column('decimal', { precision: 10, scale: 2 })
    price: number;

    @Column('int')
    quantity: number;

    @Column({
        type: 'enum',
        enum: TicketStatus,
        default: TicketStatus.AVAILABLE,
    })
    status: TicketStatus;
}
