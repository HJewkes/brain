import { openSync, readSync, closeSync, statSync, existsSync } from 'node:fs';

const MAX_CHUNK_BYTES = 64 * 1024; // 64KB
const MAX_LINES = 50;

export interface JsonlSeekResult {
  events: unknown[];
  bytesRead: number;
  nextOffset: number;
}

export interface JsonlSeekError {
  error: string;
  code: 'NOT_FOUND' | 'OFFSET_OUT_OF_RANGE' | 'READ_ERROR';
}

export type JsonlSeekOutcome =
  | { ok: true; value: JsonlSeekResult }
  | { ok: false; value: JsonlSeekError };

export function seekJsonlFile(
  filePath: string,
  offset: number,
  lineCount: number
): JsonlSeekOutcome {
  if (!existsSync(filePath)) {
    return { ok: false, value: { error: `File not found: ${filePath}`, code: 'NOT_FOUND' } };
  }

  const stat = statSync(filePath);
  if (offset >= stat.size) {
    return { ok: false, value: { error: 'Offset past end of file', code: 'OFFSET_OUT_OF_RANGE' } };
  }

  const clampedLines = Math.min(lineCount, MAX_LINES);
  const chunkSize = Math.min(MAX_CHUNK_BYTES, stat.size - offset);
  const buf = Buffer.alloc(chunkSize);

  let fd: number;
  try {
    fd = openSync(filePath, 'r');
  } catch (e) {
    return { ok: false, value: { error: `Cannot open file: ${String(e)}`, code: 'READ_ERROR' } };
  }

  try {
    readSync(fd, buf, 0, chunkSize, offset);
  } finally {
    closeSync(fd);
  }

  const text = buf.toString('utf-8');
  const rawLines = text.split('\n');

  const events: unknown[] = [];
  let bytesRead = 0;

  for (let i = 0; i < rawLines.length && events.length < clampedLines; i++) {
    const line = rawLines[i];
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
      bytesRead += Buffer.byteLength(line, 'utf-8') + 1; // +1 for \n
    } catch {
      break;
    }
  }

  return { ok: true, value: { events, bytesRead, nextOffset: offset + bytesRead } };
}
