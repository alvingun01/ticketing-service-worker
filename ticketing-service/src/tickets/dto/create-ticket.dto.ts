import { TicketStatus } from '../../shared/enum';

export class CreateTicketDto {
    eventId: string;
    categoryId: string;
    price: number;
    quantity: number;
    status?: TicketStatus;
}
