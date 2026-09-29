/**
 * Quem responde à diretora. O jogo não depende de nenhum provedor: qualquer coisa que implemente
 * LlmClient serve (API compatível com OpenAI, modelo local, ou respostas gravadas nos testes).
 */

export interface LlmClient {
  /** Recebe o texto do pedido e devolve a resposta do modelo (texto). */
  complete(prompt: string): Promise<string>;
}

/** Hash curto e estável do pedido (FNV-1a 32 bits), usado para achar a resposta gravada. */
export function promptKey(prompt: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < prompt.length; i++) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Respostas gravadas (para testes): sempre a mesma resposta para o mesmo pedido, sem internet.
 * `fallback` responde quando o pedido não foi gravado (se faltar, dá erro dizendo a chave).
 */
export class RecordedClient implements LlmClient {
  constructor(
    private responses: Record<string, string>,
    private fallback?: string,
  ) {}

  async complete(prompt: string): Promise<string> {
    const key = promptKey(prompt);
    // A chave "*" no arquivo vale para qualquer pedido.
    const r = this.responses[key] ?? this.fallback ?? this.responses["*"];
    if (r === undefined) throw new Error(`resposta gravada não encontrada para o pedido ${key}`);
    return r;
  }
}

/** Grava as respostas de outro cliente (para gerar o arquivo usado pelo RecordedClient). */
export class RecordingClient implements LlmClient {
  readonly recorded: Record<string, string> = {};
  constructor(private inner: LlmClient) {}

  async complete(prompt: string): Promise<string> {
    const r = await this.inner.complete(prompt);
    this.recorded[promptKey(prompt)] = r;
    return r;
  }
}

export interface OpenAiCompatibleOptions {
  /** Ex.: https://openrouter.ai/api/v1 ou http://localhost:11434/v1 (Ollama). */
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  temperature?: number;
}

/** Qualquer API no formato "chat completions" da OpenAI (OpenRouter, Ollama, LM Studio, etc.). */
export class OpenAiCompatibleClient implements LlmClient {
  constructor(private opts: OpenAiCompatibleOptions) {}

  async complete(prompt: string): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 60_000);
    try {
      const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.opts.model,
          temperature: this.opts.temperature ?? 0.7,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`LLM respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("resposta do LLM sem texto");
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}
