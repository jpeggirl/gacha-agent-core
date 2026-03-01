/**
 * Normalize a card number for SKU computation.
 * - "050" → "50" (strip leading zeros)
 * - "215/203" → "215" (take numerator)
 * - "GG05" → "GG05" (keep special prefixes)
 * - "TG17/TG30" → "TG17" (take first part)
 * - "SV107/SV122" → "SV107" (take first part)
 */
export function normalizeCardNumber(num: string): string {
  const trimmed = num.trim();
  if (!trimmed) return '';

  // Special prefixed formats (TG, GG, SV) — keep prefix, take first part if "/"
  const specialMatch = trimmed.match(/^([A-Za-z]+\d+)/);
  if (specialMatch) {
    return specialMatch[1]!.toUpperCase();
  }

  // Standard numeric: take numerator of "215/203", strip leading zeros from "050"
  const parts = trimmed.split('/');
  const numerator = parts[0]!.replace(/^0+/, '') || '0';
  return numerator;
}

/**
 * Compute a deterministic Card SKU from set code and card number.
 * Format: "{setCode}-{normalizedNumber}" e.g. "swsh7-215"
 */
export function computeSKU(setCode: string, cardNumber: string): string {
  const code = setCode.toLowerCase().trim();
  const number = normalizeCardNumber(cardNumber);
  if (!code || !number) return '';
  return `${code}-${number}`;
}
