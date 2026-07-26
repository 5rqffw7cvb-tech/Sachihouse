import nodemailer, { Transporter } from 'nodemailer';

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

// `family: 4` is not optional here. Railway's containers have no outbound IPv6
// route, but DNS hands back Gmail's AAAA record first, so the default behaviour
// is to dial an IPv6 address and fail with ENETUNREACH. Pinning the address
// family is what makes mail work in production; it succeeds locally either way,
// which is exactly why this was easy to miss.
export function buildGmailTransportOptions(user: string, password: string) {
  return {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    family: 4 as const,
    auth: { user, pass: password },
    // Confirmation mail is sent while answering Stripe's webhook, so a hanging
    // SMTP connection must fail fast rather than hold the response open.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  };
}

// Gmail SMTP. Requires an app password, not the account password — Google
// blocks plain password logins for SMTP on accounts with 2FA, which is all of
// them by default.
export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(options: { user?: string; password?: string; from?: string } = {}) {
    const user = options.user ?? process.env.GMAIL_USER ?? '';
    const password = options.password ?? process.env.GMAIL_APP_PASSWORD ?? '';
    this.from = options.from ?? process.env.MAIL_FROM ?? (user ? `Sachi House <${user}>` : '');

    this.transporter = user && password
      ? nodemailer.createTransport(buildGmailTransportOptions(user, password))
      : null;
  }

  get enabled(): boolean {
    return this.transporter !== null;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      // Without credentials the app still runs; the message is logged so local
      // development and staging show what would have been sent.
      console.log(`[mailer disabled] would send "${message.subject}" to ${message.to}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo,
    });
  }
}
