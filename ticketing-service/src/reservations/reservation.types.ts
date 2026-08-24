import { Order } from '../tickets/entities/order.entity';
import { OrderStatus } from '../shared/enum';

/**
 * Redis ZSET of pending reservations: member = orderId, score = expiry
 * timestamp in ms. This is the durable source of truth the expiry worker
 * rebuilds its in-memory timers from after a restart.
 */
export const RESERVATIONS_KEY = 'reservations';

export function orderKey(orderId: string) {
    return `order:${orderId}`;
}

export function ticketOrdersKey(ticketId: string) {
    return `ticket:${ticketId}:orders`;
}

export function ticketStockKey(ticketId: string) {
    return `ticket:${ticketId}:stock`;
}

export function ticketDataKey(ticketId: string) {
    return `ticket:${ticketId}:data`;
}

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
    return UUID_REGEX.test(id);
}

/**
 * Shape of an order while it lives only in Redis (ticket is on sale).
 * Mirrors the Order entity's fields so it can be synced into SQL verbatim
 * once the ticket is paused, and so callers can treat both interchangeably.
 */
export interface OrderRecord {
    id: string;
    ticketId: string;
    eventId: string | null;
    quantity: number;
    totalPrice: number;
    status: OrderStatus;
    createdAt: string;
    expiresAt: string | null;
    /** Stripe Checkout session id, set once the customer starts checkout. */
    checkoutSessionId?: string;
}

export type OrderLike = Order | OrderRecord;
