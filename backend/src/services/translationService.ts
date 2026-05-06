interface TranslationResult {
  [language: string]: string;
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

export class TranslationService {
  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY ?? '',
    private readonly model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  ) {}

  async translateText(
    text: string,
    targetLanguages: string[] = ['vi', 'ja', 'zh', 'ko'],
  ): Promise<TranslationResult> {
    if (process.env.NODE_ENV === 'test' || process.env.MOCK_GEMINI === 'true') {
      // Mock mode: return empty translations
      return {};
    }

    if (!this.apiKey || !text.trim()) {
      return {};
    }

    const langList = targetLanguages.join(', ');
    const prompt = [
      'You are a professional translator for property listings and hospitality content.',
      `Translate the following text to: ${langList}`,
      'Maintain the tone and formatting.',
      'Return ONLY valid JSON (no markdown) with language codes as keys.',
      'Example: { "vi": "...", "ja": "...", "zh": "...", "ko": "..." }',
      'If any language cannot be translated, use the original text.',
      '',
      `Text to translate: "${text}"`,
    ].join('\n');

    try {
      const response = await fetch(
        `${GEMINI_URL}/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.3,
            },
          }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        console.error(`Gemini translation failed: ${response.status} ${body}`);
        return {};
      }

      const body = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const text_content =
        body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n') ?? '';
      const jsonPayload = extractJsonObject(text_content);

      if (!jsonPayload) {
        console.error('Gemini translation returned no JSON payload');
        return {};
      }

      const parsed = JSON.parse(jsonPayload) as Record<string, unknown>;
      const result: TranslationResult = {};

      for (const lang of targetLanguages) {
        const translated = parsed[lang];
        if (typeof translated === 'string' && translated.trim()) {
          result[lang] = translated.trim();
        }
      }

      return result;
    } catch (error) {
      console.error('Translation service error:', error);
      return {};
    }
  }

  async translateMultipleFields(
    fields: Record<string, string>,
    targetLanguages: string[] = ['vi', 'ja', 'zh', 'ko'],
  ): Promise<Record<string, Record<string, string>>> {
    const results: Record<string, Record<string, string>> = {};

    for (const [fieldName, fieldValue] of Object.entries(fields)) {
      if (typeof fieldValue === 'string' && fieldValue.trim()) {
        results[fieldName] = await this.translateText(fieldValue, targetLanguages);
      }
    }

    return results;
  }
}
