import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { PriceEngine } from './engine.js';
import type { ResolvedCard, GachaAgentConfig } from '../types/index.js';

// ─── Test Fixtures ───

const PC_BASE = 'https://www.pricecharting.com/api';

const config: GachaAgentConfig = {
  pokemonPriceTracker: {
    apiKey: 'test-api-key',
    baseUrl: 'https://www.pokemonpricetracker.com',
  },
  priceCharting: {
    apiKey: 'test-pc-key',
  },
  storage: {
    type: 'json',
    jsonPath: '/tmp/test-storage.json',
  },
  scheduler: {
    scanIntervalMs: 15 * 60 * 1000,
    ebayDailyLimit: 5000,
    pricingDailyLimit: 100,
    minDealScore: 60,
    maxConcurrentScans: 3,
  },
};

const mewEx: ResolvedCard = {
  id: '580368',
  name: 'Mew ex',
  setName: 'Paldean Fates',
  setCode: 'sv04.5',
  number: '232',
  year: 2024,
  rarity: 'Special Art Rare',
  confidence: 0.95,
};

// PriceCharting search response — prices in cents
const pcSearchResponse = {
  status: 'success',
  products: [
    {
      id: '95432',
      'product-name': 'Mew ex #232 Special Art Rare',
      'console-name': 'Paldean Fates',
      genre: 'Pokemon Card',
      'tcg-id': '580368',
      'manual-only-price': 182600,   // PSA 10 = $1,826.00
      'box-only-price': 24500,       // PSA 9  = $245.00
      'new-price': 12500,            // PSA 8  = $125.00
      'graded-price': 8900,          // PSA 7  = $89.00
      'loose-price': 4200,           // Ungraded = $42.00
    },
  ],
};

// ─── Tests ───

describe('PriceEngine.getFMV()', () => {
  let engine: PriceEngine;

  beforeEach(() => {
    engine = new PriceEngine(config);
  });

  it('returns FMV from PriceCharting manual-only-price for PSA 10', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return HttpResponse.json(pcSearchResponse);
      }),
    );

    const result = await engine.getFMV(mewEx, 10);

    expect(result).not.toBeNull();
    expect(result!.cardId).toBe('580368');
    expect(result!.grade).toBe(10);
    expect(result!.grader).toBe('PSA');
    expect(result!.fmv).toBe(1826);  // manual-only-price / 100
    expect(result!.currency).toBe('USD');
    expect(result!.prices).toHaveLength(1);
    expect(result!.prices[0]!.source).toBe('PriceCharting PSA 10');
    expect(result!.prices[0]!.price).toBe(1826);
  });

  it('returns FMV from PriceCharting box-only-price for PSA 9', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return HttpResponse.json(pcSearchResponse);
      }),
    );

    const result = await engine.getFMV(mewEx, 9);

    expect(result).not.toBeNull();
    expect(result!.fmv).toBe(245);  // box-only-price / 100
    expect(result!.prices[0]!.source).toBe('PriceCharting PSA 9');
  });

  it('returns FMV from PriceCharting graded-price for PSA 7', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return HttpResponse.json(pcSearchResponse);
      }),
    );

    const result = await engine.getFMV(mewEx, 7);

    expect(result).not.toBeNull();
    expect(result!.fmv).toBe(89);  // graded-price / 100
    expect(result!.prices[0]!.source).toBe('PriceCharting PSA 7');
  });

  it('returns FMV from PriceCharting new-price for PSA 8', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return HttpResponse.json(pcSearchResponse);
      }),
    );

    const result = await engine.getFMV(mewEx, 8);

    expect(result).not.toBeNull();
    expect(result!.fmv).toBe(125);  // new-price / 100
    expect(result!.prices[0]!.source).toBe('PriceCharting PSA 8');
  });

  it('returns null for PSA 6 (no dedicated PriceCharting field)', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return HttpResponse.json(pcSearchResponse);
      }),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await engine.getFMV(mewEx, 6);
    consoleSpy.mockRestore();

    expect(result).toBeNull();
  });

  it('returns null when PSA 10 field is missing', async () => {
    const noManualResponse = structuredClone(pcSearchResponse);
    delete (noManualResponse.products[0] as Record<string, unknown>)['manual-only-price'];

    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return HttpResponse.json(noManualResponse);
      }),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await engine.getFMV(mewEx, 10);
    consoleSpy.mockRestore();

    expect(result).toBeNull();
  });

  it('returns null when all prices are zero', async () => {
    const zeroPrices = structuredClone(pcSearchResponse);
    zeroPrices.products[0]!['manual-only-price'] = 0;
    zeroPrices.products[0]!['box-only-price'] = 0;
    zeroPrices.products[0]!['graded-price'] = 0;

    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return HttpResponse.json(zeroPrices);
      }),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await engine.getFMV(mewEx, 10);
    consoleSpy.mockRestore();

    expect(result).toBeNull();
  });

  it('returns null when no products match', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return HttpResponse.json({ status: 'success', products: [] });
      }),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await engine.getFMV(mewEx, 10);
    consoleSpy.mockRestore();

    expect(result).toBeNull();
  });

  it('returns cached value within TTL', async () => {
    let callCount = 0;
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        callCount++;
        return HttpResponse.json(pcSearchResponse);
      }),
    );

    const first = await engine.getFMV(mewEx, 10);
    const second = await engine.getFMV(mewEx, 10);

    expect(callCount).toBe(1);
    expect(second).toEqual(first);
  });

  it('returns null on API error', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return new HttpResponse(null, { status: 503, statusText: 'Service Unavailable' });
      }),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await engine.getFMV(mewEx, 10);
    consoleSpy.mockRestore();

    expect(result).toBeNull();
  });

  it('logs error with card name on API failure', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return new HttpResponse(null, { status: 503, statusText: 'Service Unavailable' });
      }),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await engine.getFMV(mewEx, 10);

    expect(consoleSpy).toHaveBeenCalledOnce();
    const [errorMsg] = consoleSpy.mock.calls[0]!;
    expect(errorMsg).toContain('[PriceEngine]');
    expect(errorMsg).toContain('Mew ex');
    consoleSpy.mockRestore();
  });

  it('does not include populationCount (PriceCharting does not provide it)', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return HttpResponse.json(pcSearchResponse);
      }),
    );

    const result = await engine.getFMV(mewEx, 10);
    expect(result).not.toBeNull();
    expect(result!.populationCount).toBeUndefined();
  });

  it('uses bgs-10-price for BGS 10', async () => {
    const bgsResponse = structuredClone(pcSearchResponse);
    bgsResponse.products[0]!['bgs-10-price'] = 150000; // $1,500

    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return HttpResponse.json(bgsResponse);
      }),
    );

    const result = await engine.getFMV(mewEx, 10, 'BGS');

    expect(result).not.toBeNull();
    expect(result!.grader).toBe('BGS');
    expect(result!.fmv).toBe(1500);
    expect(result!.prices[0]!.source).toBe('PriceCharting BGS 10');
    expect(result!.pricingSource).toBe('PriceCharting BGS 10');
  });

  it('CGC 10 falls back to PSA with approximate label', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return HttpResponse.json(pcSearchResponse);
      }),
    );

    const result = await engine.getFMV(mewEx, 10, 'CGC');

    expect(result).not.toBeNull();
    expect(result!.grader).toBe('CGC');
    expect(result!.fmv).toBe(1826); // falls back to manual-only-price (PSA 10)
    expect(result!.pricingSource).toContain('approximate');
    expect(result!.pricingSource).toContain('CGC');
  });

  it('uses separate cache keys per grader', async () => {
    let callCount = 0;
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        callCount++;
        return HttpResponse.json(pcSearchResponse);
      }),
    );

    const psa = await engine.getFMV(mewEx, 10, 'PSA');
    const cgc = await engine.getFMV(mewEx, 10, 'CGC');

    // Both should have been fetched (different cache keys)
    // Note: PriceCharting search cache may reduce API calls, but the FMV cache is keyed differently
    expect(psa).not.toBeNull();
    expect(cgc).not.toBeNull();
    expect(psa!.grader).toBe('PSA');
    expect(cgc!.grader).toBe('CGC');
  });
});

describe('PriceEngine.getMultiGradeFMV()', () => {
  let engine: PriceEngine;

  beforeEach(() => {
    engine = new PriceEngine(config);
  });

  it('returns different FMV per grade from same product', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => {
        return HttpResponse.json(pcSearchResponse);
      }),
    );

    const result = await engine.getMultiGradeFMV(mewEx, [9, 10]);

    expect(result.size).toBe(2);
    expect(result.get(9)!.fmv).toBe(245);
    expect(result.get(10)!.fmv).toBe(1826);
  });
});

// ─── Multi-Source Pricing Tests ───

const PPT_BASE = 'https://www.pokemonpricetracker.com';
const TCG_BASE = 'https://api.pokemontcg.io/v2';

const pptEbayResponse = {
  data: {
    ebay: {
      salesByGrade: {
        psa10: {
          count: 114,
          smartMarketPrice: { price: 1650, confidence: 'high' },
          medianPrice: 1700,
          marketTrend: 'down',
        },
        psa9: {
          count: 56,
          smartMarketPrice: { price: 200, confidence: 'medium' },
          medianPrice: 220,
          marketTrend: 'up',
        },
      },
    },
  },
};

const tcgResponse = {
  data: [{
    tcgplayer: {
      prices: {
        holofoil: { low: 30, mid: 42, high: 60, market: 45.50 },
      },
    },
  }],
};

const multiSourceConfig: GachaAgentConfig = {
  pokemonPriceTracker: {
    apiKey: 'test-ppt-key',
    baseUrl: PPT_BASE,
  },
  priceCharting: {
    apiKey: 'test-pc-key',
  },
  pokemonTcg: {
    apiKey: 'test-tcg-key',
  },
  storage: {
    type: 'json',
    jsonPath: '/tmp/test-storage.json',
  },
};

describe('PriceEngine.getMultiSourcePricing()', () => {
  let engine: PriceEngine;

  beforeEach(() => {
    engine = new PriceEngine(multiSourceConfig);
  });

  it('returns all 3 sources when all succeed', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => HttpResponse.json(pcSearchResponse)),
      http.get(`${PPT_BASE}/api/v2/cards`, () => HttpResponse.json(pptEbayResponse)),
      http.get(`${TCG_BASE}/cards`, () => HttpResponse.json(tcgResponse)),
    );

    const result = await engine.getMultiSourcePricing(mewEx, 10);

    // FMV prefers PriceCharting for dedicated grades (7-10)
    expect(result.fmv).toBe(1826);
    expect(result.grade).toBe(10);
    expect(result.grader).toBe('PSA');

    // PriceCharting source (dedicated fields: PSA 7-10)
    expect(result.sources.priceCharting).not.toBeNull();
    expect(result.sources.priceCharting!.label).toBe('PriceCharting');
    expect(result.sources.priceCharting!.fmv).toBe(1826);
    expect(result.sources.priceCharting!.allGrades[10]).toBe(1826);
    expect(result.sources.priceCharting!.allGrades[9]).toBe(245);
    expect(result.sources.priceCharting!.allGrades[8]).toBe(125);
    expect(result.sources.priceCharting!.allGrades[7]).toBe(89);
    // PSA 6: no dedicated PriceCharting field → null
    expect(result.sources.priceCharting!.allGrades[6]).toBeNull();

    // PPT eBay source
    expect(result.sources.pptEbay).not.toBeNull();
    expect(result.sources.pptEbay!.label).toBe('eBay Sales');
    expect(result.sources.pptEbay!.gradeData[10]!.fmv).toBe(1650);
    expect(result.sources.pptEbay!.gradeData[10]!.confidence).toBe('high');
    expect(result.sources.pptEbay!.gradeData[10]!.salesCount).toBe(114);

    // TCGPlayer source
    expect(result.sources.tcgPlayer).not.toBeNull();
    expect(result.sources.tcgPlayer!.label).toBe('TCGPlayer');
    expect(result.sources.tcgPlayer!.market).toBe(45.50);
    expect(result.sources.tcgPlayer!.variant).toBe('holofoil');
  });

  it('degrades gracefully when PPT eBay fails', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => HttpResponse.json(pcSearchResponse)),
      http.get(`${PPT_BASE}/api/v2/cards`, () => new HttpResponse(null, { status: 500 })),
      http.get(`${TCG_BASE}/cards`, () => HttpResponse.json(tcgResponse)),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await engine.getMultiSourcePricing(mewEx, 10);
    consoleSpy.mockRestore();

    expect(result.fmv).toBe(1826);
    expect(result.sources.priceCharting).not.toBeNull();
    expect(result.sources.pptEbay).toBeNull();
    expect(result.sources.tcgPlayer).not.toBeNull();
  });

  it('degrades gracefully when TCGPlayer fails', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => HttpResponse.json(pcSearchResponse)),
      http.get(`${PPT_BASE}/api/v2/cards`, () => HttpResponse.json(pptEbayResponse)),
      http.get(`${TCG_BASE}/cards`, () => new HttpResponse(null, { status: 429 })),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await engine.getMultiSourcePricing(mewEx, 10);
    consoleSpy.mockRestore();

    // PriceCharting is preferred for dedicated grades (7-10), PPT eBay as supplement
    expect(result.fmv).toBe(1826);
    expect(result.sources.priceCharting).not.toBeNull();
    expect(result.sources.pptEbay).not.toBeNull();
    expect(result.sources.tcgPlayer).toBeNull();
  });

  it('works with only PriceCharting configured', async () => {
    const pcOnlyConfig: GachaAgentConfig = {
      pokemonPriceTracker: { apiKey: 'test', baseUrl: PPT_BASE },
      priceCharting: { apiKey: 'test-pc-key' },
      storage: { type: 'json' },
    };
    const pcEngine = new PriceEngine(pcOnlyConfig);

    server.use(
      http.get(`${PC_BASE}/products`, () => HttpResponse.json(pcSearchResponse)),
      // PPT client is still created (same config), so handle its request
      http.get(`${PPT_BASE}/api/v2/cards`, () => HttpResponse.json({ data: {} })),
    );

    const result = await pcEngine.getMultiSourcePricing(mewEx, 10);

    expect(result.fmv).toBe(1826);
    expect(result.sources.priceCharting).not.toBeNull();
    expect(result.sources.pptEbay).toBeNull();
    expect(result.sources.tcgPlayer).toBeNull();
  });

  it('uses PPT eBay fmv when PriceCharting has no data', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => HttpResponse.json({ status: 'success', products: [] })),
      http.get(`${PPT_BASE}/api/v2/cards`, () => HttpResponse.json(pptEbayResponse)),
      http.get(`${TCG_BASE}/cards`, () => HttpResponse.json(tcgResponse)),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await engine.getMultiSourcePricing(mewEx, 10);
    consoleSpy.mockRestore();

    // FMV comes from PPT eBay when PriceCharting is unavailable
    expect(result.fmv).toBe(1650);
    expect(result.sources.priceCharting).toBeNull();
    expect(result.sources.pptEbay).not.toBeNull();
    expect(result.sources.tcgPlayer).not.toBeNull();
  });

  it('allGrades prefers PriceCharting (7-10) and PPT eBay for grade 6', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => HttpResponse.json(pcSearchResponse)),
      http.get(`${PPT_BASE}/api/v2/cards`, () => HttpResponse.json(pptEbayResponse)),
      http.get(`${TCG_BASE}/cards`, () => HttpResponse.json(tcgResponse)),
    );

    const result = await engine.getMultiSourcePricing(mewEx, 10);

    // PSA 10: PriceCharting has dedicated field (manual-only-price), preferred over PPT eBay
    expect(result.allGrades[10]).toBe(1826);
    // PSA 9: PriceCharting has dedicated field (box-only-price), preferred over PPT eBay
    expect(result.allGrades[9]).toBe(245);
    // PSA 8: PriceCharting has dedicated field (new-price), no PPT eBay data
    expect(result.allGrades[8]).toBe(125);
    // PSA 7: PriceCharting has dedicated field (graded-price), no PPT eBay data
    expect(result.allGrades[7]).toBe(89);
    // PSA 6: No dedicated PriceCharting field, no PPT eBay data → null
    expect(result.allGrades[6]).toBeNull();
    // Grades 1-5 are not included
    for (let g = 1; g <= 5; g++) {
      expect(result.allGrades[g]).toBeUndefined();
    }
  });

  it('allGrades falls back to PriceCharting for 7-10 when PPT eBay unavailable', async () => {
    server.use(
      http.get(`${PC_BASE}/products`, () => HttpResponse.json(pcSearchResponse)),
      http.get(`${PPT_BASE}/api/v2/cards`, () => new HttpResponse(null, { status: 500 })),
      http.get(`${TCG_BASE}/cards`, () => HttpResponse.json(tcgResponse)),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await engine.getMultiSourcePricing(mewEx, 10);
    consoleSpy.mockRestore();

    // PSA 10: Falls back to PriceCharting manual-only-price
    expect(result.allGrades[10]).toBe(1826);
    // PSA 9: Falls back to PriceCharting box-only-price
    expect(result.allGrades[9]).toBe(245);
    // PSA 8: Falls back to PriceCharting new-price
    expect(result.allGrades[8]).toBe(125);
    // PSA 7: Falls back to PriceCharting graded-price
    expect(result.allGrades[7]).toBe(89);
    // PSA 6: No PriceCharting field → null
    expect(result.allGrades[6]).toBeNull();
  });
});
