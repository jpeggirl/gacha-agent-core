import { describe, it, expect, beforeEach } from 'vitest';
import { parseQuery } from './query-normalizer.js';
import { SetAliasRegistry } from './set-aliases.js';

describe('parseQuery', () => {
  let registry: SetAliasRegistry;

  beforeEach(() => {
    registry = new SetAliasRegistry();
    registry.loadFromFile();
  });

  // ─── Problem-Statement Query ───

  it('parses the full PSA label: "2021 POKEMON SWORD & SHIELD EVOLVING SKIES FA/UMBREON VMAX #215"', () => {
    const result = parseQuery(
      '2021 POKEMON SWORD & SHIELD EVOLVING SKIES FA/UMBREON VMAX #215',
      registry,
    );

    expect(result.year).toBe(2021);
    expect(result.cardNumber).toBe('215');
    expect(result.setHints).toContain('Evolving Skies');
    expect(result.variant).toBe('FA');
    expect(result.cardName).toContain('umbreon vmax');
  });

  // ─── Grade Extraction ───

  it('extracts PSA grade', () => {
    const result = parseQuery('umbreon vmax psa 10');
    expect(result.grade).toBe(10);
    expect(result.grader).toBe('PSA');
  });

  it('extracts BGS grade with decimal', () => {
    const result = parseQuery('charizard bgs 9.5');
    expect(result.grade).toBe(9.5);
    expect(result.grader).toBe('BGS');
  });

  it('extracts CGC grade', () => {
    const result = parseQuery('pikachu cgc 8');
    expect(result.grade).toBe(8);
    expect(result.grader).toBe('CGC');
  });

  it('extracts standalone grader without number', () => {
    const result = parseQuery('charizard psa base set');
    expect(result.grader).toBe('PSA');
    expect(result.grade).toBeNull();
  });

  // ─── Year Extraction ───

  it('extracts 4-digit year', () => {
    const result = parseQuery('2021 charizard');
    expect(result.year).toBe(2021);
  });

  it('extracts vintage year', () => {
    const result = parseQuery('1999 charizard base set');
    expect(result.year).toBe(1999);
  });

  it('returns null year when not present', () => {
    const result = parseQuery('charizard base set');
    expect(result.year).toBeNull();
  });

  // ─── Card Number Extraction ───

  it('extracts card number with hash prefix', () => {
    const result = parseQuery('umbreon vmax #215');
    expect(result.cardNumber).toBe('215');
  });

  it('extracts fraction card number', () => {
    const result = parseQuery('charizard 4/102');
    expect(result.cardNumber).toBe('4/102');
  });

  it('extracts TG format number', () => {
    const result = parseQuery('eevee vmax TG17/TG30');
    expect(result.cardNumber).toBe('TG17/TG30');
  });

  it('extracts GG format number', () => {
    const result = parseQuery('charizard GG05');
    expect(result.cardNumber).toBe('GG05');
  });

  it('extracts SV format number', () => {
    const result = parseQuery('charizard SV107/SV122');
    expect(result.cardNumber).toBe('SV107');
  });

  it('does not confuse single digit with card number', () => {
    // "9" by itself could be a grade, not a card number
    const result = parseQuery('charizard psa 9');
    expect(result.cardNumber).toBeNull();
    expect(result.grade).toBe(9);
  });

  // ─── Variant Extraction ───

  it('extracts FA variant', () => {
    const result = parseQuery('FA/UMBREON VMAX');
    expect(result.variant).toBe('FA');
  });

  it('extracts Alt Art variant', () => {
    const result = parseQuery('umbreon vmax alt art');
    expect(result.variant).toBe('ALT ART');
  });

  it('extracts Shadowless variant', () => {
    const result = parseQuery('charizard shadowless base set');
    expect(result.variant).toBe('SHADOWLESS');
  });

  it('extracts 1st Edition variant', () => {
    const result = parseQuery('charizard 1st edition base set');
    expect(result.variant).toBe('1ST EDITION');
  });

  // ─── Set Hint Extraction (with registry) ───

  it('identifies "base set" as set hint', () => {
    const result = parseQuery('charizard base set', registry);
    expect(result.setHints).toContain('Base Set');
    expect(result.cardName).toBe('charizard');
  });

  it('identifies "evolving skies" as set hint', () => {
    const result = parseQuery('umbreon vmax evolving skies', registry);
    expect(result.setHints).toContain('Evolving Skies');
    expect(result.cardName).toContain('umbreon vmax');
  });

  // ─── Franchise/Era Noise Stripping ───

  it('strips POKEMON franchise noise', () => {
    const result = parseQuery('POKEMON charizard base set');
    expect(result.cardName).not.toContain('pokemon');
  });

  it('strips search noise words', () => {
    const result = parseQuery("what's charizard worth psa 10");
    expect(result.cardName).not.toContain('worth');
    expect(result.cardName).not.toContain("what's");
  });

  // ─── rawCleaned ───

  it('builds rawCleaned with card name and number', () => {
    const result = parseQuery('umbreon vmax #215');
    expect(result.rawCleaned).toContain('umbreon vmax');
    expect(result.rawCleaned).toContain('215');
  });

  // ─── Edge Cases ───

  it('handles empty string', () => {
    const result = parseQuery('');
    expect(result.cardName).toBeNull();
    expect(result.cardNumber).toBeNull();
    expect(result.grade).toBeNull();
  });

  it('handles query with only noise', () => {
    const result = parseQuery('pokemon');
    expect(result.cardName).toBeNull();
  });

  // ─── Combined Parsing ───

  it('parses a shorthand query: "UMBREON VMAX #215"', () => {
    const result = parseQuery('UMBREON VMAX #215');
    expect(result.cardName).toContain('umbreon vmax');
    expect(result.cardNumber).toBe('215');
  });

  it('parses graded query: "umbreon vmax psa 10"', () => {
    const result = parseQuery('umbreon vmax psa 10');
    expect(result.cardName).toContain('umbreon vmax');
    expect(result.grade).toBe(10);
    expect(result.grader).toBe('PSA');
  });

  it('parses "charizard base set" with registry', () => {
    const result = parseQuery('charizard base set', registry);
    expect(result.cardName).toBe('charizard');
    expect(result.setHints).toContain('Base Set');
    expect(result.cardNumber).toBeNull();
  });
});
