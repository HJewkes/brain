/**
 * Vocabulary table for fuzzy query correction.
 *
 * Extracts distinctive terms at index time, scores them by IDF + length bonus
 * + identifier bonus, and uses Levenshtein distance to correct misspelled
 * search queries before BM25 lookup.
 */

const MIN_TERM_LENGTH = 3;
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'are',
  'but',
  'not',
  'you',
  'all',
  'can',
  'had',
  'her',
  'was',
  'one',
  'our',
  'out',
  'has',
  'his',
  'how',
  'its',
  'may',
  'new',
  'now',
  'old',
  'see',
  'way',
  'who',
  'did',
  'get',
  'let',
  'say',
  'she',
  'too',
  'use',
  'will',
  'with',
  'this',
  'that',
  'from',
  'they',
  'been',
  'have',
  'many',
  'some',
  'them',
  'than',
  'each',
  'which',
  'their',
  'there',
  'these',
  'would',
  'about',
  'could',
  'other',
  'into',
  'more',
  'also',
  'back',
  'when',
  'only',
  'come',
  'over',
  'such',
  'take',
  'than',
  'very',
  'what',
  'just',
]);

/**
 * Extract distinctive terms from text content.
 * Returns a set of unique terms.
 */
export function extractTerms(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const terms = new Set<string>();

  for (const word of words) {
    if (word.length < MIN_TERM_LENGTH) continue;
    if (STOP_WORDS.has(word)) continue;
    terms.add(word);
  }

  return terms;
}

/**
 * Check if a term looks like a code identifier (camelCase, snake_case, etc.)
 */
function isIdentifier(term: string): boolean {
  return /[_-]/.test(term) || /[a-z][A-Z]/.test(term);
}

/**
 * Score a term by IDF + length bonus + identifier bonus.
 * Higher score = more distinctive/valuable for correction.
 */
export function scoreTerm(term: string, docFrequency: number, totalDocs: number): number {
  const idf = totalDocs > 0 ? Math.log(totalDocs / (docFrequency + 1)) + 1 : 1;
  const lengthBonus = Math.min(term.length / 10, 1);
  const identifierBonus = isIdentifier(term) ? 0.5 : 0;

  return idf + lengthBonus + identifierBonus;
}

/**
 * Compute Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Adaptive max edit distance based on word length.
 * Shorter words tolerate fewer errors.
 */
export function maxEditDistance(wordLength: number): number {
  if (wordLength <= 4) return 1;
  if (wordLength <= 12) return 2;
  return 3;
}

export interface VocabEntry {
  term: string;
  docFrequency: number;
  score: number;
}

/**
 * Find the best correction for a single query term.
 * Returns the original term if no close match is found.
 */
export function findCorrection(term: string, vocabulary: VocabEntry[]): string {
  const lower = term.toLowerCase();
  const maxDist = maxEditDistance(lower.length);

  let bestMatch: string | null = null;
  let bestScore = -Infinity;
  let bestDist = maxDist + 1;

  for (const entry of vocabulary) {
    if (Math.abs(entry.term.length - lower.length) > maxDist) continue;

    const dist = levenshtein(lower, entry.term);
    if (dist === 0) return term;
    if (dist > maxDist) continue;

    if (dist < bestDist || (dist === bestDist && entry.score > bestScore)) {
      bestDist = dist;
      bestScore = entry.score;
      bestMatch = entry.term;
    }
  }

  return bestMatch ?? term;
}

/**
 * Correct a full search query by fixing misspelled terms.
 * Returns the corrected query string.
 */
export function correctQuery(
  query: string,
  vocabulary: VocabEntry[]
): { corrected: string; didCorrect: boolean } {
  const words = query.split(/\s+/).filter(Boolean);
  let didCorrect = false;

  const correctedWords = words.map((word) => {
    if (word.length < MIN_TERM_LENGTH) return word;

    const correction = findCorrection(word, vocabulary);
    if (correction !== word.toLowerCase() && correction !== word) {
      didCorrect = true;
      return correction;
    }
    return word;
  });

  return {
    corrected: correctedWords.join(' '),
    didCorrect,
  };
}
