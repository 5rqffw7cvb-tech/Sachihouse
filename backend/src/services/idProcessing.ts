export type IdDocumentType = 'passport' | 'driver_license' | 'residence_card' | 'national_id' | 'unknown';

export interface IdProcessingResult {
  isIdDocument: boolean;
  rejectionReason?: string;
  documentType: IdDocumentType;
  fullName: string;
  birthYear: number | null;
  nationality: string;
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
      'IMPORTANT: All extracted text fields (fullName, nationality, address, gender, occupation, documentType, documentNumber) MUST be returned in English regardless of the document language.',
      'Transliterate names to Latin script if needed. Translate values such as nationality, gender, occupation to English.',
      'If value is missing, return empty string for text fields and null for birthYear.',
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

    const response = await fetch(`${GEMINI_URL}/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini request failed: ${response.status} ${body}`);
    }

    const body = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n') ?? '';
    const jsonPayload = extractJsonObject(text);
    if (!jsonPayload) {
      throw new Error('Gemini returned no JSON payload.');
    }

    const parsed = JSON.parse(jsonPayload) as Record<string, unknown>;
    const isIdDocument = Boolean(parsed.isIdDocument);

    return {
      isIdDocument,
      rejectionReason: normalizeString(parsed.rejectionReason) || undefined,
      documentType: toNormalizedDocumentType(parsed.documentType),
      fullName: normalizeString(parsed.fullName),
      birthYear: normalizeBirthYear(parsed.birthYear),
      nationality: normalizeString(parsed.nationality),
      address: normalizeString(parsed.address),
      gender: normalizeString(parsed.gender),
      occupation: normalizeString(parsed.occupation),
      documentNumber: normalizeString(parsed.documentNumber),
      confidence: {
        documentType: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.documentType),
        fullName: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.fullName),
        birthYear: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.birthYear),
        nationality: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.nationality),
        address: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.address),
        gender: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.gender),
        occupation: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.occupation),
        documentNumber: toConfidence((parsed.confidence as Record<string, unknown> | undefined)?.documentNumber),
      },
      ocrText: normalizeString(parsed.ocrText),
    };
  }
}
