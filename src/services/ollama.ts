const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen2.5:3b';
const REQUEST_TIMEOUT_MS = 120_000;

interface OllamaGenerateResponse {
  response: string;
}

export interface OllamaHealthResult {
  running: boolean;
  models: string[];
}

export function hasModel(health: OllamaHealthResult, model: string): boolean {
  return health.models.some((m) => m === model || m.startsWith(model + ':'));
}

export async function requireOllama(
  ollamaUrl?: string,
  model?: string
): Promise<OllamaClient | null> {
  const resolvedModel = model ?? DEFAULT_MODEL;
  const health = await checkOllamaHealth(ollamaUrl);
  if (!health.running) {
    process.stderr.write(
      'Error: Ollama is not running. Start it with `ollama serve` or check `brain doctor`.\n'
    );
    process.exitCode = 1;
    return null;
  }
  if (!hasModel(health, resolvedModel)) {
    process.stderr.write(
      `Error: model "${resolvedModel}" not found. Run \`ollama pull ${resolvedModel}\`.\n`
    );
    process.exitCode = 1;
    return null;
  }
  return createOllamaClient(ollamaUrl, resolvedModel);
}

export async function checkOllamaHealth(url?: string): Promise<OllamaHealthResult> {
  const baseUrl = url ?? DEFAULT_URL;
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return { running: false, models: [] };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return {
      running: true,
      models: data.models?.map((m) => m.name) ?? [],
    };
  } catch {
    return { running: false, models: [] };
  }
}

export interface OllamaClient {
  generate(prompt: string, system?: string): Promise<string>;
  readonly model: string;
}

export function createOllamaClient(
  ollamaUrl?: string,
  model?: string
): OllamaClient {
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

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'TimeoutError') {
          throw new Error(
            `Ollama request timed out (${REQUEST_TIMEOUT_MS / 1000}s). The model may be loading. Try again.`
          );
        }
        const cause = (err as NodeJS.ErrnoException).cause as { code?: string } | undefined;
        if (cause?.code === 'ECONNREFUSED') {
          throw new Error(
            'Ollama is not running. Start it with `ollama serve` or check `brain doctor`.'
          );
        }
        throw new Error(
          `Ollama connection failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 404) {
          throw new Error(
            `Ollama model "${modelName}" not found. Run \`ollama pull ${modelName}\`.`
          );
        }
        throw new Error(`Ollama error (${res.status}): ${text}`);
      }

      const data = (await res.json()) as OllamaGenerateResponse;
      return data.response.trim();
    },
  };
}
