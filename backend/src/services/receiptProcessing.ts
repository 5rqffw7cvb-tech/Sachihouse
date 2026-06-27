export interface ReceiptOcrResult {
  transactionDate?: string;  // YYYY-MM-DD
  amount?: number;
  vendor?: string;
  description?: string;
  suggestedDebitAccount?: string;
}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

const RECEIPT_PROMPT = `
You are a Japanese receipt/invoice OCR assistant.
Extract the following fields from this receipt image and return ONLY a JSON object:

{
  "transactionDate": "YYYY-MM-DD or null",
  "amount": <integer JPY or null>,
  "vendor": "<vendor name or null>",
  "description": "<short memo in Japanese or null>",
  "suggestedDebitAccount": "<one of the accounts below or null>"
}

Account options for suggestedDebitAccount (pick the best match):
売上高, 受取手数料, 雑収入, 消耗品費, 旅費交通費, 接待交際費, 通信費, 水道光熱費,
地代家賃, 外注費, 修繕費, 広告宣伝費, 支払手数料, 保険料, 減価償却費, 雑費,
普通預金, 現金, 売掛金, 買掛金, 未払金, 前払費用

Rules:
- transactionDate: extract the payment date, format as YYYY-MM-DD. If year is missing assume current year.
- amount: the total amount paid in JPY (integer). Ignore tax breakdowns, use the final total.
- vendor: the company or shop name issuing the receipt.
- description: a brief Japanese memo summarizing what was purchased.
- suggestedDebitAccount: infer from vendor/item type. For transportation use 旅費交通費, utilities use 水道光熱費, office supplies use 消耗品費, entertainment use 接待交際費, etc.
- Return null for any field you cannot determine with confidence.
`;

export class ReceiptProcessingService {
  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY ?? '',
    private readonly model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  ) {}

  async processReceipt(imageBase64: string, mimeType: string): Promise<ReceiptOcrResult> {
    if (!this.apiKey) return {};

    try {
      const response = await fetch(
        `${GEMINI_URL}/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: RECEIPT_PROMPT },
                { inlineData: { mimeType, data: imageBase64 } },
              ],
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
          }),
        },
      );

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error('[Gemini OCR] API error:', response.status, response.statusText, errBody.slice(0, 300));
        return {};
      }

      const data = await response.json() as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      };

      // Thinking models (gemini-2.5-flash) return thought parts first, then the actual output.
      // Skip parts with thought:true and use the first non-thought part.
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const outputPart = parts.find((p) => !p.thought) ?? parts[0];
      const text = outputPart?.text ?? '';

      console.log('[Gemini OCR] raw text:', text.slice(0, 400));
      const jsonStr = extractJson(text);
      if (!jsonStr) {
        console.warn('[Gemini OCR] no JSON found in response, full text length:', text.length);
        return {};
      }

      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

      return {
        transactionDate: typeof parsed.transactionDate === 'string' && parsed.transactionDate !== 'null'
          ? parsed.transactionDate : undefined,
        amount: typeof parsed.amount === 'number' ? parsed.amount : undefined,
        vendor: typeof parsed.vendor === 'string' && parsed.vendor !== 'null' ? parsed.vendor : undefined,
        description: typeof parsed.description === 'string' && parsed.description !== 'null'
          ? parsed.description : undefined,
        suggestedDebitAccount: typeof parsed.suggestedDebitAccount === 'string'
          && parsed.suggestedDebitAccount !== 'null' ? parsed.suggestedDebitAccount : undefined,
      };
    } catch (err) {
      console.error('[Gemini OCR] exception:', err);
      return {};
    }
  }
}
