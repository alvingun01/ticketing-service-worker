import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

export class RedisIoAdapter extends IoAdapter {
    private adapterConstructor: ReturnType<typeof createAdapter>;

    async connectToRedis(): Promise<void> {
        const pubClient = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
        });
        const subClient = pubClient.duplicate();

        this.adapterConstructor = createAdapter(pubClient, subClient);
    }

    override createIOServer(port: number, options?: ServerOptions): any {
        const serverOptions = {
            ...options,
            cors: {
                origin: '*',
                methods: ['GET', 'POST'],
            },
        };
        const server = super.createIOServer(port, serverOptions);
        server.adapter(this.adapterConstructor);
        return server;
    }
}
