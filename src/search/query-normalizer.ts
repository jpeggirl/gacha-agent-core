import type { SetAliasRegistry } from './set-aliases.js';

export interface ParsedQuery {
  cardName: string | null;
  cardNumber: string | null;
  setHints: string[];
  variant: string | null;
  grade: number | null;
  grader: string | null;
  year: number | null;
  rawCleaned: string;
}

/**
 * Variant tokens we recognize and extract from queries.
 */
const VARIANT_TOKENS = [
  'alt art', 'alternate art',
  'full art', 'fa',
  'shadowless',
  '1st edition', 'first edition',
  'reverse holo', 'reverse',
  'rainbow rare', 'rainbow',
  'gold', 'gold star',
  'shiny',
  'illustration rare', 'ir',
  'special art rare', 'sar',
  'trainer gallery', 'tg',
];

const FRANCHISE_NOISE = /\bpokemon\b/gi;

const ERA_PREFIXES = [
  'sword & shield', 'sword and shield',
  'scarlet & violet', 'scarlet and violet',
  'sun & moon', 'sun and moon',
  'black & white', 'black and white',
  'diamond & pearl', 'diamond and pearl',
  'heartgold & soulsilver', 'heartgold and soulsilver',
];

const SEARCH_NOISE = /\b(prices?|values?|worth|how much|what is|what's)\b/gi;

/**
 * Parse a raw user query into structured components.
 * Extracts grade, grader, year, card number, set hints, variant, and card name.
 */
export function parseQuery(raw: string, registry?: SetAliasRegistry): ParsedQuery {
  let text = raw.trim();
  let grade: number | null = null;
  let grader: string | null = null;
  let year: number | null = null;
  let cardNumber: string | null = null;
  let variant: string | null = null;
  const setHints: string[] = [];

  // 1. Extract grade + grader: "PSA 10", "BGS 9.5", "CGC 8"
  const gradeMatch = text.match(/\b(psa|bgs|cgc|sgc)\s*(\d+(?:\.\d+)?)\b/i);
  if (gradeMatch) {
    grader = gradeMatch[1]!.toUpperCase();
    grade = parseFloat(gradeMatch[2]!);
    text = text.replace(gradeMatch[0], ' ');
  }

  // Also extract standalone grader mentions without a number
  if (!grader) {
    const standaloneGrader = text.match(/\b(psa|bgs|cgc|sgc)\b/i);
    if (standaloneGrader) {
      grader = standaloneGrader[1]!.toUpperCase();
      text = text.replace(standaloneGrader[0], ' ');
    }
  }

  // 2. Extract year: 4-digit year in 1900-2099 range
  const yearMatch = text.match(/\b((?:19|20)\d{2})\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1]!, 10);
    text = text.replace(yearMatch[0], ' ');
  }

  // 3. Extract card number: "#215", "215/203", "GG05", "TG17/TG30"
  // Try special formats first
  const tgMatch = text.match(/\b(TG\d{1,3}\/TG\d{1,3})\b/i);
  if (tgMatch) {
    cardNumber = tgMatch[1]!.toUpperCase();
    text = text.replace(tgMatch[0], ' ');
  }

  if (!cardNumber) {
    const ggMatch = text.match(/\b(GG\d{1,3})\b/i);
    if (ggMatch) {
      cardNumber = ggMatch[1]!.toUpperCase();
      text = text.replace(ggMatch[0], ' ');
    }
  }

  if (!cardNumber) {
    const svMatch = text.match(/\b(SV\d{1,4})(\/SV\d{1,4})?\b/i);
    if (svMatch) {
      cardNumber = svMatch[1]!.toUpperCase();
      // Remove the full match including optional /SV suffix
      text = text.replace(svMatch[0], ' ');
    }
  }

  if (!cardNumber) {
    // Standard number format: #215, 215/203, or bare 215 (2+ digits, avoids single-digit grades)
    const numMatch = text.match(/#?(\d{1,4}(?:\/\d{1,4})?)\b/);
    if (numMatch) {
      const num = numMatch[1]!;
      // Avoid extracting single-digit or double-digit numbers that might be grades
      // unless they have a "#" prefix or "/" in them
      const hasHash = numMatch[0].startsWith('#');
      const hasSlash = num.includes('/');
      const isLikelyCardNumber = hasHash || hasSlash || parseInt(num, 10) >= 11;
      if (isLikelyCardNumber) {
        cardNumber = num;
        text = text.replace(numMatch[0], ' ');
      }
    }
  }

  // 4. Strip franchise noise
  text = text.replace(FRANCHISE_NOISE, ' ');

  // 5. Strip search noise
  text = text.replace(SEARCH_NOISE, ' ');

  // 6. Extract variants (longest match first)
  const sortedVariants = [...VARIANT_TOKENS].sort((a, b) => b.length - a.length);
  for (const v of sortedVariants) {
    const vRegex = new RegExp(`\\b${escapeRegex(v)}\\b`, 'i');
    if (vRegex.test(text)) {
      variant = v.toUpperCase();
      text = text.replace(vRegex, ' ');
      break;
    }
  }

  // 7. Strip era prefixes from remaining text
  let remaining = text.replace(/\s+/g, ' ').trim().toLowerCase();
  for (const prefix of ERA_PREFIXES) {
    if (remaining.startsWith(prefix + ' ') || remaining === prefix) {
      remaining = remaining.slice(prefix.length).trim();
    }
  }

  // 8. Try set alias lookup to separate set name from card name
  if (registry) {
    const words = remaining.split(/\s+/).filter(Boolean);
    // Try longest subsequences first to match multi-word set names
    for (let len = Math.min(words.length, 5); len >= 1; len--) {
      for (let start = 0; start <= words.length - len; start++) {
        const candidate = words.slice(start, start + len).join(' ');
        const match = registry.lookup(candidate);
        if (match) {
          setHints.push(match.canonicalName);
          // Remove matched words from remaining
          words.splice(start, len);
          remaining = words.join(' ');
          break;
        }
      }
      if (setHints.length > 0) break;
    }
  }

  // 9. Clean up remaining text → card name
  remaining = remaining
    .replace(/[/]/g, ' ')  // split remaining "/" separators
    .replace(/\s+/g, ' ')
    .trim();

  const cardName = remaining || null;

  // 10. Build rawCleaned — the cleaned string for fallback term-based search
  const rawCleanedParts: string[] = [];
  if (cardName) rawCleanedParts.push(cardName);
  if (cardNumber) rawCleanedParts.push(cardNumber);
  for (const hint of setHints) rawCleanedParts.push(hint);
  if (variant) rawCleanedParts.push(variant);
  const rawCleaned = rawCleanedParts.join(' ').replace(/\s+/g, ' ').trim();

  return {
    cardName,
    cardNumber,
    setHints,
    variant,
    grade,
    grader,
    year,
    rawCleaned,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
