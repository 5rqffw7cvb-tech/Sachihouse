export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export interface Mailer {
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Sends over HTTPS via Resend's API rather than raw SMTP. Railway blocks
// outbound SMTP (ports 465/587) below the Pro plan, so nodemailer to Gmail
// hung until ETIMEDOUT in production even though it worked from a laptop.
// `from` must be an address on a domain verified in the Resend dashboard —
// Resend rejects sends from an unverified domain (e.g. a plain gmail.com
// address) rather than relaying them.
export class ResendMailer implements Mailer {
  private readonly apiKey: string;
  private readonly from: string;

  constructor(options: { apiKey?: string; from?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env.RESEND_API_KEY ?? '';
    this.from = options.from ?? process.env.MAIL_FROM ?? '';
  }

  get enabled(): boolean {
    return Boolean(this.apiKey && this.from);
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.apiKey || !this.from) {
      // Without credentials the app still runs; the message is logged so local
      // development and staging show what would have been sent.
      console.log(`[mailer disabled] would send "${message.subject}" to ${message.to}`);
      return;
    }

    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        reply_to: message.replyTo,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend API error ${res.status}: ${body}`);
    }
  }
}
