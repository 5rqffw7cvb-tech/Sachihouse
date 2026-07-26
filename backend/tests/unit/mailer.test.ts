import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendMailer } from '../../src/services/mailer.js';

function fakeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

describe('ResendMailer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is disabled without an API key or a from address', () => {
    expect(new ResendMailer({ apiKey: '', from: 'a@b.com' }).enabled).toBe(false);
    expect(new ResendMailer({ apiKey: 're_test', from: '' }).enabled).toBe(false);
  });

  it('logs instead of calling the API when disabled', async () => {
    const fetchMock = fakeFetch(200, { id: 'unused' });
    vi.stubGlobal('fetch', fetchMock);
    const mailer = new ResendMailer({ apiKey: '', from: '' });

    await mailer.send({ to: 'guest@example.com', subject: 'Hi', text: 'Hi', html: '<p>Hi</p>' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the Resend API with the right fields', async () => {
    const fetchMock = fakeFetch(200, { id: 'email_123' });
    vi.stubGlobal('fetch', fetchMock);
    const mailer = new ResendMailer({ apiKey: 're_test', from: 'Sachi House <booking@sachi-house.net>' });

    await mailer.send({
      to: 'guest@example.com',
      subject: 'Booking confirmed',
      text: 'text body',
      html: '<p>html body</p>',
      replyTo: 'host@sachihouse.com',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer re_test' }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      from: 'Sachi House <booking@sachi-house.net>',
      to: 'guest@example.com',
      subject: 'Booking confirmed',
      text: 'text body',
      html: '<p>html body</p>',
      reply_to: 'host@sachihouse.com',
    });
  });

  it('throws on a non-2xx response so the caller can log the failure', async () => {
    const fetchMock = fakeFetch(422, { message: 'invalid from address' });
    vi.stubGlobal('fetch', fetchMock);
    const mailer = new ResendMailer({ apiKey: 're_test', from: 'a@b.com' });

    await expect(
      mailer.send({ to: 'guest@example.com', subject: 'Hi', text: 'Hi', html: '<p>Hi</p>' }),
    ).rejects.toThrow('422');
  });
});
