import Stripe from 'stripe';
import { CheckoutSession, CheckoutSessionParams, PaymentGateway } from '../../src/services/stripe.js';

export const TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_signature_checks';

// Signature verification is pure crypto with no network calls, so tests sign
// payloads with Stripe's own helper and exercise the real constructEvent path.
// Only the methods that would reach the Stripe API are faked.
const signer = new Stripe('sk_test_fake_key_for_signing');

export function signWebhookPayload(payload: string, secret = TEST_WEBHOOK_SECRET): string {
  return signer.webhooks.generateTestHeaderString({ payload, secret });
}

export class FakePaymentGateway implements PaymentGateway {
  readonly enabled = true;
  readonly sessions: CheckoutSessionParams[] = [];
  readonly refunds: Array<{ paymentIntentId: string; amount: number }> = [];
  chargeFee = 1260;
  failNextSession = false;

  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSession> {
    if (this.failNextSession) {
      throw new Error('Stripe is down');
    }
    this.sessions.push(params);
    return {
      id: `cs_test_${this.sessions.length}`,
      url: `https://checkout.stripe.com/c/pay/cs_test_${this.sessions.length}`,
    };
  }

  constructEvent(rawBody: Buffer | string, signature: string): Stripe.Event {
    return signer.webhooks.constructEvent(rawBody, signature, TEST_WEBHOOK_SECRET);
  }

  async getChargeFee(): Promise<number> {
    return this.chargeFee;
  }

  async createRefund(paymentIntentId: string, amount: number) {
    this.refunds.push({ paymentIntentId, amount });
    return { id: `re_test_${this.refunds.length}`, amount };
  }
}
