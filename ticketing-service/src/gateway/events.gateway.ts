import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
    cors: {
        origin: '*',
    },
})
export class EventsGateway {
    private readonly logger = new Logger(EventsGateway.name);

    @WebSocketServer()
    server: Server;

    @SubscribeMessage('events')
    handleEvent(
        @MessageBody() data: any,
        @ConnectedSocket() client: Socket,
    ): void {
        this.logger.log(
            `[WS Event 'events'] Client: ${client?.id || 'unknown'} - Data: ${JSON.stringify(data)}`,
        );

        // Broadcast to all connected clients across instances via Redis Pub/Sub
        this.server.emit('events', {
            message: 'Broadcasted via Redis Pub/Sub',
            data,
        });
    }
}
