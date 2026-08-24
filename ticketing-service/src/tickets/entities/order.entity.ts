import { OrderStatus } from 'src/shared/enum';
import { Column, Entity, CreateDateColumn, PrimaryColumn } from 'typeorm';

@Entity('orders')
export class Order {
    @PrimaryColumn('uuid')
    id: string;

    @Column()
    ticketId: string;

    @Column({ type: 'varchar', nullable: true })
    eventId: string | null;

    @Column('int')
    quantity: number;

    @Column('decimal', { precision: 10, scale: 2 })
    totalPrice: number;

    @CreateDateColumn()
    createdAt: Date;

    @Column({
        type: 'enum',
        enum: OrderStatus,
        default: OrderStatus.PENDING,
    })
    status: OrderStatus;

    @Column({ type: 'timestamptz', nullable: true })
    expiresAt!: Date | null;

    @Column({ type: 'varchar', nullable: true })
    checkoutSessionId!: string | null;
}
