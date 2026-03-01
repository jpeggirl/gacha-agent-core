import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { readFile } from 'node:fs/promises';
import { server } from '../mocks/server.js';
import { CardResolver } from './resolver.js';
import type { GachaAgentConfig } from '../types/index.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('{"exact":{},"patterns":[]}'),
}));

const BASE_URL = 'https://www.pokemonpricetracker.com';

const config: GachaAgentConfig = {
  pokemonPriceTracker: {
    apiKey: 'test-api-key',
    baseUrl: BASE_URL,
  },
  storage: { type: 'json', jsonPath: '/tmp/test.json' },
  scheduler: {
    scanIntervalMs: 15 * 60 * 1000,
    ebayDailyLimit: 5000,
    pricingDailyLimit: 100,
    minDealScore: 60,
    maxConcurrentScans: 3,
  },
};

function makeV2Response(matchScore: number) {
  return {
    data: {
      parsed: { confidence: matchScore, variant: undefined },
      matches: [
        {
          tcgPlayerId: 12345,
          name: 'Charizard',
          setName: 'Base Set',
          setId: 1,
          cardNumber: '4',
          rarity: 'Holo Rare',
          matchScore,
          matchReasons: ['name match', 'set match'],
        },
        {
          tcgPlayerId: 12346,
          name: 'Charizard',
          setName: 'Base Set 2',
          setId: 2,
          cardNumber: '4',
          rarity: 'Holo Rare',
          matchScore: matchScore * 0.9,
          matchReasons: ['name match'],
        },
      ],
    },
  };
}

describe('CardResolver — two-tier confidence gate', () => {
  let resolver: CardResolver;

  beforeEach(() => {
    resolver = new CardResolver(config);
  });

  // ── Case 1: HIGH confidence (>= 0.85) → auto-proceed ─────────────────────
  it('auto-proceeds when matchScore is 0.92 (above AUTO_PROCEED_THRESHOLD)', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json(makeV2Response(0.92)),
      ),
    );

    const result = await resolver.resolve('Charizard Base Set 1st Edition');

    expect(result.success).toBe(true);
    expect(result.bestMatch).toBeDefined();
    expect(result.needsDisambiguation).toBe(false);
    expect(result.disambiguationReason).toBeUndefined();
  });

  // ── Case 2: MIDDLE adjusted confidence (0.70-0.84) → disambiguation ─────
  // matchScore 0.45 + ~0.30 relevance boost for "Charizard" → ~0.75 adjusted
  it('returns needsDisambiguation when adjusted confidence lands in 0.70-0.84 range', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json(makeV2Response(0.45)),
      ),
    );

    const result = await resolver.resolve('Charizard');

    expect(result.success).toBe(false);
    expect(result.bestMatch).toBeUndefined();
    expect(result.needsDisambiguation).toBe(true);
    expect(result.disambiguationReason).toMatch(/below auto-proceed threshold/i);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  // ── Case 3: LOW confidence (< 0.70) → no match ───────────────────────────
  it('returns success: false, no disambiguation when matchScore is 0.40', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json(makeV2Response(0.40)),
      ),
    );

    const result = await resolver.resolve('asdfghjkl');

    expect(result.success).toBe(false);
    expect(result.bestMatch).toBeUndefined();
    expect(result.needsDisambiguation).toBe(false);
    expect(result.candidates).toBeDefined();
  });

  // ── Case 4: API failure (503) → error surfaced ────────────────────────────
  it('surfaces error via console.error and returns empty result when API returns 503', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        new HttpResponse(null, { status: 503, statusText: 'Service Unavailable' }),
      ),
    );

    const result = await resolver.resolve('Charizard');

    expect(result.success).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.needsDisambiguation).toBe(false);
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls[0][0]).toContain('[CardResolver]');

    consoleSpy.mockRestore();
  });

  // ── Case 5: Empty matches → no match ─────────────────────────────────────
  it('returns success: false with empty candidates when API returns no matches', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json({ data: { parsed: { confidence: 0 }, matches: [] } }),
      ),
      http.get(`${BASE_URL}/api/v2/cards`, () =>
        HttpResponse.json({ data: [] }),
      ),
    );

    const result = await resolver.resolve('Charizard');

    expect(result.success).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.needsDisambiguation).toBe(false);
  });

  // ── Boundary: exactly at AUTO_PROCEED_THRESHOLD (0.85) ───────────────────
  it('auto-proceeds when matchScore is exactly 0.85 (at AUTO_PROCEED_THRESHOLD)', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json(makeV2Response(0.85)),
      ),
    );

    const result = await resolver.resolve('Charizard Base Set');

    expect(result.success).toBe(true);
    expect(result.bestMatch).toBeDefined();
    expect(result.needsDisambiguation).toBe(false);
  });

  // ── Boundary: adjusted confidence at DISAMBIGUATE_THRESHOLD (0.70) ───────
  // matchScore 0.42 + ~0.30 relevance boost → ~0.72 adjusted (in disambiguate range)
  it('returns needsDisambiguation when adjusted confidence is in DISAMBIGUATE range', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json(makeV2Response(0.42)),
      ),
    );

    const result = await resolver.resolve('Charizard');

    expect(result.success).toBe(false);
    expect(result.needsDisambiguation).toBe(true);
  });

  // ── Boundary: adjusted confidence below DISAMBIGUATE_THRESHOLD ───────────
  // matchScore 0.15 + relevance boost → below 0.70 adjusted
  it('does not set needsDisambiguation when adjusted confidence is below DISAMBIGUATE_THRESHOLD', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json(makeV2Response(0.15)),
      ),
    );

    const result = await resolver.resolve('Charizard');

    expect(result.success).toBe(false);
    expect(result.needsDisambiguation).toBe(false);
  });
});

// ─── Alias Expansion ────────────────────────────────────────────────────────

const SEED_ALIASES = JSON.stringify({
  exact: {
    'bubble mew': 'Mew ex #232 Paldean Fates',
    'moonbreon': 'Umbreon VMAX #215 Evolving Skies',
    'shadowless zard': 'Charizard #4 Base Set Shadowless',
  },
  patterns: [
    { match: '^shadowless\\s+(.+)$', expand: '$1 Base Set Shadowless' },
  ],
});

describe('CardResolver — alias expansion', () => {
  let resolver: CardResolver;
  let capturedTitle: string | undefined;

  beforeEach(() => {
    capturedTitle = undefined;
    vi.mocked(readFile).mockReset();
    vi.mocked(readFile).mockResolvedValue(SEED_ALIASES);
    resolver = new CardResolver(config);

    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, async ({ request }) => {
        const body = (await request.json()) as { title: string };
        capturedTitle = body.title;
        return HttpResponse.json(makeV2Response(0.92));
      }),
    );
  });

  it('expands exact alias before API call', async () => {
    await resolver.resolve('bubble mew');
    expect(capturedTitle).toBe('Mew ex #232 Paldean Fates');
  });

  it('matches aliases case-insensitively', async () => {
    await resolver.resolve('Bubble Mew');
    expect(capturedTitle).toBe('Mew ex #232 Paldean Fates');
  });

  it('expands pattern alias correctly', async () => {
    await resolver.resolve('shadowless charizard');
    expect(capturedTitle).toBe('charizard Base Set Shadowless');
  });

  it('passes unmatched query through unchanged', async () => {
    await resolver.resolve('Charizard Base Set');
    expect(capturedTitle).toBe('Charizard Base Set');
  });

  it('degrades gracefully when alias file is missing', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const freshResolver = new CardResolver(config);

    await freshResolver.resolve('bubble mew');
    expect(capturedTitle).toBe('bubble mew');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('loads alias file only once across multiple resolves', async () => {
    await resolver.resolve('bubble mew');
    await resolver.resolve('moonbreon');
    expect(vi.mocked(readFile)).toHaveBeenCalledOnce();
  });

  it('prefers exact match over pattern match', async () => {
    await resolver.resolve('shadowless zard');
    expect(capturedTitle).toBe('Charizard #4 Base Set Shadowless');
  });

  it('strips grade modifier before lookup and reattaches after', async () => {
    await resolver.resolve('bubble mew PSA 10');
    expect(capturedTitle).toBe('Mew ex #232 Paldean Fates PSA 10');
  });
});

// ─── Image Enrichment ────────────────────────────────────────────────────────

describe('CardResolver — enrichCandidatesWithImages', () => {
  let resolver: CardResolver;

  beforeEach(() => {
    vi.mocked(readFile).mockResolvedValue('{"exact":{},"patterns":[]}');
    resolver = new CardResolver(config);
  });

  it('fetches and attaches imageUrl to candidates missing it', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v2/cards`, ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get('tcgPlayerId');
        return HttpResponse.json({
          data: { imageUrl: `https://img.example.com/${id}.jpg` },
        });
      }),
    );

    const candidates = [
      {
        card: {
          id: '12345',
          name: 'Charizard',
          setName: 'Base Set',
          setCode: 'base1',
          number: '4',
          year: 1999,
          confidence: 0.8,
        },
        confidence: 0.8,
        matchReason: 'name match',
      },
    ];

    const enriched = await resolver.enrichCandidatesWithImages(candidates);
    expect(enriched[0].card.imageUrl).toBe('https://img.example.com/12345.jpg');
  });

  it('preserves existing imageUrl (no overwrite)', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v2/cards`, () => {
        return HttpResponse.json({
          data: { imageUrl: 'https://img.example.com/new.jpg' },
        });
      }),
    );

    const candidates = [
      {
        card: {
          id: '12345',
          name: 'Charizard',
          setName: 'Base Set',
          setCode: 'base1',
          number: '4',
          year: 1999,
          confidence: 0.8,
          imageUrl: 'https://img.example.com/existing.jpg',
        },
        confidence: 0.8,
        matchReason: 'name match',
      },
    ];

    const enriched = await resolver.enrichCandidatesWithImages(candidates);
    expect(enriched[0].card.imageUrl).toBe('https://img.example.com/existing.jpg');
  });

  it('handles API failure gracefully (returns candidate without image)', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v2/cards`, () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const candidates = [
      {
        card: {
          id: '12345',
          name: 'Charizard',
          setName: 'Base Set',
          setCode: 'base1',
          number: '4',
          year: 1999,
          confidence: 0.8,
        },
        confidence: 0.8,
        matchReason: 'name match',
      },
    ];

    const enriched = await resolver.enrichCandidatesWithImages(candidates);
    expect(enriched[0].card.imageUrl).toBeUndefined();
  });

  it('skips non-numeric IDs', async () => {
    let apiCalled = false;
    server.use(
      http.get(`${BASE_URL}/api/v2/cards`, () => {
        apiCalled = true;
        return HttpResponse.json({ data: { imageUrl: 'https://img.example.com/x.jpg' } });
      }),
    );

    const candidates = [
      {
        card: {
          id: 'base1:4:Charizard',
          name: 'Charizard',
          setName: 'Base Set',
          setCode: 'base1',
          number: '4',
          year: 1999,
          confidence: 0.8,
        },
        confidence: 0.8,
        matchReason: 'name match',
      },
    ];

    const enriched = await resolver.enrichCandidatesWithImages(candidates);
    expect(enriched[0].card.imageUrl).toBeUndefined();
    expect(apiCalled).toBe(false);
  });
});

// ─── Search Fallback ─────────────────────────────────────────────────────────

describe('CardResolver — search fallback', () => {
  let resolver: CardResolver;

  beforeEach(() => {
    vi.mocked(readFile).mockResolvedValue('{"exact":{},"patterns":[]}');
    resolver = new CardResolver(config);
  });

  it('falls back to search endpoint when parse-title returns empty matches', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json({
          data: {
            parsed: { confidence: 0, cardName: 'Umbreon VMAX Alt Art' },
            matches: [],
          },
        }),
      ),
      http.get(`${BASE_URL}/api/v2/cards`, () =>
        HttpResponse.json({
          data: [
            {
              tcgPlayerId: 99001,
              name: 'Umbreon VMAX',
              setName: 'Evolving Skies',
              setId: 'swsh7',
              cardNumber: '215',
              rarity: 'Secret Rare',
              imageUrl: 'https://img.example.com/umbreon.jpg',
            },
          ],
        }),
      ),
    );

    const result = await resolver.resolve('Umbreon VMAX alt art');

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].card.name).toBe('Umbreon VMAX');
    expect(result.candidates[0].card.id).toBe('99001');
    expect(result.candidates[0].matchReason).toBe('Match from search fallback');
  });

  it('uses cardName from parse-title response for search query', async () => {
    let searchQuery: string | null = null;

    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json({
          data: {
            parsed: { confidence: 0, cardName: 'Umbreon VMAX' },
            matches: [],
          },
        }),
      ),
      http.get(`${BASE_URL}/api/v2/cards`, ({ request }) => {
        const url = new URL(request.url);
        searchQuery = url.searchParams.get('search');
        return HttpResponse.json({
          data: [
            {
              tcgPlayerId: 99001,
              name: 'Umbreon VMAX',
              setName: 'Evolving Skies',
              setId: 'swsh7',
              cardNumber: '215',
            },
          ],
        });
      }),
    );

    await resolver.resolve('Umbreon VMAX alt art PSA 10');

    expect(searchQuery).toBe('Umbreon VMAX');
  });

  it('returns empty result when both parse-title and search return nothing', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json({ data: { parsed: { confidence: 0 }, matches: [] } }),
      ),
      http.get(`${BASE_URL}/api/v2/cards`, () =>
        HttpResponse.json({ data: [] }),
      ),
    );

    const result = await resolver.resolve('xyznonexistent');

    expect(result.success).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it('does not call search when parse-title returns matches', async () => {
    let searchCalled = false;

    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json(makeV2Response(0.92)),
      ),
      http.get(`${BASE_URL}/api/v2/cards`, () => {
        searchCalled = true;
        return HttpResponse.json({ data: [] });
      }),
    );

    await resolver.resolve('Charizard Base Set');

    expect(searchCalled).toBe(false);
  });
});

// ─── Card Misresolution Fixes ───────────────────────────────────────────────

describe('CardResolver — misresolution fixes', () => {
  let resolver: CardResolver;

  beforeEach(() => {
    vi.mocked(readFile).mockResolvedValue('{"exact":{},"patterns":[]}');
    resolver = new CardResolver(config);
  });

  it('ranks candidate with name overlap higher than number-only match', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json({
          data: {
            parsed: { confidence: 0.6, variant: 'ex' },
            matches: [
              {
                tcgPlayerId: 111,
                name: "Tohoku's Pikachu",
                setName: 'SM Promos',
                setId: 'smp',
                cardNumber: '088',
                rarity: 'Promo',
                matchScore: 0.5,
                matchReasons: ['number match'],
              },
              {
                tcgPlayerId: 222,
                name: 'Mega Latias EX',
                setName: 'Mega Symphonia',
                setId: 'm1s',
                cardNumber: '088',
                rarity: 'Ultra Rare',
                matchScore: 0.5,
                matchReasons: ['number match', 'name match'],
              },
            ],
          },
        }),
      ),
    );

    const result = await resolver.resolve(
      '2025 POKEMON JAPANESE M1S-MEGA SYMPHONIA #088 MEGA LATIAS EX',
    );

    expect(result.candidates.length).toBe(2);
    // Mega Latias EX should rank higher due to name overlap
    expect(result.candidates[0].card.name).toBe('Mega Latias EX');
    expect(result.candidates[1].card.name).toBe("Tohoku's Pikachu");
  });

  it('does not apply parsed variant "ex" to non-matching candidate', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json({
          data: {
            parsed: { confidence: 0.6, variant: 'ex' },
            matches: [
              {
                tcgPlayerId: 111,
                name: "Tohoku's Pikachu",
                setName: 'SM Promos',
                setId: 'smp',
                cardNumber: '088',
                rarity: 'Promo',
                matchScore: 0.5,
                matchReasons: ['number match'],
              },
              {
                tcgPlayerId: 222,
                name: 'Latias EX',
                setName: 'Some Set',
                setId: 's1',
                cardNumber: '088',
                rarity: 'Ultra Rare',
                matchScore: 0.5,
                matchReasons: ['number match'],
              },
            ],
          },
        }),
      ),
    );

    const result = await resolver.resolve('Latias EX #088');

    const pikachu = result.candidates.find((c) => c.card.name === "Tohoku's Pikachu");
    const latias = result.candidates.find((c) => c.card.name === 'Latias EX');

    // Pikachu should NOT get the "ex" variant since its name/rarity don't contain "ex"
    expect(pikachu?.card.variant).toBeUndefined();
    // Latias EX should get the variant
    expect(latias?.card.variant).toBe('ex');
  });

  it('uses API-provided year over extracted year', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json({
          data: {
            parsed: { confidence: 0.8 },
            matches: [
              {
                tcgPlayerId: 333,
                name: 'Mega Latias EX',
                setName: 'Mega Symphonia',
                setId: 'm1s',
                cardNumber: '088',
                rarity: 'Ultra Rare',
                year: 2017,
                matchScore: 0.8,
                matchReasons: ['name match'],
              },
            ],
          },
        }),
      ),
    );

    const result = await resolver.resolve('2025 POKEMON Mega Latias EX');

    expect(result.candidates[0].card.year).toBe(2017);
  });

  it('number-only match scores lower than name+number match', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v2/parse-title`, () =>
        HttpResponse.json({
          data: {
            parsed: { confidence: 0.5 },
            matches: [
              {
                tcgPlayerId: 444,
                name: 'Unrelated Card',
                setName: 'Some Set',
                setId: 's1',
                cardNumber: '088',
                rarity: 'Common',
                matchScore: 0.5,
                matchReasons: ['number match'],
              },
              {
                tcgPlayerId: 555,
                name: 'Latias',
                setName: 'Another Set',
                setId: 's2',
                cardNumber: '088',
                rarity: 'Rare',
                matchScore: 0.5,
                matchReasons: ['number match', 'name match'],
              },
            ],
          },
        }),
      ),
    );

    const result = await resolver.resolve('Latias #088');

    // Latias (name + number match) should rank above Unrelated Card (number only)
    expect(result.candidates[0].card.name).toBe('Latias');
    expect(result.candidates[1].card.name).toBe('Unrelated Card');
  });
});
