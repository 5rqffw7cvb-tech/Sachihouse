import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdOcrUnavailableError, IdProcessingService } from '../../src/services/idProcessing.js';

/**
 * The Gemini branch of the ID OCR service. It is skipped under NODE_ENV=test
 * and MOCK_GEMINI=true, so both are overridden here; `fetch` is stubbed, and
 * nothing in this file reaches the real API.
 */

const OCR_SECRET = 'YAMADA TARO P<JPN TK1234567';

const validPayload = {
  isIdDocument: true,
  rejectionReason: '',
  documentType: 'passport',
  fullName: 'Yamada Taro',
  birthYear: 1990,
  nationality: 'Japan',
  address: 'Tokyo, Japan',
  gender: 'Male',
  occupation: '',
  documentNumber: 'TK1234567',
  confidence: { fullName: 0.9 },
  ocrText: OCR_SECRET,
};

function geminiResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

const textResponse = (text: string, finishReason = 'STOP') => geminiResponse({
  candidates: [{ finishReason, content: { parts: [{ text }] } }],
  usageMetadata: { totalTokenCount: 123 },
});

const emptyResponse = () => geminiResponse({ usageMetadata: { totalTokenCount: 5 } });

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const init = fetchMock.mock.calls[call][1] as { body: string };
  return JSON.parse(init.body) as {
    generationConfig: {
      temperature?: number;
      responseMimeType?: string;
      maxOutputTokens?: number;
      thinkingConfig?: { thinkingBudget?: number };
    };
  };
}

function loggedText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((args: unknown[]) => args.map((arg) => String(arg)).join(' ')).join('\n');
}

describe('IdProcessingService Gemini call', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MOCK_GEMINI', 'false');
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('throws IdOcrUnavailableError after two responses without candidates', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => emptyResponse());
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    await expect(service.processIdDocument('aGVsbG8=', 'image/jpeg')).rejects.toBeInstanceOf(IdOcrUnavailableError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not surface the word Gemini in the error it throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => emptyResponse()));

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    const error = await service.processIdDocument('aGVsbG8=', 'image/jpeg').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IdOcrUnavailableError);
    expect((error as Error).name).toBe('IdOcrUnavailableError');
    expect((error as Error).message).not.toMatch(/gemini/i);
  });

  it('returns the result when the first response is empty and the second is valid JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(textResponse(JSON.stringify(validPayload)));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    const result = await service.processIdDocument('aGVsbG8=', 'image/jpeg');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.isIdDocument).toBe(true);
    expect(result.documentType).toBe('passport');
    expect(result.birthYear).toBe(1990);
    expect(result.nationality).toBe('JAPAN');
    expect(result.documentNumber).toBe('TK1234567');
    expect(result.fullName.toUpperCase()).toContain('YAMADA');
  });

  it('calls Gemini only once when the first response is already valid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(JSON.stringify(validPayload)));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    const result = await service.processIdDocument('aGVsbG8=', 'image/jpeg');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.isIdDocument).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('treats plain text that is not JSON as unavailable', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => textResponse('Sorry, I cannot read this document.'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    await expect(service.processIdDocument('aGVsbG8=', 'image/jpeg')).rejects.toBeInstanceOf(IdOcrUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats braces around non-JSON text as unavailable instead of a SyntaxError', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => textResponse('{ this is not json }'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    await expect(service.processIdDocument('aGVsbG8=', 'image/jpeg')).rejects.toBeInstanceOf(IdOcrUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats JSON cut off by MAX_TOKENS as unavailable', async () => {
    const full = JSON.stringify(validPayload);
    // Cut inside the ocrText string, after the nested confidence object has closed,
    // so a "}" exists and the brace scan still finds a candidate payload.
    const truncated = full.slice(0, full.indexOf(OCR_SECRET) + 8);
    expect(truncated).toContain('}');
    const fetchMock = vi.fn().mockImplementation(async () => textResponse(truncated, 'MAX_TOKENS'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    await expect(service.processIdDocument('aGVsbG8=', 'image/jpeg')).rejects.toBeInstanceOf(IdOcrUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loggedText(errorSpy)).toContain('MAX_TOKENS');
  });

  it('treats JSON cut off before any closing brace as unavailable', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => textResponse('{"isIdDocument": true, "fullName": "Yama', 'MAX_TOKENS'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    await expect(service.processIdDocument('aGVsbG8=', 'image/jpeg')).rejects.toBeInstanceOf(IdOcrUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a JSON array as unavailable', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => textResponse('```json\n[1, 2, 3]\n```'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    await expect(service.processIdDocument('aGVsbG8=', 'image/jpeg')).rejects.toBeInstanceOf(IdOcrUnavailableError);
  });

  it('ignores thought parts and reads only the answer part', async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiResponse({
      candidates: [{
        finishReason: 'STOP',
        content: {
          parts: [
            // Would win the brace scan and yield a non-ID result if it were not dropped.
            { thought: true, text: 'Thinking {"isIdDocument": false, "fullName": "WRONG PERSON"} done.' },
            { text: JSON.stringify(validPayload) },
          ],
        },
      }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    const result = await service.processIdDocument('aGVsbG8=', 'image/jpeg');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.isIdDocument).toBe(true);
    expect(result.fullName.toUpperCase()).toContain('YAMADA');
    expect(result.fullName.toUpperCase()).not.toContain('WRONG');
  });

  it('is unavailable when the only parts are thoughts', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => geminiResponse({
      candidates: [{
        finishReason: 'MAX_TOKENS',
        content: { parts: [{ thought: true, text: JSON.stringify(validPayload) }] },
      }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    await expect(service.processIdDocument('aGVsbG8=', 'image/jpeg')).rejects.toBeInstanceOf(IdOcrUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after two 45 second timeouts without waiting on Gemini forever', async () => {
    vi.useFakeTimers();
    // AbortSignal.timeout runs on a runtime-internal timer that fake timers cannot
    // advance, so it is swapped for an equivalent signal driven by setTimeout.
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
      return controller.signal;
    });
    // A request that never answers and only settles when its signal aborts.
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      const signal = init.signal;
      if (!signal) return;
      signal.addEventListener('abort', () => reject(signal.reason));
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    let settled = false;
    const outcome = service.processIdDocument('aGVsbG8=', 'image/jpeg').then(
      (value) => { settled = true; return value as unknown; },
      (error: unknown) => { settled = true; return error; },
    );

    await vi.advanceTimersByTimeAsync(44_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(settled).toBe(true);
    expect(await outcome).toBeInstanceOf(IdOcrUnavailableError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 45_000);
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 45_000);
    expect(loggedText(errorSpy)).toMatch(/timed out/i);
  });

  it('passes an abort signal to every fetch call', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => emptyResponse());
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    await service.processIdDocument('aGVsbG8=', 'image/jpeg').catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('recovers when the first call times out and the second answers', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'))
      .mockResolvedValueOnce(textResponse(JSON.stringify(validPayload)));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    const result = await service.processIdDocument('aGVsbG8=', 'image/jpeg');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.isIdDocument).toBe(true);
  });

  it('sends JSON mode, an output cap and a zero thinking budget for gemini-2.5-flash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(JSON.stringify(validPayload)));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    await service.processIdDocument('aGVsbG8=', 'image/jpeg');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/gemini-2.5-flash:generateContent');
    const config = sentBody(fetchMock).generationConfig;
    expect(config.responseMimeType).toBe('application/json');
    expect(config.maxOutputTokens).toBe(8192);
    expect(config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(config.temperature).toBe(0.1);
  });

  it('sends the zero thinking budget for a 2.5 flash variant', async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(JSON.stringify(validPayload)));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash-lite');
    await service.processIdDocument('aGVsbG8=', 'image/jpeg');

    expect(sentBody(fetchMock).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it.each(['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-3-flash-preview'])(
    'omits thinkingConfig for %s but keeps JSON mode and the output cap',
    async (model) => {
      const fetchMock = vi.fn().mockResolvedValue(textResponse(JSON.stringify(validPayload)));
      vi.stubGlobal('fetch', fetchMock);

      const service = new IdProcessingService('test-key', model);
      await service.processIdDocument('aGVsbG8=', 'image/jpeg');

      const config = sentBody(fetchMock).generationConfig;
      expect(config).not.toHaveProperty('thinkingConfig');
      expect(config.responseMimeType).toBe('application/json');
      expect(config.maxOutputTokens).toBe(8192);
    },
  );

  it('sends the same request body on the retry', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => emptyResponse());
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    await service.processIdDocument('aGVsbG8=', 'image/jpeg').catch(() => undefined);

    expect(sentBody(fetchMock, 1)).toEqual(sentBody(fetchMock, 0));
  });

  it('logs diagnostics for a failed attempt without any OCR text', async () => {
    const full = JSON.stringify(validPayload);
    const truncated = full.slice(0, full.indexOf(OCR_SECRET) + OCR_SECRET.length);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(textResponse(truncated, 'MAX_TOKENS'))
      .mockResolvedValueOnce(textResponse(`Here is what I read: ${OCR_SECRET} Yamada Taro`));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    await expect(service.processIdDocument('aGVsbG8=', 'image/jpeg')).rejects.toBeInstanceOf(IdOcrUnavailableError);

    expect(errorSpy).toHaveBeenCalledTimes(2);
    const logged = loggedText(errorSpy);
    expect(logged).toContain('attempt 1/2');
    expect(logged).toContain('attempt 2/2');
    expect(logged).toContain('MAX_TOKENS');
    expect(logged).toContain('textLength');
    expect(logged).not.toContain(OCR_SECRET);
    expect(logged).not.toContain('TK1234567');
    expect(logged).not.toMatch(/yamada/i);
    expect(logged).not.toContain('test-key');
  });

  it('logs the block reason when the prompt is blocked', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => geminiResponse({ promptFeedback: { blockReason: 'SAFETY' } }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    await expect(service.processIdDocument('aGVsbG8=', 'image/jpeg')).rejects.toBeInstanceOf(IdOcrUnavailableError);
    expect(loggedText(errorSpy)).toContain('SAFETY');
  });

  it('lets a non-timeout HTTP failure through as a plain error, without retrying', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => geminiResponse('quota exceeded', 429));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    const error = await service.processIdDocument('aGVsbG8=', 'image/jpeg').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(IdOcrUnavailableError);
    expect((error as Error).message).toContain('429');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still requires an API key before calling out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('', 'gemini-2.5-flash');
    await expect(service.processIdDocument('aGVsbG8=', 'image/jpeg')).rejects.toThrow('Gemini API key is not configured.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps returning the mock result in test mode without calling fetch', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = new IdProcessingService('test-key', 'gemini-2.5-flash');
    const result = await service.processIdDocument('aGVsbG8=', 'image/jpeg');

    expect(result.isIdDocument).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
