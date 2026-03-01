import type { Grader } from '../types/index.js';

// eBay Professional Grader aspect_filter values
export const EBAY_GRADER_MAP: Record<Grader, string> = {
  PSA: 'PSA',
  BGS: 'Beckett (BGS)',
  CGC: 'CGC',
  SGC: 'SGC',
};

/**
 * Returns regexes to match the requested grader and competing graders in listing titles.
 * `requested` matches the user's grader; `competing` matches all others.
 */
export function graderTitleRegex(grader: Grader): { requested: RegExp; competing: RegExp } {
  const graderPatterns: Record<Grader, string> = {
    PSA: 'PSA',
    BGS: 'BGS|Beckett',
    CGC: 'CGC',
    SGC: 'SGC',
  };

  const requested = new RegExp(`\\b(${graderPatterns[grader]})\\b`, 'i');

  const competingParts = (Object.keys(graderPatterns) as Grader[])
    .filter((g) => g !== grader)
    .map((g) => graderPatterns[g]);
  const competing = new RegExp(`\\b(${competingParts.join('|')})\\b`, 'i');

  return { requested, competing };
}

/**
 * Returns a regex matching negation patterns for a grader, e.g. "not PSA", "no PSA", "non-PSA".
 */
export function graderNegationRegex(grader: Grader): RegExp {
  const graderPatterns: Record<Grader, string> = {
    PSA: 'PSA',
    BGS: 'BGS|Beckett',
    CGC: 'CGC',
    SGC: 'SGC',
  };
  return new RegExp(`\\b(not|no|non[-\\s]?)\\s*(${graderPatterns[grader]})\\b`, 'i');
}

/**
 * Display helper: formatGradeLabel('BGS', 9.5) => 'BGS 9.5'
 */
export function formatGradeLabel(grader: Grader, grade: number): string {
  return `${grader} ${grade}`;
}
