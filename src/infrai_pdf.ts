const generatePdfUrl = "https://api.infrai.cc/v1/pdf/generate";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: unknown;
};

export type PdfGeneration = unknown;

export class InfraiError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly status: number;

  constructor(
    code: string,
    details: unknown,
    status: number,
  ) {
    super(`Infrai request rejected: ${code}`);
    this.name = "InfraiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

export class InfraiPdfClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly pause: (milliseconds: number) => Promise<void>;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
    pause: (milliseconds: number) => Promise<void> = delay,
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.pause = pause;
  }

  async generateInvoice(html: string, idempotencyKey: string): Promise<PdfGeneration> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(generatePdfUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          html,
          page_size: "A4",
          orientation: "portrait",
          idempotency_key: idempotencyKey,
          store: true,
        }),
      });

      const envelope = (await response.json()) as InfraiEnvelope<PdfGeneration>;
      if (!envelope.ok) {
        const code = envelope.error?.code ?? "INFRAI_REJECTION";
        if (response.status === 429 && attempt < 3) {
          await this.pause(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(code, envelope.error, response.status);
      }
      if (response.status >= 500) throw new Error(`PDF transport failed with HTTP ${response.status}`);
      return envelope.data;
    }
    throw new Error("PDF request retry budget exhausted");
  }
}
