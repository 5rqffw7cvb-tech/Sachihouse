export type IdDocumentType = 'passport' | 'driver_license' | 'residence_card' | 'national_id' | 'unknown';

export interface IdProcessingResult {
  isIdDocument: boolean;
  rejectionReason?: string;
  documentType: IdDocumentType;
  fullName: string;
  birthYear: number | null;
  nationality: string;
  inferredNationality?: boolean;
  address: string;
  gender: string;
  occupation: string;
  documentNumber: string;
  confidence: {
    documentType?: number;
    fullName?: number;
    birthYear?: number;
    nationality?: number;
    address?: number;
    gender?: number;
    occupation?: number;
    documentNumber?: number;
  };
  ocrText: string;
}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
// Worst case is GEMINI_MAX_ATTEMPTS * GEMINI_TIMEOUT_MS = 90s, which must stay under ~100s.
const GEMINI_TIMEOUT_MS = 45_000;
const GEMINI_MAX_ATTEMPTS = 2;
const GEMINI_MAX_OUTPUT_TOKENS = 8192;

// Thrown when Gemini gave no usable JSON (empty, truncated, or timed out) after all attempts.
export class IdOcrUnavailableError extends Error {
  constructor(message = 'ID document OCR is temporarily unavailable.') {
    super(message);
    this.name = 'IdOcrUnavailableError';
  }
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function toNormalizedDocumentType(value: unknown): IdDocumentType {
  if (typeof value !== 'string') {
    return 'unknown';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.includes('passport')) {
    return 'passport';
  }
  if (normalized.includes('driver')) {
    return 'driver_license';
  }
  if (normalized.includes('residence') || normalized.includes('alien')) {
    return 'residence_card';
  }
  if (normalized.includes('national') || normalized.includes('id card') || normalized === 'id') {
    return 'national_id';
  }
  return 'unknown';
}

function toConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAsciiUpper(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function normalizeBirthYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 1900 && value <= new Date().getFullYear()) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 1900 && parsed <= new Date().getFullYear()) {
      return parsed;
    }
  }
  return null;
}

function normalizeNationality(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'unknown' || normalized === 'n/a' || normalized === 'na') {
    return '';
  }

  const map: Array<{ keywords: string[]; output: string }> = [
    { keywords: ['united states', 'u.s.a', 'usa', 'u.s.', 'american'], output: 'USA' },
    { keywords: ['canada', 'canadian'], output: 'CANADA' },
    { keywords: ['japan', 'japanese'], output: 'JAPAN' },
    { keywords: ['vietnam', 'vietnamese', 'viet nam'], output: 'VIETNAM' },
    { keywords: ['korea', 'south korea', 'korean'], output: 'SOUTH KOREA' },
    { keywords: ['china', 'chinese', 'people\'s republic of china', 'prc'], output: 'CHINA' },
    { keywords: ['taiwan'], output: 'TAIWAN' },
    { keywords: ['united kingdom', 'uk', 'british'], output: 'UNITED KINGDOM' },
    { keywords: ['australia', 'australian'], output: 'AUSTRALIA' },
    { keywords: ['singapore'], output: 'SINGAPORE' },
  ];

  for (const entry of map) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return entry.output;
    }
  }

  return value.trim().toUpperCase();
}

function inferNationalityFromContext(params: {
  documentType: IdDocumentType;
  nationality: string;
  address: string;
  ocrText: string;
}): { nationality: string; inferred: boolean } {
  const direct = normalizeNationality(params.nationality);
  if (direct) {
    return { nationality: direct, inferred: false };
  }

  const haystack = `${params.address} ${params.ocrText}`.toLowerCase();
  const signals: Array<{ keywords: string[]; output: string }> = [
    { keywords: ['united states', 'usa', 'u.s.a', 'new york', 'california', 'texas', 'florida', 'driver license'], output: 'USA' },
    { keywords: ['japan', 'tokyo', 'osaka', 'japanese'], output: 'JAPAN' },
    { keywords: ['vietnam', 'ho chi minh', 'hanoi', 'da nang'], output: 'VIETNAM' },
    { keywords: ['korea', 'seoul', 'busan'], output: 'SOUTH KOREA' },
    { keywords: ['china', 'beijing', 'shanghai', 'guangzhou'], output: 'CHINA' },
    { keywords: ['taiwan', 'taipei', 'kaohsiung'], output: 'TAIWAN' },
    { keywords: ['canada', 'toronto', 'vancouver', 'ontario'], output: 'CANADA' },
    { keywords: ['australia', 'sydney', 'melbourne'], output: 'AUSTRALIA' },
    { keywords: ['united kingdom', 'uk', 'london', 'manchester'], output: 'UNITED KINGDOM' },
  ];

  for (const signal of signals) {
    if (signal.keywords.some((keyword) => haystack.includes(keyword))) {
      return { nationality: signal.output, inferred: true };
    }
  }

  // For non-passport IDs we allow a best-effort guess when country hints exist in OCR text/address.
  if (params.documentType === 'driver_license' || params.documentType === 'national_id' || params.documentType === 'residence_card') {
    if (haystack.includes('united states') || haystack.includes('usa')) {
      return { nationality: 'USA', inferred: true };
    }
  }

  return { nationality: '', inferred: false };
}

function createMockResult(): IdProcessingResult {
  return {
    isIdDocument: true,
    documentType: 'passport',
    fullName: 'GUEST SAMPLE',
    birthYear: 1990,
    nationality: 'UNKNOWN',
    address: 'NA',
    gender: 'UNSPECIFIED',
    occupation: 'TRAVELER',
    documentNumber: 'UNKNOWN',
    confidence: {
      documentType: 0.7,
      fullName: 0.5,
      birthYear: 0.4,
      nationality: 0.3,
      address: 0.2,
      gender: 0.2,
      occupation: 0.2,
      documentNumber: 0.2,
    },
    ocrText: 'Mock OCR result for test mode.',
  };
}

export class IdProcessingService {
  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY ?? '',
    private readonly model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  ) {}

  async processIdDocument(imageBase64: string, mimeType: string): Promise<IdProcessingResult> {
    if (process.env.NODE_ENV === 'test' || process.env.MOCK_GEMINI === 'true') {
      return createMockResult();
    }

    if (!this.apiKey) {
      throw new Error('Gemini API key is not configured.');
    }

    const prompt = [
      'You are an OCR + document classification engine.',
      'Classify whether the image is a valid government ID document (passport, driver license, residence card, national id).',
      'If not an ID document, set isIdDocument=false and include rejectionReason.',
      'If it is an ID, run OCR and extract fullName, birthYear, nationality, address, gender, occupation, documentNumber, documentType.',
      'If nationality is not explicitly present, infer probable nationality from document context (issuing country signals, address, region, government labels).',
      'Example: a US driver license/address in the United States can infer nationality as USA.',
      'IMPORTANT: All extracted text fields (fullName, nationality, address, gender, occupation, documentType, documentNumber) MUST be returned in English regardless of the document language.',
      'Transliterate names to Latin script if needed. Translate values such as nationality, gender, occupation to English.',
      'The "address" field MUST NEVER be empty. Many documents (e.g. passports) carry no residential address — in that case infer a best-effort address: use the holder\'s place of birth if shown, otherwise the issuing country\'s capital city. Format as "City, Country". A reasonable guess is acceptable, but never leave address empty or return NA/UNKNOWN for it.',
      'If value is missing and cannot be inferred, return empty string for text fields (except address, see above) and null for birthYear.',
      'Return strict JSON only with this schema:',
      '{',
      '  "isIdDocument": boolean,',
      '  "rejectionReason": string,',
      '  "documentType": string,',
      '  "fullName": string,',
      '  "birthYear": number | null,',
      '  "nationality": string,',
      '  "address": string,',
      '  "gender": string,',
      '  "occupation": string,',
      '  "documentNumber": string,',
      '  "confidence": {',
      '    "documentType": number,',
      '    "fullName": number,',
      '    "birthYear": number,',
      '    "nationality": number,',
      '    "address": number,',
      '    "gender": number,',
      '    "occupation": number,',
      '    "documentNumber": number',
      '  },',
      '  "ocrText": string',
      '}',
      'No explanation, no markdown.',
    ].join('\n');

    const requestBody = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        // thinkingBudget: 0 is only accepted by the 2.5 flash family; other models reject it
        // (2.5-pro cannot disable thinking, newer models use a different field), so it is
        // sent only when GEMINI_MODEL is one of those.
        ...(/gemini-2\.5-flash/i.test(this.model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });

    let parsed: Record<string, unknown> | null = null;
    for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS && !parsed; attempt += 1) {
      parsed = await this.requestIdJson(requestBody, attempt);
    }
    if (!parsed) {
      throw new IdOcrUnavailableError();
    }

    const isIdDocument = Boolean(parsed.isIdDocument);
    const documentType = toNormalizedDocumentType(parsed.documentType);
    const address = normalizeString(parsed.address);
    const ocrText = normalizeString(parsed.ocrText);

    const inferredNationalityResult = inferNationalityFromContext({
      documentType,
      nationality: normalizeString(parsed.nationality),
      address,
      ocrText,
    });

    const originalNationalityConfidence = toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.nationality);
    const normalizedNationalityConfidence = inferredNationalityResult.inferred
      ? Math.max(originalNationalityConfidence ?? 0, 0.45)
      : originalNationalityConfidence;

    return {
      isIdDocument,
      rejectionReason: normalizeString(parsed.rejectionReason) || undefined,
      documentType,
      fullName: normalizeAsciiUpper(normalizeString(parsed.fullName)),
      birthYear: normalizeBirthYear(parsed.birthYear),
      nationality: inferredNationalityResult.nationality,
      inferredNationality: inferredNationalityResult.inferred,
      address: normalizeAsciiUpper(address),
      gender: normalizeAsciiUpper(normalizeString(parsed.gender)),
      occupation: normalizeAsciiUpper(normalizeString(parsed.occupation)),
      documentNumber: normalizeString(parsed.documentNumber),
      confidence: {
        documentType: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.documentType),
        fullName: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.fullName),
        birthYear: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.birthYear),
        nationality: normalizedNationalityConfidence,
        address: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.address),
        gender: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.gender),
        occupation: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.occupation),
        documentNumber: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.documentNumber),
      },
      ocrText,
    };
  }

  // One Gemini call. Returns the parsed JSON object, or null when the call produced no usable
  // JSON (empty, truncated/unparseable, or timed out) so the caller can retry.
  private async requestIdJson(requestBody: string, attempt: number): Promise<Record<string, unknown> | null> {
    let body: {
      candidates?: Array<{
        finishReason?: string;
        content?: {
          parts?: Array<{ text?: string; thought?: boolean }>;
        };
      }>;
      promptFeedback?: { blockReason?: string };
      usageMetadata?: unknown;
    };

    try {
      const response = await fetch(`${GEMINI_URL}/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: requestBody,
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini request failed: ${response.status} ${errorBody}`);
      }

      body = await response.json() as typeof body;
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name !== 'TimeoutError' && name !== 'AbortError') {
        throw error;
      }
      console.error(`[Gemini ID OCR] attempt ${attempt}/${GEMINI_MAX_ATTEMPTS} timed out after ${GEMINI_TIMEOUT_MS}ms`);
      return null;
    }

    // Thinking models return thought parts alongside the actual output; skip them.
    const text = body.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text ?? '')
      .join('\n') ?? '';

    let reason = 'no JSON payload';
    const jsonPayload = extractJsonObject(text);
    if (jsonPayload) {
      try {
        const parsed: unknown = JSON.parse(jsonPayload);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
        reason = 'JSON payload is not an object';
      } catch {
        reason = 'invalid JSON payload';
      }
    }

    // Never log the text itself: it is OCR output of a personal ID document.
    console.error(`[Gemini ID OCR] attempt ${attempt}/${GEMINI_MAX_ATTEMPTS} failed: ${reason}`, JSON.stringify({
      finishReason: body.candidates?.[0]?.finishReason ?? null,
      blockReason: body.promptFeedback?.blockReason ?? null,
      usageMetadata: body.usageMetadata ?? null,
      textLength: text.length,
    }));
    return null;
  }
}
