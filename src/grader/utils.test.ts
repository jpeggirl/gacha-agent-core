import { describe, it, expect } from 'vitest';
import { EBAY_GRADER_MAP, graderTitleRegex, graderNegationRegex, formatGradeLabel } from './utils.js';

describe('EBAY_GRADER_MAP', () => {
  it('maps all graders to eBay aspect_filter values', () => {
    expect(EBAY_GRADER_MAP.PSA).toBe('PSA');
    expect(EBAY_GRADER_MAP.BGS).toBe('Beckett (BGS)');
    expect(EBAY_GRADER_MAP.CGC).toBe('CGC');
    expect(EBAY_GRADER_MAP.SGC).toBe('SGC');
  });
});

describe('graderTitleRegex', () => {
  it('PSA requested regex matches "PSA" in title', () => {
    const { requested } = graderTitleRegex('PSA');
    expect(requested.test('Charizard PSA 10')).toBe(true);
    expect(requested.test('Charizard BGS 10')).toBe(false);
  });

  it('PSA competing regex matches BGS, CGC, SGC but not PSA', () => {
    const { competing } = graderTitleRegex('PSA');
    expect(competing.test('Charizard BGS 10')).toBe(true);
    expect(competing.test('Charizard CGC 10')).toBe(true);
    expect(competing.test('Charizard SGC 10')).toBe(true);
    expect(competing.test('Charizard PSA 10')).toBe(false);
  });

  it('BGS requested regex matches both "BGS" and "Beckett"', () => {
    const { requested } = graderTitleRegex('BGS');
    expect(requested.test('Charizard BGS 10')).toBe(true);
    expect(requested.test('Charizard Beckett 9.5')).toBe(true);
  });

  it('BGS competing regex matches PSA, CGC, SGC but not BGS/Beckett', () => {
    const { competing } = graderTitleRegex('BGS');
    expect(competing.test('Charizard PSA 10')).toBe(true);
    expect(competing.test('Charizard CGC 10')).toBe(true);
    expect(competing.test('Charizard BGS 10')).toBe(false);
    expect(competing.test('Charizard Beckett 9.5')).toBe(false);
  });
});

describe('graderNegationRegex', () => {
  it('matches "not PSA" variations', () => {
    const negation = graderNegationRegex('PSA');
    expect(negation.test('GetGraded not psa 10')).toBe(true);
    expect(negation.test('not PSA graded')).toBe(true);
    expect(negation.test('no PSA certification')).toBe(true);
    expect(negation.test('non-PSA slab')).toBe(true);
    expect(negation.test('non PSA graded')).toBe(true);
  });

  it('does not match when grader appears without negation', () => {
    const negation = graderNegationRegex('PSA');
    expect(negation.test('Charizard PSA 10')).toBe(false);
    expect(negation.test('PSA 9 Base Set')).toBe(false);
  });

  it('does not match negation of a different grader', () => {
    const negation = graderNegationRegex('PSA');
    expect(negation.test('not BGS')).toBe(false);
    expect(negation.test('no CGC')).toBe(false);
  });

  it('matches BGS negation patterns including Beckett', () => {
    const negation = graderNegationRegex('BGS');
    expect(negation.test('not BGS')).toBe(true);
    expect(negation.test('not Beckett')).toBe(true);
    expect(negation.test('non-BGS')).toBe(true);
  });
});

describe('formatGradeLabel', () => {
  it('formats PSA 10', () => {
    expect(formatGradeLabel('PSA', 10)).toBe('PSA 10');
  });

  it('formats BGS half-grades', () => {
    expect(formatGradeLabel('BGS', 9.5)).toBe('BGS 9.5');
  });

  it('formats CGC 9', () => {
    expect(formatGradeLabel('CGC', 9)).toBe('CGC 9');
  });
});
