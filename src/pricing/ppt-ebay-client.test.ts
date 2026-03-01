import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { PptEbayClient } from './ppt-ebay-client.js';
import type { GachaAgentConfig, ResolvedCard } from '../types/index.js';

const PPT_BASE = 'https://www.pokemonpricetracker.com';

const config: GachaAgentConfig = {
  pokemonPriceTracker: {
    apiKey: 'test-ppt-key',
    baseUrl: PPT_BASE,
  },
  storage: { type: 'json' },
};

// Card with numeric ID (tcgPlayerId) — uses tcgPlayerId param
const mewEx: ResolvedCard = {
  id: '580368',
  name: 'Mew ex',
  setName: 'Paldean Fates',
  setCode: 'sv04.5',
  number: '232',
  year: 2024,
  confidence: 0.95,
};

// Card with UUID ID (PPT cardId) — uses search param
const charizard: ResolvedCard = {
  id: '8479e4be-5374-45a6-ad3f-d73a076064cd',
  name: 'Charizard-Holo',
  setName: 'Pokemon Game',
  setCode: 'base1',
  number: '4',
  year: 1999,
  confidence: 0.95,
};

const pptEbayResponse = {
  data: {
    ebay: {
      salesByGrade: {
        psa10: {
          count: 114,
          smartMarketPrice: { price: 344.50, confidence: 'high' },
          medianPrice: 494.95,
          marketTrend: 'down',
        },
        psa9: {
          count: 56,
          smartMarketPrice: { price: 85.00, confidence: 'medium' },
          medianPrice: 90.00,
          marketTrend: 'up',
        },
        psa7: {
          count: 3,
          smartMarketPrice: { price: 25.00, confidence: 'low' },
          medianPrice: null,
          marketTrend: null,
        },
      },
    },
  },
};

describe('PptEbayClient', () => {
  let client: PptEbayClient;

  beforeEach(() => {
    client = new PptEbayClient(config);
  });

  it('parses eBay sales data for available grades', async () => {
    server.use(
      http.get(`${PPT_BASE}/api/v2/cards`, () => {
        return HttpResponse.json(pptEbayResponse);
      }),
    );

    const result = await client.getEbaySales(mewEx);

    expect(result).not.toBeNull();
    expect(result!.label).toBe('eBay Sales');
    expect(result!.gradeData[10]).toEqual({
      fmv: 344.50,
      confidence: 'high',
      salesCount: 114,
      medianPrice: 494.95,
      marketTrend: 'down',
    });
    expect(result!.gradeData[9]).toEqual({
      fmv: 85.00,
      confidence: 'medium',
      salesCount: 56,
      medianPrice: 90.00,
      marketTrend: 'up',
    });
    expect(result!.gradeData[7]).toEqual({
      fmv: 25.00,
      confidence: 'low',
      salesCount: 3,
      medianPrice: null,
      marketTrend: null,
    });
    // Grades without data should not be present
    expect(result!.gradeData[1]).toBeUndefined();
  });

  it('uses tcgPlayerId param for numeric IDs', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${PPT_BASE}/api/v2/cards`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(pptEbayResponse);
      }),
    );

    await client.getEbaySales(mewEx);
    expect(capturedUrl).toContain('tcgPlayerId=580368');
    expect(capturedUrl).not.toContain('search=');
  });

  it('uses search param for UUID IDs', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${PPT_BASE}/api/v2/cards`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(pptEbayResponse);
      }),
    );

    await client.getEbaySales(charizard);
    expect(capturedUrl).toContain('search=');
    expect(capturedUrl).toContain('Charizard-Holo');
    expect(capturedUrl).not.toContain('tcgPlayerId=');
  });

  it('handles array response shape', async () => {
    server.use(
      http.get(`${PPT_BASE}/api/v2/cards`, () => {
        return HttpResponse.json({ data: [pptEbayResponse.data] });
      }),
    );

    const result = await client.getEbaySales(mewEx);

    expect(result).not.toBeNull();
    expect(result!.gradeData[10]!.fmv).toBe(344.50);
  });

  it('returns null when no eBay data exists', async () => {
    server.use(
      http.get(`${PPT_BASE}/api/v2/cards`, () => {
        return HttpResponse.json({ data: { name: 'Mew ex' } });
      }),
    );

    const result = await client.getEbaySales(mewEx);
    expect(result).toBeNull();
  });

  it('returns null when all smartMarketPrices are missing', async () => {
    server.use(
      http.get(`${PPT_BASE}/api/v2/cards`, () => {
        return HttpResponse.json({
          data: {
            ebay: {
              salesByGrade: {
                psa10: { count: 0, smartMarketPrice: null },
              },
            },
          },
        });
      }),
    );

    const result = await client.getEbaySales(mewEx);
    expect(result).toBeNull();
  });

  it('caches results within TTL', async () => {
    let callCount = 0;
    server.use(
      http.get(`${PPT_BASE}/api/v2/cards`, () => {
        callCount++;
        return HttpResponse.json(pptEbayResponse);
      }),
    );

    const first = await client.getEbaySales(mewEx);
    const second = await client.getEbaySales(mewEx);

    expect(callCount).toBe(1);
    expect(second).toEqual(first);
  });

  it('caches null results (negative caching)', async () => {
    let callCount = 0;
    server.use(
      http.get(`${PPT_BASE}/api/v2/cards`, () => {
        callCount++;
        return HttpResponse.json({ data: {} });
      }),
    );

    const first = await client.getEbaySales(mewEx);
    const second = await client.getEbaySales(mewEx);

    expect(callCount).toBe(1);
    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it('returns null on API error', async () => {
    server.use(
      http.get(`${PPT_BASE}/api/v2/cards`, () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await client.getEbaySales(mewEx);
    consoleSpy.mockRestore();

    expect(result).toBeNull();
  });

  it('normalizes non-www URL', () => {
    const nonWwwConfig: GachaAgentConfig = {
      pokemonPriceTracker: {
        apiKey: 'test',
        baseUrl: 'https://pokemonpricetracker.com',
      },
      storage: { type: 'json' },
    };

    const c = new PptEbayClient(nonWwwConfig);
    expect(c).toBeDefined();
  });

  it('sends Bearer auth header', async () => {
    let capturedAuth = '';
    server.use(
      http.get(`${PPT_BASE}/api/v2/cards`, ({ request }) => {
        capturedAuth = request.headers.get('authorization') ?? '';
        return HttpResponse.json(pptEbayResponse);
      }),
    );

    await client.getEbaySales(mewEx);
    expect(capturedAuth).toBe('Bearer test-ppt-key');
  });
});
