import { MailMessage, Mailer } from '../../src/services/mailer.js';

export class FakeMailer implements Mailer {
  readonly enabled = true;
  readonly sent: MailMessage[] = [];
  failNextSend = false;

  async send(message: MailMessage): Promise<void> {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error('SMTP unavailable');
    }
    this.sent.push(message);
  }

  to(address: string): MailMessage[] {
    return this.sent.filter((message) => message.to === address);
  }
}
