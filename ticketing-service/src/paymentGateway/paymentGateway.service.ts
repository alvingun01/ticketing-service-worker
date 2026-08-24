import {
    Injectable,
    Logger,
    BadRequestException,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { TicketsService } from '../tickets/tickets.service';
import { OrderStatus } from '../shared/enum';

@Injectable()
export class PaymentGatewayService {
    private readonly logger = new Logger(PaymentGatewayService.name);
    private readonly stripe: Stripe;
    private readonly clientUrl = process.env.CLIENT_URL;
    private readonly webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

    // Stripe clamps expires_at to a 30-min minimum, so this is only a
    // dead-man backstop in case the worker is down. The reservation worker
    // owns the real (shorter, CHECKOUT_HOLD_SECONDS) hold and actively
    // expires the session when it lapses.
    private static readonly CHECKOUT_BACKSTOP_MS = 30 * 60 * 1000;

    constructor(private readonly ticketsService: TicketsService) {
        const secretKey = process.env.STRIPE_SECRET_KEY;
        if (!secretKey) {
            throw new InternalServerErrorException(
                'STRIPE_SECRET_KEY environment variable is not set',
            );
        }
        this.stripe = new Stripe(secretKey);
    }

    async createCheckoutSession(orderId: string) {
        const order = await this.ticketsService.getOrder(orderId);

        // A reservation is only payable while it is PENDING and unexpired -
        // the 60s hold from buyTicket still applies up until this point.
        if (order.status !== OrderStatus.PENDING) {
            throw new BadRequestException(
                `Order ${orderId} is ${order.status.toLowerCase()} and can no longer be paid for`,
            );
        }

        const expiresAtMs = order.expiresAt
            ? new Date(order.expiresAt).getTime()
            : null;
        if (expiresAtMs && expiresAtMs <= Date.now()) {
            throw new BadRequestException(
                'Reservation expired - please re-book and try again.',
            );
        }

        // 30-min backstop (Stripe's floor); the worker expires it earlier.
        const backstopSeconds = Math.floor(
            (Date.now() + PaymentGatewayService.CHECKOUT_BACKSTOP_MS) / 1000,
        );

        const session = await this.stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        unit_amount: Math.round(
                            (order.totalPrice / order.quantity) * 100,
                        ),
                        product_data: {
                            name: `Ticket ${order.ticketId}`,
                        },
                    },
                    quantity: order.quantity,
                },
            ],
            client_reference_id: order.id,
            success_url: `${this.clientUrl}/orders/${order.id}?success=true`,
            cancel_url: `${this.clientUrl}/orders/${order.id}?success=false`,
            expires_at: backstopSeconds,
        });

        // Re-arm the worker for the shorter checkout hold and record the
        // session id so it can expire the session when the hold lapses.
        await this.ticketsService.startCheckoutHold(orderId, session.id);

        this.logger.log(
            `[Stripe] Created checkout session ${session.id} for Order ${orderId}`,
        );

        return session;
    }

    async handleWebhookEvent(rawBody: Buffer, signature: string | undefined) {
        if (!this.webhookSecret) {
            throw new InternalServerErrorException(
                'STRIPE_WEBHOOK_SECRET environment variable is not set',
            );
        }
        if (!signature) {
            throw new BadRequestException('Missing Stripe-Signature header');
        }

        let event: Stripe.Event;
        try {
            event = this.stripe.webhooks.constructEvent(
                rawBody,
                signature,
                this.webhookSecret,
            );
        } catch (err) {
            this.logger.error(
                `Webhook signature verification failed: ${(err as Error).message}`,
            );
            throw new BadRequestException('Invalid Stripe webhook signature');
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const orderId = session.client_reference_id;
            if (orderId) {
                this.logger.log(
                    `[Stripe Webhook] checkout.session.completed - reconciling Order ${orderId}`,
                );
                await this.reconcileCompletedSession(orderId, session);
            } else {
                this.logger.warn(
                    `[Stripe Webhook] checkout.session.completed for session ${session.id} had no client_reference_id`,
                );
            }
        } else if (event.type === 'checkout.session.expired') {
            const session = event.data.object;
            const orderId = session.client_reference_id;
            if (orderId) {
                this.logger.log(
                    `[Stripe Webhook] checkout.session.expired - releasing Order ${orderId}`,
                );
                await this.releaseExpiredSession(orderId);
            } else {
                this.logger.warn(
                    `[Stripe Webhook] checkout.session.expired for session ${session.id} had no client_reference_id`,
                );
            }
        }
    }

    /**
     * Payment completed on Stripe. Normal path confirms the order to PAID;
     * terminal-state races (worker already released the hold, or a duplicate
     * delivery) are reconciled so no customer is left charged with nothing.
     */
    private async reconcileCompletedSession(
        orderId: string,
        session: Stripe.Checkout.Session,
    ) {
        let order: Awaited<ReturnType<typeof this.ticketsService.getOrder>>;
        try {
            order = await this.ticketsService.getOrder(orderId);
        } catch (err) {
            if (err instanceof NotFoundException) {
                // Order gone from Redis AND SQL but the customer was charged -
                // best effort: make the customer whole.
                this.logger.error(
                    `[Stripe Webhook] Order ${orderId} not found for completed session ${session.id} - attempting refund`,
                );
                await this.refundIfNeeded(orderId, session);
                return;
            }
            throw err;
        }

        // Already resolved: duplicate delivery. Acknowledge, never refund.
        if (
            order.status === OrderStatus.PAID ||
            order.status === OrderStatus.USED
        ) {
            this.logger.log(
                `[Stripe Webhook] Order ${orderId} already ${order.status} - acknowledging duplicate`,
            );
            return;
        }

        // Worker released an expired hold (or the user cancelled) before the
        // payment landed - refund so the customer isn't charged for nothing.
        if (order.status === OrderStatus.CANCELLED) {
            this.logger.log(
                `[Stripe Webhook] Order ${orderId} is CANCELLED but payment completed - issuing refund`,
            );
            await this.refundIfNeeded(orderId, session);
            return;
        }

        // Normal path: order is PENDING (and protected by the Checkout
        // session), so confirm it.
        try {
            await this.ticketsService.confirmPayment(orderId);
            this.logger.log(
                `[Stripe Webhook] Order ${orderId} confirmed as PAID`,
            );
        } catch (err) {
            if (err instanceof BadRequestException) {
                // confirmPayment rejected it (expiry branch, or the worker
                // cancelled between our getOrder and its internal check) -
                // the order is no longer payable: refund.
                this.logger.log(
                    `[Stripe Webhook] Order ${orderId} could not be confirmed (${(err as Error).message}) - issuing refund`,
                );
                await this.refundIfNeeded(orderId, session);
                return;
            }
            throw err; // genuinely unexpected - let Stripe retry
        }
    }

    /**
     * Stripe Checkout session expired without payment. Release the hold the
     * same way the expiry worker would (stock back, order CANCELLED). Stripe
     * guarantees this event fires when an abandoned session expires.
     */
    private async releaseExpiredSession(orderId: string) {
        try {
            await this.ticketsService.cancelOrder(orderId);
            this.logger.log(
                `[Stripe Webhook] checkout.session.expired - released Order ${orderId}`,
            );
        } catch (err) {
            // Already PAID / CANCELLED elsewhere - order is resolved, ack.
            this.logger.log(
                `[Stripe Webhook] checkout.session.expired - Order ${orderId} already resolved (${(err as Error).message})`,
            );
        }
    }

    /**
     * Idempotent refund backstop. Never double-refunds: skips when a refund
     * for the PaymentIntent already exists, and uses a stable idempotency key
     * to dedupe concurrent redeliveries within Stripe's 24h key window.
     */
    private async refundIfNeeded(
        orderId: string,
        session: Stripe.Checkout.Session,
    ) {
        const paymentIntentId = this.extractPaymentIntentId(session);
        if (!paymentIntentId) {
            this.logger.warn(
                `[Stripe Webhook] No payment_intent on session ${session.id} for Order ${orderId} - nothing to refund`,
            );
            return; // nothing captured - ack, don't retry forever
        }

        const existing = await this.stripe.refunds.list({
            payment_intent: paymentIntentId,
            limit: 1,
        });
        if (existing.data.length > 0) {
            this.logger.log(
                `[Stripe Webhook] PaymentIntent ${paymentIntentId} already refunded - skipping`,
            );
            return;
        }

        await this.stripe.refunds.create(
            { payment_intent: paymentIntentId },
            { idempotencyKey: `refund_order_${orderId}` },
        );
        this.logger.log(
            `[Stripe Webhook] Refunded PaymentIntent ${paymentIntentId} for Order ${orderId}`,
        );
    }

    private extractPaymentIntentId(
        session: Stripe.Checkout.Session,
    ): string | null {
        if (typeof session.payment_intent === 'string') {
            return session.payment_intent;
        }
        return session.payment_intent?.id ?? null;
    }
}
