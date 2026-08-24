import { Module } from '@nestjs/common';
import Stripe from 'stripe';

export const STRIPE_CLIENT = 'STRIPE_CLIENT';

/**
 * Shared Stripe client for any process that talks to Stripe - the API (payment
 * gateway) and the reservation worker (which expires Checkout sessions when a
 * checkout hold lapses). The worker previously had no Stripe access; it gains
 * it here.
 */
@Module({
    providers: [
        {
            provide: STRIPE_CLIENT,
            useFactory: () => {
                const key = process.env.STRIPE_SECRET_KEY;
                if (!key) {
                    throw new Error(
                        'STRIPE_SECRET_KEY environment variable is not set',
                    );
                }
                return new Stripe(key);
            },
        },
    ],
    exports: [STRIPE_CLIENT],
})
export class StripeModule {}
