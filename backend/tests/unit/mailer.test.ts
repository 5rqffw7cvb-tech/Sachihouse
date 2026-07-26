import { describe, expect, it } from 'vitest';
import { buildGmailTransportOptions } from '../../src/services/mailer.js';

describe('buildGmailTransportOptions', () => {
  it('pins IPv4', () => {
    // Railway containers have no outbound IPv6 route, but DNS returns Gmail's
    // AAAA record first, so without this every send died with ENETUNREACH.
    expect(buildGmailTransportOptions('a@b.com', 'pw').family).toBe(4);
  });

  it('uses Gmail SMTP over implicit TLS', () => {
    const options = buildGmailTransportOptions('a@b.com', 'pw');
    expect(options.host).toBe('smtp.gmail.com');
    expect(options.port).toBe(465);
    expect(options.secure).toBe(true);
  });

  it('keeps timeouts short because mail is sent inside the Stripe webhook', () => {
    const options = buildGmailTransportOptions('a@b.com', 'pw');
    expect(options.connectionTimeout).toBeLessThanOrEqual(10000);
    expect(options.greetingTimeout).toBeLessThanOrEqual(10000);
    expect(options.socketTimeout).toBeLessThanOrEqual(10000);
  });

  it('passes the credentials through as the SMTP auth pair', () => {
    expect(buildGmailTransportOptions('a@b.com', 'pw').auth).toEqual({ user: 'a@b.com', pass: 'pw' });
  });
});
