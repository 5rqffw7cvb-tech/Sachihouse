import Stripe from 'stripe';
import { Booking } from '../store/types.js';

export interface CheckoutSession {
  id: string;
  url: string;
}

// The surface app.ts depends on. Tests substitute a stub so the booking and
// webhook flows can be exercised without touching the network.
export interface PaymentGateway {
  readonly enabled: boolean;
  createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSession>;
  // Throws when the signature does not match, which the route turns into a 400.
  constructEvent(rawBody: Buffer | string, signature: string): Stripe.Event;
  // The processing fee Stripe kept, in whole yen. Refunds deduct it.
  getChargeFee(paymentIntentId: string): Promise<number>;
  createRefund(paymentIntentId: string, amount: number): Promise<{ id: string; amount: number }>;
}

export interface CheckoutSessionParams {
  booking: Booking;
  propertyName: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: number; // unix seconds
}

// Stripe Checkout only accepts a subset of locales; anything else falls back to
// the browser default. Vietnamese is not supported, so those guests see English.
const STRIPE_LOCALES: Record<string, Stripe.Checkout.SessionCreateParams.Locale> = {
  ja: 'ja',
  en: 'en',
  zh: 'zh',
  ko: 'ko',
  vi: 'en',
};

export function toStripeLocale(locale: string): Stripe.Checkout.SessionCreateParams.Locale {
  return STRIPE_LOCALES[locale] ?? 'auto';
}

export class StripeService implements PaymentGateway {
  private readonly client: Stripe | null;
  private readonly webhookSecret: string;

  constructor(options: { secretKey?: string; webhookSecret?: string } = {}) {
    const secretKey = options.secretKey ?? process.env.STRIPE_SECRET_KEY ?? '';
    this.webhookSecret = options.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? '';
    this.client = secretKey ? new Stripe(secretKey) : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  private requireClient(): Stripe {
    if (!this.client) {
      throw new Error('Stripe is not configured (STRIPE_SECRET_KEY is missing).');
    }
    return this.client;
  }

  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSession> {
    const { booking } = params;
    const session = await this.requireClient().checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: booking.id,
        customer_email: booking.guestEmail,
        locale: toStripeLocale(booking.locale),
        expires_at: params.expiresAt,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'jpy',
              // JPY is a zero-decimal currency: this is yen, not sen. Multiplying
              // by 100 here would overcharge every guest by 100x.
              unit_amount: booking.amountTotal,
              product_data: {
                name: `${params.propertyName} — ${booking.checkInDate} → ${booking.checkOutDate}`,
                description: `${booking.nights} night(s), ${booking.adults} adult(s)`
                  + (booking.children ? `, ${booking.children} child(ren)` : ''),
              },
            },
          },
        ],
        payment_intent_data: {
          metadata: { bookingId: booking.id, propertyId: booking.propertyId },
        },
        metadata: { bookingId: booking.id, propertyId: booking.propertyId },
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
      },
      // Retrying the same booking must not create a second session (and a second
      // chance to pay) for the same held nights.
      { idempotencyKey: `booking-checkout-${booking.id}` },
    );

    if (!session.url) {
      throw new Error('Stripe did not return a Checkout URL.');
    }
    return { id: session.id, url: session.url };
  }

  constructEvent(rawBody: Buffer | string, signature: string): Stripe.Event {
    if (!this.webhookSecret) {
      throw new Error('Stripe webhook secret is not configured.');
    }
    return this.requireClient().webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  async getChargeFee(paymentIntentId: string): Promise<number> {
    const intent = await this.requireClient().paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge.balance_transaction'],
    });

    const charge = intent.latest_charge;
    if (!charge || typeof charge === 'string') {
      return 0;
    }
    const balanceTransaction = charge.balance_transaction;
    if (!balanceTransaction || typeof balanceTransaction === 'string') {
      return 0;
    }
    return balanceTransaction.fee;
  }

  async createRefund(paymentIntentId: string, amount: number): Promise<{ id: string; amount: number }> {
    const refund = await this.requireClient().refunds.create(
      { payment_intent: paymentIntentId, amount },
      { idempotencyKey: `refund-${paymentIntentId}-${amount}` },
    );
    return { id: refund.id, amount: refund.amount };
  }
}
