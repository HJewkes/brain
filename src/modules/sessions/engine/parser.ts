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

  let byteOffset = 0;
  for await (const line of rl) {
    const trimmed = line.trim();
    const lineBytes = Buffer.byteLength(line, 'utf-8') + 1; // +1 for \n
    if (!trimmed) {
      byteOffset += lineBytes;
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      byteOffset += lineBytes;
      continue;
    }
    acc.ingest(event, byteOffset);
    byteOffset += lineBytes;
  }

  return acc.finalize();
}
