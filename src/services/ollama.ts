const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen2.5:3b';
const REQUEST_TIMEOUT_MS = 120_000;

interface OllamaGenerateResponse {
  response: string;
}

export interface OllamaClient {
  generate(prompt: string, system?: string): Promise<string>;
  readonly model: string;
}

export function createOllamaClient(ollamaUrl?: string, model?: string): OllamaClient {
  const baseUrl = ollamaUrl ?? DEFAULT_URL;
  const modelName = model ?? DEFAULT_MODEL;

  return {
    model: modelName,

    async generate(prompt: string, system?: string): Promise<string> {
      const body: Record<string, unknown> = {
        model: modelName,
        prompt,
        stream: false,
      };
      if (system) {
        body.system = system;
      }

      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama error (${res.status}): ${text}`);
      }

      const data = (await res.json()) as OllamaGenerateResponse;
      return data.response.trim();
    },
  };
}
