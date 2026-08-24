import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import {
    Controller,
    Get,
    Post,
    Patch,
    Param,
    Body,
    Logger,
    OnModuleInit,
} from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { TicketsService } from './tickets.service';
import { ReservationEventsService } from '../reservations/reservation-events.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

@WebSocketGateway({
    cors: {
        origin: '*',
    },
})
export class TicketsGateway
    implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
    private readonly logger = new Logger(TicketsGateway.name);

    @WebSocketServer()
    server: Server;

    constructor(
        private readonly ticketsService: TicketsService,
        private readonly reservationEvents: ReservationEventsService,
    ) {}

    onModuleInit() {
        // Expiry now happens in the reservation-worker process; this
        // relays what it reports out to connected clients.
        this.reservationEvents.onReservationExpired(
            ({ orderId, ticketId, ticket }) => {
                this.logger.log(
                    `[Reservation Expired] Order ${orderId} timed out - broadcasting release`,
                );
                this.server.emit('ticketUpdated', ticket);
                this.server.emit('reservationExpired', {
                    orderId,
                    ticketId,
                    ticket,
                });
            },
        );
    }

    handleConnection(client: Socket) {
        this.logger.log(`[WebSocket Client Connected] Socket ID: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(
            `[WebSocket Client Disconnected] Socket ID: ${client.id}`,
        );
    }

    @SubscribeMessage('createTicket')
    async create(
        @MessageBody() createTicketDto: CreateTicketDto,
        @ConnectedSocket() client: Socket,
    ) {
        this.logger.log(
            `[WS Event 'createTicket'] Client: ${client?.id || 'unknown'} - Payload: ${JSON.stringify(createTicketDto)}`,
        );
        const ticket = await this.ticketsService.create(createTicketDto);
        this.server.emit('ticketCreated', ticket);
        return ticket;
    }

    @SubscribeMessage('findAllTickets')
    async findAll(@ConnectedSocket() client: Socket) {
        this.logger.log(
            `[WS Event 'findAllTickets'] Client: ${client?.id || 'unknown'}`,
        );
        const tickets = await this.ticketsService.findAll();
        this.server.emit('ticketsList', tickets);
        return tickets;
    }

    @SubscribeMessage('findOneTicket')
    async findOne(
        @MessageBody() id: string,
        @ConnectedSocket() client: Socket,
    ) {
        this.logger.log(
            `[WS Event 'findOneTicket'] Client: ${client?.id || 'unknown'} - ID: ${id}`,
        );
        return this.ticketsService.findOne(id);
    }

    @SubscribeMessage('buyTicket')
    async buyTicket(
        @MessageBody() payload: { id: string; quantity: number },
        @ConnectedSocket() client: Socket,
    ) {
        this.logger.log(
            `[WS Event 'buyTicket'] Client: ${client?.id || 'unknown'} - TicketID: ${payload?.id}, Qty: ${payload?.quantity}`,
        );
        const ticket = await this.ticketsService.buyTicket(
            payload.id,
            payload.quantity,
        );

        const broadcastPayload = {
            event: 'ticket_reserved',
            ticketId: ticket.id,
            categoryName: ticket.categoryName,
            performerName: ticket.performerName,
            eventTitle: ticket.eventTitle,
            quantityPurchased: payload.quantity,
            remainingQuantity: ticket.quantity,
            purchasedBy: client?.id || 'another_client',
            timestamp: new Date().toISOString(),
            order: ticket.order,
            ticket,
        };

        // Publish to all clients across nodes via Redis Pub/Sub adapter
        this.server.emit('ticketUpdated', ticket);
        this.server.emit('ticketReserved', broadcastPayload);
        this.server.emit('events', broadcastPayload);

        return ticket;
    }

    @SubscribeMessage('confirmPayment')
    async confirmPayment(
        @MessageBody() payload: { orderId: string },
        @ConnectedSocket() client: Socket,
    ) {
        this.logger.log(
            `[WS Event 'confirmPayment'] Client: ${client?.id || 'unknown'} - OrderID: ${payload?.orderId}`,
        );
        const result = await this.ticketsService.confirmPayment(
            payload.orderId,
        );
        this.server.emit('orderConfirmed', result);
        return result;
    }

    @SubscribeMessage('cancelOrder')
    async cancelOrder(
        @MessageBody() payload: { orderId: string },
        @ConnectedSocket() client: Socket,
    ) {
        this.logger.log(
            `[WS Event 'cancelOrder'] Client: ${client?.id || 'unknown'} - OrderID: ${payload?.orderId}`,
        );
        const result = await this.ticketsService.cancelOrder(payload.orderId);
        this.server.emit('ticketUpdated', result.ticket);
        this.server.emit('orderCancelled', result);
        return result;
    }

    @SubscribeMessage('seedTickets')
    async seed(@ConnectedSocket() client: Socket) {
        this.logger.log(
            `[WS Event 'seedTickets'] Client: ${client?.id || 'unknown'} - Triggering Database Re-seed`,
        );
        const tickets = await this.ticketsService.seed(true);
        this.server.emit('ticketsList', tickets);
        return tickets;
    }

    @SubscribeMessage('updateTicket')
    async update(
        @MessageBody()
        payload: {
            id: string;
            updateTicketDto: UpdateTicketDto;
        },
        @ConnectedSocket() client: Socket,
    ) {
        this.logger.log(
            `[WS Event 'updateTicket'] Client: ${client?.id || 'unknown'} - ID: ${payload?.id}`,
        );
        const ticket = await this.ticketsService.update(
            payload.id,
            payload.updateTicketDto,
        );
        this.server.emit('ticketUpdated', ticket);
        return ticket;
    }

    @SubscribeMessage('removeTicket')
    async remove(@MessageBody() id: string, @ConnectedSocket() client: Socket) {
        this.logger.log(
            `[WS Event 'removeTicket'] Client: ${client?.id || 'unknown'} - ID: ${id}`,
        );
        const result = await this.ticketsService.remove(id);
        this.server.emit('ticketRemoved', { id });
        return result;
    }
}

@Controller('tickets')
export class TicketsHttpController {
    private readonly logger = new Logger(TicketsHttpController.name);

    constructor(
        private readonly ticketsService: TicketsService,
        private readonly ticketsGateway: TicketsGateway,
    ) {}

    @Get()
    findAll() {
        this.logger.log('[HTTP GET /tickets] Fetching all tickets');
        return this.ticketsService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        this.logger.log(`[HTTP GET /tickets/${id}] Fetching ticket details`);
        return this.ticketsService.findOne(id);
    }

    @Post(':id/buy')
    async buyTicket(
        @Param('id') id: string,
        @Body() body: { quantity?: number },
    ) {
        const qty = body?.quantity || 1;
        this.logger.log(
            `[HTTP POST /tickets/${id}/buy] Buying ${qty} ticket(s)`,
        );
        const ticket = await this.ticketsService.buyTicket(id, qty);

        const broadcastPayload = {
            event: 'ticket_reserved',
            ticketId: ticket.id,
            categoryName: ticket.categoryName,
            performerName: ticket.performerName,
            eventTitle: ticket.eventTitle,
            quantityPurchased: qty,
            remainingQuantity: ticket.quantity,
            purchasedBy: 'http_client',
            timestamp: new Date().toISOString(),
            order: ticket.order,
            ticket,
        };

        this.ticketsGateway.server.emit('ticketUpdated', ticket);
        this.ticketsGateway.server.emit('ticketReserved', broadcastPayload);
        this.ticketsGateway.server.emit('events', broadcastPayload);

        return ticket;
    }

    @Post('orders/:orderId/cancel')
    async cancelOrder(@Param('orderId') orderId: string) {
        this.logger.log(
            `[HTTP POST /tickets/orders/${orderId}/cancel] Cancelling reservation`,
        );
        const result = await this.ticketsService.cancelOrder(orderId);
        this.ticketsGateway.server.emit('ticketUpdated', result.ticket);
        this.ticketsGateway.server.emit('orderCancelled', result);
        return result;
    }

    @Patch(':id')
    async update(
        @Param('id') id: string,
        @Body() updateTicketDto: UpdateTicketDto,
    ) {
        this.logger.log(
            `[HTTP PATCH /tickets/${id}] Updating ticket status/data`,
        );
        const ticket = await this.ticketsService.update(id, updateTicketDto);
        this.ticketsGateway.server.emit('ticketUpdated', ticket);
        return ticket;
    }

    @Post('seed')
    async seed() {
        this.logger.log(
            '[HTTP POST /tickets/seed] Triggering database re-seed',
        );
        const tickets = await this.ticketsService.seed(true);
        this.ticketsGateway.server.emit('ticketsList', tickets);
        return tickets;
    }
}
