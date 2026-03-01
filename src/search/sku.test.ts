import { describe, it, expect } from 'vitest';
import { computeSKU, normalizeCardNumber } from './sku.js';

describe('normalizeCardNumber', () => {
  it('strips leading zeros: "050" → "50"', () => {
    expect(normalizeCardNumber('050')).toBe('50');
  });

  it('takes numerator of fraction: "215/203" → "215"', () => {
    expect(normalizeCardNumber('215/203')).toBe('215');
  });

  it('takes numerator of fraction: "4/102" → "4"', () => {
    expect(normalizeCardNumber('4/102')).toBe('4');
  });

  it('preserves TG prefix: "TG17/TG30" → "TG17"', () => {
    expect(normalizeCardNumber('TG17/TG30')).toBe('TG17');
  });

  it('preserves GG prefix: "GG05" → "GG05"', () => {
    expect(normalizeCardNumber('GG05')).toBe('GG05');
  });

  it('preserves SV prefix: "SV107/SV122" → "SV107"', () => {
    expect(normalizeCardNumber('SV107/SV122')).toBe('SV107');
  });

  it('handles single digit: "4" → "4"', () => {
    expect(normalizeCardNumber('4')).toBe('4');
  });

  it('handles "0" → "0"', () => {
    expect(normalizeCardNumber('000')).toBe('0');
  });

  it('returns empty for empty string', () => {
    expect(normalizeCardNumber('')).toBe('');
  });

  it('trims whitespace', () => {
    expect(normalizeCardNumber('  215  ')).toBe('215');
  });
});

describe('computeSKU', () => {
  it('computes SKU from set code and number: "swsh7" + "215/203" → "swsh7-215"', () => {
    expect(computeSKU('swsh7', '215/203')).toBe('swsh7-215');
  });

  it('computes SKU for Base Set Charizard: "base1" + "4/102" → "base1-4"', () => {
    expect(computeSKU('base1', '4/102')).toBe('base1-4');
  });

  it('computes SKU with TG number: "swsh9" + "TG17/TG30" → "swsh9-TG17"', () => {
    expect(computeSKU('swsh9', 'TG17/TG30')).toBe('swsh9-TG17');
  });

  it('computes SKU with leading zeros: "swsh1" + "050" → "swsh1-50"', () => {
    expect(computeSKU('swsh1', '050')).toBe('swsh1-50');
  });

  it('lowercases set code: "SWSH7" + "215" → "swsh7-215"', () => {
    expect(computeSKU('SWSH7', '215')).toBe('swsh7-215');
  });

  it('returns empty for empty set code', () => {
    expect(computeSKU('', '215')).toBe('');
  });

  it('returns empty for empty number', () => {
    expect(computeSKU('swsh7', '')).toBe('');
  });
});
