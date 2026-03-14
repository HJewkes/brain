import type { OllamaClient } from './ollama.js';

const L0_SYSTEM = `You are a concise summarizer. Given a note's title and content, produce a single dense paragraph of approximately 100 tokens that captures the key concepts, entities, and relationships. This abstract will be used for vector similarity search, so include the most distinctive and searchable terms. Output only the abstract text, nothing else.`;

const L1_SYSTEM = `You are a structured summarizer. Given a note's title and content, produce a structured overview of approximately 500-800 words that preserves:
- Key concepts and definitions
- Important relationships and dependencies
- Notable decisions or conclusions
- Technical details worth preserving

Use markdown formatting with headers. Output only the overview, nothing else.`;

export interface AbstractResult {
  l0Abstract: string;
  l1Overview: string;
}

export async function generateAbstracts(
  ollama: OllamaClient,
  title: string,
  content: string
): Promise<AbstractResult> {
  const prompt = `Title: ${title}\n\nContent:\n${content}`;

  const [l0Abstract, l1Overview] = await Promise.all([
    ollama.generate(prompt, L0_SYSTEM),
    ollama.generate(prompt, L1_SYSTEM),
  ]);

  return { l0Abstract, l1Overview };
}

export async function generateL0Abstract(
  ollama: OllamaClient,
  title: string,
  content: string
): Promise<string> {
  const prompt = `Title: ${title}\n\nContent:\n${content}`;
  return ollama.generate(prompt, L0_SYSTEM);
}

export async function generateL1Overview(
  ollama: OllamaClient,
  title: string,
  content: string
): Promise<string> {
  const prompt = `Title: ${title}\n\nContent:\n${content}`;
  return ollama.generate(prompt, L1_SYSTEM);
}
