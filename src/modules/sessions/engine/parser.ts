import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { SessionAnalytics } from '../types.js';
import { AnalyticsAccumulator } from './accumulator.js';

export async function parseSessionFile(filePath: string): Promise<SessionAnalytics> {
  const acc = new AnalyticsAccumulator();

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    acc.ingest(event);
  }

  return acc.finalize();
}
