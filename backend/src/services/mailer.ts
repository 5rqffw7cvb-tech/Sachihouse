export interface MailAttachment {
  filename: string;
  // Base64-encoded file content.
  content: string;
  contentType?: string;
}

export interface MailMessage {
  to: string;
  // Blind: the copy exists so the office can read what a guest was sent, which
  // is nobody's business but the office's. A visible one would also invite a
  // reply to an address the guest was never given for that purpose.
  bcc?: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: MailAttachment[];
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
      console.log(
        `[mailer disabled] would send "${message.subject}" to ${message.to}`
        + (message.bcc ? ` (bcc ${message.bcc})` : ''),
      );
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
        // Left out of the payload entirely when unset — JSON.stringify drops
        // an undefined value, and Resend rejects an explicit null here.
        bcc: message.bcc,
        subject: message.subject,
        text: message.text,
        html: message.html,
        reply_to: message.replyTo,
        attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend API error ${res.status}: ${body}`);
    }
  }
}
