import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { TcgPlayerClient } from './tcgplayer-client.js';

const TCG_BASE = 'https://api.pokemontcg.io/v2';

const tcgResponse = {
  data: [
    {
      tcgplayer: {
        prices: {
          holofoil: {
            low: 30.00,
            mid: 42.00,
            high: 60.00,
            market: 45.50,
          },
          reverseHolofoil: {
            low: 10.00,
            mid: 15.00,
            high: 20.00,
            market: 14.00,
          },
        },
      },
    },
  ],
};

describe('TcgPlayerClient', () => {
  let client: TcgPlayerClient;

  beforeEach(() => {
    client = new TcgPlayerClient('test-tcg-key');
  });

  it('returns holofoil as preferred variant', async () => {
    server.use(
      http.get(`${TCG_BASE}/cards`, () => {
        return HttpResponse.json(tcgResponse);
      }),
    );

    const result = await client.getMarketPrice('580368');

    expect(result).not.toBeNull();
    expect(result!.label).toBe('TCGPlayer');
    expect(result!.variant).toBe('holofoil');
    expect(result!.market).toBe(45.50);
    expect(result!.low).toBe(30.00);
    expect(result!.mid).toBe(42.00);
    expect(result!.high).toBe(60.00);
  });

  it('falls back to reverseHolofoil when holofoil missing', async () => {
    const noHolo = {
      data: [{
        tcgplayer: {
          prices: {
            reverseHolofoil: { low: 10, mid: 15, high: 20, market: 14 },
          },
        },
      }],
    };

    server.use(
      http.get(`${TCG_BASE}/cards`, () => {
        return HttpResponse.json(noHolo);
      }),
    );

    const result = await client.getMarketPrice('580368');

    expect(result!.variant).toBe('reverseHolofoil');
    expect(result!.market).toBe(14);
  });

  it('falls back to normal when preferred variants missing', async () => {
    const normalOnly = {
      data: [{
        tcgplayer: {
          prices: {
            normal: { low: 5, mid: 8, high: 12, market: 7 },
          },
        },
      }],
    };

    server.use(
      http.get(`${TCG_BASE}/cards`, () => {
        return HttpResponse.json(normalOnly);
      }),
    );

    const result = await client.getMarketPrice('580368');

    expect(result!.variant).toBe('normal');
    expect(result!.market).toBe(7);
  });

  it('uses first available variant when none match preference', async () => {
    const unlimitedOnly = {
      data: [{
        tcgplayer: {
          prices: {
            unlimited: { low: 2, mid: 3, high: 5, market: 3 },
          },
        },
      }],
    };

    server.use(
      http.get(`${TCG_BASE}/cards`, () => {
        return HttpResponse.json(unlimitedOnly);
      }),
    );

    const result = await client.getMarketPrice('580368');

    expect(result!.variant).toBe('unlimited');
    expect(result!.market).toBe(3);
  });

  it('returns null when no cards found', async () => {
    server.use(
      http.get(`${TCG_BASE}/cards`, () => {
        return HttpResponse.json({ data: [] });
      }),
    );

    const result = await client.getMarketPrice('580368');
    expect(result).toBeNull();
  });

  it('returns null when no prices exist', async () => {
    server.use(
      http.get(`${TCG_BASE}/cards`, () => {
        return HttpResponse.json({ data: [{ tcgplayer: { prices: {} } }] });
      }),
    );

    const result = await client.getMarketPrice('580368');
    expect(result).toBeNull();
  });

  it('caches results within TTL', async () => {
    let callCount = 0;
    server.use(
      http.get(`${TCG_BASE}/cards`, () => {
        callCount++;
        return HttpResponse.json(tcgResponse);
      }),
    );

    const first = await client.getMarketPrice('580368');
    const second = await client.getMarketPrice('580368');

    expect(callCount).toBe(1);
    expect(second).toEqual(first);
  });

  it('caches null results (negative caching)', async () => {
    let callCount = 0;
    server.use(
      http.get(`${TCG_BASE}/cards`, () => {
        callCount++;
        return HttpResponse.json({ data: [] });
      }),
    );

    await client.getMarketPrice('580368');
    await client.getMarketPrice('580368');

    expect(callCount).toBe(1);
  });

  it('returns null on API error', async () => {
    server.use(
      http.get(`${TCG_BASE}/cards`, () => {
        return new HttpResponse(null, { status: 429 });
      }),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await client.getMarketPrice('580368');
    consoleSpy.mockRestore();

    expect(result).toBeNull();
  });

  it('sends X-Api-Key header', async () => {
    let capturedKey = '';
    server.use(
      http.get(`${TCG_BASE}/cards`, ({ request }) => {
        capturedKey = request.headers.get('x-api-key') ?? '';
        return HttpResponse.json(tcgResponse);
      }),
    );

    await client.getMarketPrice('580368');
    expect(capturedKey).toBe('test-tcg-key');
  });

  it('handles null price fields gracefully', async () => {
    const nullPrices = {
      data: [{
        tcgplayer: {
          prices: {
            holofoil: { low: null, mid: null, high: null, market: 45.50 },
          },
        },
      }],
    };

    server.use(
      http.get(`${TCG_BASE}/cards`, () => {
        return HttpResponse.json(nullPrices);
      }),
    );

    const result = await client.getMarketPrice('580368');

    expect(result!.market).toBe(45.50);
    expect(result!.low).toBeNull();
    expect(result!.mid).toBeNull();
    expect(result!.high).toBeNull();
  });
});
