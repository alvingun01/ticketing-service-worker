import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './adapters/redis-io.adapter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
    const logger = new Logger('Bootstrap');
    const app = await NestFactory.create(AppModule, { rawBody: true });

    app.enableCors({ origin: '*' });

    // Register Global HTTP Request Logger Interceptor
    app.useGlobalInterceptors(new LoggingInterceptor());

    // Connect & Register Redis Socket.IO Adapter
    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);

    const port = process.env.PORT ?? 8000;
    await app.listen(port, '0.0.0.0');
    logger.log(
        `🚀 Ticketing Backend Service is listening on 0.0.0.0:${port} (allowing phone/LAN connections)`,
    );
}
bootstrap();
