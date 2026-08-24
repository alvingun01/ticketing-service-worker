import {
    Controller,
    Post,
    Param,
    Req,
    Headers,
    Logger,
    BadRequestException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentGatewayService } from './paymentGateway.service';

@Controller('payment-gateway')
export class PaymentGatewayController {
    private readonly logger = new Logger(PaymentGatewayController.name);

    constructor(
        private readonly paymentGatewayService: PaymentGatewayService,
    ) {}

    @Post('checkout-session/:orderId')
    async createCheckoutSession(@Param('orderId') orderId: string) {
        this.logger.log(
            `[HTTP POST /payment-gateway/checkout-session/${orderId}] Creating Stripe checkout session`,
        );
        const session =
            await this.paymentGatewayService.createCheckoutSession(orderId);
        return { url: session.url };
    }

    @Post('webhook')
    async handleWebhook(
        @Req() req: RawBodyRequest<Request>,
        @Headers('stripe-signature') signature: string,
    ) {
        if (!req.rawBody) {
            throw new BadRequestException(
                'Missing raw body for webhook signature verification',
            );
        }
        this.logger.log(
            '[HTTP POST /payment-gateway/webhook] Stripe event received',
        );
        await this.paymentGatewayService.handleWebhookEvent(
            req.rawBody,
            signature,
        );
        return { received: true };
    }
}
