import { Module } from '@nestjs/common';
import { PaymentGatewayController } from './paymentGateway.controller';
import { PaymentGatewayService } from './paymentGateway.service';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
    imports: [TicketsModule],
    controllers: [PaymentGatewayController],
    providers: [PaymentGatewayService],
})
export class PaymentGatewayModule {}
