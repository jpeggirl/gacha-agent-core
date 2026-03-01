import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { EbayScanner, inferVariantKeywords, titleMatchesVariant } from './ebay.js';
import type { GachaAgentConfig, ResolvedCard, EbaySearchOverride } from '../types/index.js';

const TEST_CONFIG: GachaAgentConfig = {
  ebay: {
    appId: 'test-app-id',
    certId: 'test-cert-id',
    sandbox: false,
  },
  pokemonPriceTracker: {
    apiKey: 'test-key',
    baseUrl: 'https://api.pokemonpricetracker.com',
  },
  storage: { type: 'json', jsonPath: '/tmp/test-data' },
  scheduler: {
    scanIntervalMs: 900000,
    ebayDailyLimit: 5000,
    pricingDailyLimit: 100,
    minDealScore: 60,
    maxConcurrentScans: 3,
  },
};

const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

const testCard: ResolvedCard = {
  id: 'base1-4',
  name: 'Charizard',
  setName: 'Base Set',
  setCode: 'base1',
  number: '4',
  year: 1999,
  rarity: 'Rare Holo',
  variant: '1st Edition',
  confidence: 0.95,
};

function makeTokenHandler(status = 200) {
  if (status === 200) {
    return http.post(EBAY_TOKEN_URL, () =>
      HttpResponse.json({
        access_token: 'test-access-token',
        expires_in: 7200,
        token_type: 'Application Access Token',
      }),
    );
  }
  return http.post(EBAY_TOKEN_URL, () =>
    HttpResponse.json({ error: 'invalid_client' }, { status }),
  );
}

function makeSearchHandler(status = 200) {
  if (status === 200) {
    return http.get(EBAY_BROWSE_URL, () =>
      HttpResponse.json({
        total: 2,
        itemSummaries: [
          {
            itemId: 'v1|123456|0',
            title: 'Charizard Base Set 1st Edition PSA 9',
            price: { value: '4500.00', currency: 'USD' },
            shippingOptions: [
              { shippingCost: { value: '0.00', currency: 'USD' } },
            ],
            buyingOptions: ['FIXED_PRICE'],
            seller: {
              username: 'top_seller',
              feedbackScore: 5000,
              feedbackPercentage: '99.8',
            },
            image: { imageUrl: 'https://i.ebayimg.com/images/g/test.jpg' },
            itemWebUrl: 'https://www.ebay.com/itm/123456',
            condition: 'Used',
          },
          {
            itemId: 'v1|789012|0',
            title: 'Charizard Base Set 1st Edition PSA 9 #4',
            price: { value: '5200.00', currency: 'USD' },
            shippingOptions: [],
            buyingOptions: ['AUCTION'],
            seller: {
              username: 'another_seller',
              feedbackScore: 1200,
              feedbackPercentage: '98.5',
            },
            itemWebUrl: 'https://www.ebay.com/itm/789012',
            itemEndDate: '2026-02-20T18:00:00Z',
            bidCount: 7,
          },
        ],
      }),
    );
  }
  return http.get(EBAY_BROWSE_URL, () =>
    HttpResponse.json({ errors: [{ message: 'Unauthorized' }] }, { status }),
  );
}

describe('EbayScanner', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scan() — success path', () => {
    it('returns ScanResult with parsed listings on valid API response', async () => {
      server.use(makeTokenHandler(), makeSearchHandler());

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 9);

      expect(result.card).toEqual(testCard);
      expect(result.listings).toHaveLength(2);
      expect(result.totalFound).toBe(2);
      expect(result.scannedAt).toBeTruthy();
    });

    it('parses listing fields correctly from eBay API response', async () => {
      server.use(makeTokenHandler(), makeSearchHandler());

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 9);

      const first = result.listings[0]!;
      expect(first.itemId).toBe('v1|123456|0');
      expect(first.price).toBe(4500);
      expect(first.shippingCost).toBe(0);
      expect(first.totalPrice).toBe(4500);
      expect(first.listingType).toBe('BuyItNow');
      expect(first.sellerUsername).toBe('top_seller');
      expect(first.sellerFeedbackScore).toBe(5000);
      expect(first.sellerFeedbackPercent).toBe(99.8);
      expect(first.imageUrl).toBe('https://i.ebayimg.com/images/g/test.jpg');
      expect(first.itemUrl).toBe('https://www.ebay.com/itm/123456');
    });

    it('maps AUCTION buyingOption to Auction listingType', async () => {
      server.use(makeTokenHandler(), makeSearchHandler());

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 9);

      const auction = result.listings[1]!;
      expect(auction.listingType).toBe('Auction');
      expect(auction.endDate).toBe('2026-02-20T18:00:00Z');
    });

    it('maps bidCount from eBay API response', async () => {
      server.use(makeTokenHandler(), makeSearchHandler());

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 9);

      // BIN listing has no bidCount
      expect(result.listings[0]!.bidCount).toBeUndefined();
      // Auction listing has bidCount: 7
      expect(result.listings[1]!.bidCount).toBe(7);
    });

    it('returns empty listings array when itemSummaries is absent', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({ total: 0 }),
        ),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 9);

      expect(result.listings).toHaveLength(0);
      expect(result.totalFound).toBe(0);
    });
  });

  describe('scan() — error boundary', () => {
    it('returns empty ScanResult (not throws) when eBay API returns 401', async () => {
      server.use(makeTokenHandler(401));

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 9);

      expect(result.card).toEqual(testCard);
      expect(result.listings).toHaveLength(0);
      expect(result.totalFound).toBe(0);
      expect(result.scannedAt).toBeTruthy();
    });

    it('calls console.error when scan fails', async () => {
      server.use(makeTokenHandler(401));

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scan(testCard, 9);

      expect(console.error).toHaveBeenCalledOnce();
      expect(vi.mocked(console.error).mock.calls[0]?.[0]).toContain(
        '[EbayScanner]',
      );
    });

    it('returns empty ScanResult when browse API returns 401 after successful auth', async () => {
      server.use(makeTokenHandler(), makeSearchHandler(401));

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 9);

      expect(result.listings).toHaveLength(0);
      expect(result.totalFound).toBe(0);
    });
  });

  describe('buildSearchQuery()', () => {
    it('includes card name, variant, number, and grade but excludes set name', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scan(testCard, 9);

      const url = new URL(capturedUrl);
      const query = url.searchParams.get('q') ?? '';
      expect(query).toContain('Charizard');
      expect(query).not.toContain('Base Set'); // set name intentionally excluded
      expect(query).toContain('1st Edition');
      expect(query).toContain('4');
      expect(query).toContain('PSA 9');
    });

    it('omits grade from query when not specified', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scan(testCard); // no grade

      const url = new URL(capturedUrl);
      const query = url.searchParams.get('q') ?? '';
      expect(query).not.toContain('PSA');
    });
  });

  describe('searchByQuery()', () => {
    it('returns EbayListing array for a raw text query', async () => {
      server.use(makeTokenHandler(), makeSearchHandler());

      const scanner = new EbayScanner(TEST_CONFIG);
      const listings = await scanner.searchByQuery('Charizard Base Set PSA 9');

      expect(listings).toHaveLength(2);
      expect(listings[0]!.itemId).toBe('v1|123456|0');
      expect(listings[0]!.price).toBe(4500);
      expect(listings[1]!.listingType).toBe('Auction');
    });

    it('passes grade and grader options through to searchListings', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.searchByQuery('Charizard', { grade: 10, grader: 'BGS' });

      const url = new URL(capturedUrl);
      const aspectFilter = url.searchParams.get('aspect_filter') ?? '';
      expect(aspectFilter).toContain('Beckett (BGS)');
      expect(aspectFilter).toContain('10');
    });

    it('returns empty array when eBay returns no results', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({ total: 0 }),
        ),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      const listings = await scanner.searchByQuery('nonexistent card xyz');

      expect(listings).toHaveLength(0);
    });
  });

  describe('grader filtering', () => {
    function makeListingItem(title: string, itemId = 'v1|999|0') {
      return {
        itemId,
        title,
        price: { value: '100.00', currency: 'USD' },
        shippingOptions: [],
        buyingOptions: ['FIXED_PRICE'],
        seller: { username: 'test', feedbackScore: 100, feedbackPercentage: '99.0' },
        itemWebUrl: `https://www.ebay.com/itm/${itemId}`,
      };
    }

    it('filters out BGS listings when searching for PSA grade', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 3,
            itemSummaries: [
              makeListingItem('Charizard 1st Edition PSA 10 Base Set', 'v1|001|0'),
              makeListingItem('Charizard 1st Edition BGS 10 Base Set', 'v1|002|0'),
              makeListingItem('Charizard 1st Edition CGC 10 Base Set', 'v1|003|0'),
            ],
          }),
        ),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 10);

      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]!.title).toContain('PSA');
    });

    it('keeps listing when title contains both PSA and BGS', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 2,
            itemSummaries: [
              makeListingItem('Charizard 1st Edition PSA 10 (not BGS) Base Set', 'v1|001|0'),
              makeListingItem('Charizard 1st Edition BGS 9.5 Beckett', 'v1|002|0'),
            ],
          }),
        ),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 10);

      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]!.title).toContain('PSA');
      expect(result.listings[0]!.title).toContain('BGS');
    });

    it('returns all listings when no grade specified', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 3,
            itemSummaries: [
              makeListingItem('Charizard 1st Edition PSA 10', 'v1|001|0'),
              makeListingItem('Charizard 1st Edition BGS 10', 'v1|002|0'),
              makeListingItem('Charizard 1st Edition Raw NM', 'v1|003|0'),
            ],
          }),
        ),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard); // no grade

      expect(result.listings).toHaveLength(3);
    });

    it('uses BGS in query and aspect_filter when grader=BGS', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scan(testCard, 10, 'BGS');

      const url = new URL(capturedUrl);
      const query = url.searchParams.get('q') ?? '';
      expect(query).toContain('BGS 10');
      expect(query).not.toContain('PSA');

      const aspectFilter = url.searchParams.get('aspect_filter') ?? '';
      expect(aspectFilter).toContain('Beckett (BGS)');
    });

    it('filters out listings with "not PSA" in title', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 2,
            itemSummaries: [
              makeListingItem('Charizard 1st Edition PSA 10 Base Set', 'v1|001|0'),
              makeListingItem('GG 9 Charizard 1st Edition EX 199/165 GetGraded not psa 10', 'v1|002|0'),
            ],
          }),
        ),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 10);

      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]!.title).toContain('PSA');
      expect(result.listings[0]!.title).not.toContain('not psa');
    });

    it('filters out listings from unknown graders without PSA in title', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 3,
            itemSummaries: [
              makeListingItem('Charizard 1st Edition PSA 10 Base Set', 'v1|001|0'),
              makeListingItem('Charizard 1st Edition GetGraded GG 10 Base Set', 'v1|002|0'),
              makeListingItem('Charizard 1st Edition ACE 10 Holo', 'v1|003|0'),
            ],
          }),
        ),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 10);

      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]!.title).toContain('PSA');
    });

    it('keeps legitimate PSA listing that also mentions non-standard grader', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 2,
            itemSummaries: [
              makeListingItem('PSA 10 Charizard 1st Edition (better than GG)', 'v1|001|0'),
              makeListingItem('Charizard 1st Edition GetGraded GG 10', 'v1|002|0'),
            ],
          }),
        ),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 10);

      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]!.title).toContain('PSA');
    });

    it('filters out PSA listings when searching for BGS', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 3,
            itemSummaries: [
              makeListingItem('Charizard 1st Edition BGS 10 Base Set', 'v1|001|0'),
              makeListingItem('Charizard 1st Edition PSA 10 Base Set', 'v1|002|0'),
              makeListingItem('Charizard 1st Edition CGC 10 Base Set', 'v1|003|0'),
            ],
          }),
        ),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(testCard, 10, 'BGS');

      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]!.title).toContain('BGS');
    });
  });

  describe('scan() with EbaySearchOverride', () => {
    const shadowlessCard: ResolvedCard = {
      id: '106999',
      name: 'Charizard',
      setName: 'Base Set (Shadowless)',
      setCode: 'base1s',
      number: '004/102',
      year: 1999,
      rarity: 'Rare Holo',
      variant: 'Shadowless',
      confidence: 0.95,
    };

    function makeListingItem(title: string, itemId = 'v1|999|0') {
      return {
        itemId,
        title,
        price: { value: '5000.00', currency: 'USD' },
        shippingOptions: [],
        buyingOptions: ['FIXED_PRICE'],
        seller: { username: 'test', feedbackScore: 100, feedbackPercentage: '99.0' },
        itemWebUrl: `https://www.ebay.com/itm/${itemId}`,
      };
    }

    it('uses customQuery instead of auto-generated query when override has customQuery', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const override: EbaySearchOverride = {
        cardId: '106999',
        customQuery: 'Charizard Base Set Shadowless',
        notes: 'Custom query for shadowless',
        createdAt: new Date().toISOString(),
      };

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scan(shadowlessCard, 9, 'PSA', override);

      const url = new URL(capturedUrl);
      const query = url.searchParams.get('q') ?? '';
      expect(query).toBe('Charizard Base Set Shadowless PSA 9');
    });

    it('appends grade label to customQuery', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const override: EbaySearchOverride = {
        cardId: '106999',
        customQuery: 'Charizard Shadowless Base',
        notes: 'test',
        createdAt: new Date().toISOString(),
      };

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scan(shadowlessCard, 10, 'PSA', override);

      const url = new URL(capturedUrl);
      const query = url.searchParams.get('q') ?? '';
      expect(query).toContain('PSA 10');
      expect(query).toContain('Charizard Shadowless Base');
    });

    it('uses customQuery without grade label when no grade specified', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const override: EbaySearchOverride = {
        cardId: '106999',
        customQuery: 'Charizard Shadowless Base',
        notes: 'test',
        createdAt: new Date().toISOString(),
      };

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scan(shadowlessCard, undefined, 'PSA', override);

      const url = new URL(capturedUrl);
      const query = url.searchParams.get('q') ?? '';
      expect(query).toBe('Charizard Shadowless Base');
    });

    it('filters listings by excludeKeywords from override', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 3,
            itemSummaries: [
              makeListingItem('Charizard Shadowless PSA 9 Base Set', 'v1|001|0'),
              makeListingItem('Charizard Shadowless Celebrations Classic Collection PSA 9', 'v1|002|0'),
              makeListingItem('Charizard Shadowless PSA 9 Base Set Holo', 'v1|003|0'),
            ],
          }),
        ),
      );

      const override: EbaySearchOverride = {
        cardId: '106999',
        excludeKeywords: ['celebrations', 'classic collection'],
        notes: 'Exclude reprints',
        createdAt: new Date().toISOString(),
      };

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(shadowlessCard, 9, 'PSA', override);

      expect(result.listings).toHaveLength(2);
      expect(result.listings.every((l) => !l.title.toLowerCase().includes('celebrations'))).toBe(true);
    });

    it('filters listings by requiredKeywords from override', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 3,
            itemSummaries: [
              makeListingItem('Charizard Shadowless PSA 9 Base Set', 'v1|001|0'),
              makeListingItem('Charizard PSA 9 Base Set Holo', 'v1|002|0'),
              makeListingItem('Charizard Shadowless 1st Edition PSA 9', 'v1|003|0'),
            ],
          }),
        ),
      );

      const override: EbaySearchOverride = {
        cardId: '106999',
        requiredKeywords: ['shadowless'],
        notes: 'Must say shadowless',
        createdAt: new Date().toISOString(),
      };

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(shadowlessCard, 9, 'PSA', override);

      expect(result.listings).toHaveLength(2);
      expect(result.listings.every((l) => l.title.toLowerCase().includes('shadowless'))).toBe(true);
    });

    it('scan without override works unchanged', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scan(shadowlessCard, 9);

      const url = new URL(capturedUrl);
      const query = url.searchParams.get('q') ?? '';
      // Default behavior: name + variant + number + grade
      expect(query).toContain('Charizard');
      expect(query).toContain('Shadowless');
      expect(query).toContain('004/102');
      expect(query).toContain('PSA 9');
    });
  });

  describe('getTrending()', () => {
    function makeTrendingHandler(status = 200) {
      if (status === 200) {
        return http.get(EBAY_BROWSE_URL, ({ request }) => {
          const url = new URL(request.url);
          const query = url.searchParams.get('q') ?? '';
          if (!query.includes('PSA Pokemon card')) {
            return HttpResponse.json({ total: 0 });
          }
          return HttpResponse.json({
            total: 3,
            itemSummaries: [
              {
                itemId: 'v1|trending1|0',
                title: 'Pikachu VMAX PSA 10 Vivid Voltage',
                price: { value: '150.00', currency: 'USD' },
                shippingOptions: [{ shippingCost: { value: '5.00', currency: 'USD' } }],
                buyingOptions: ['FIXED_PRICE'],
                seller: { username: 'trending_seller', feedbackScore: 3000, feedbackPercentage: '99.5' },
                image: { imageUrl: 'https://i.ebayimg.com/trending1.jpg' },
                itemWebUrl: 'https://www.ebay.com/itm/trending1',
              },
              {
                itemId: 'v1|trending2|0',
                title: 'Charizard ex PSA 9 Obsidian Flames',
                price: { value: '85.00', currency: 'USD' },
                shippingOptions: [],
                buyingOptions: ['AUCTION'],
                seller: { username: 'card_shop', feedbackScore: 800, feedbackPercentage: '98.0' },
                image: { imageUrl: 'https://i.ebayimg.com/trending2.jpg' },
                itemWebUrl: 'https://www.ebay.com/itm/trending2',
                itemEndDate: '2026-03-01T18:00:00Z',
              },
              {
                itemId: 'v1|trending3|0',
                title: 'Mewtwo GX PSA 10 Hidden Fates',
                price: { value: '200.00', currency: 'USD' },
                shippingOptions: [{ shippingCost: { value: '0.00', currency: 'USD' } }],
                buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'],
                seller: { username: 'pokemon_deals', feedbackScore: 5000, feedbackPercentage: '99.9' },
                itemWebUrl: 'https://www.ebay.com/itm/trending3',
              },
            ],
          });
        });
      }
      return http.get(EBAY_BROWSE_URL, () =>
        HttpResponse.json({ errors: [{ message: 'Unauthorized' }] }, { status }),
      );
    }

    it('returns trending listings sorted by newlyListed', async () => {
      server.use(makeTokenHandler(), makeTrendingHandler());

      const scanner = new EbayScanner(TEST_CONFIG);
      const listings = await scanner.getTrending();

      expect(listings).toHaveLength(3);
      expect(listings[0]!.title).toContain('Pikachu');
      expect(listings[0]!.imageUrl).toBe('https://i.ebayimg.com/trending1.jpg');
      expect(listings[0]!.price).toBe(150);
      expect(listings[0]!.shippingCost).toBe(5);
      expect(listings[0]!.totalPrice).toBe(155);
    });

    it('sends correct query params (sort=newlyListed, graded category)', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.getTrending(10);

      const url = new URL(capturedUrl);
      expect(url.searchParams.get('q')).toBe('PSA Pokemon card');
      expect(url.searchParams.get('sort')).toBe('newlyListed');
      expect(url.searchParams.get('category_ids')).toBe('183454');
      expect(url.searchParams.get('limit')).toBe('10');
    });

    it('returns empty array on API error (no throw)', async () => {
      server.use(makeTokenHandler(), makeTrendingHandler(500));

      const scanner = new EbayScanner(TEST_CONFIG);
      const listings = await scanner.getTrending();

      expect(listings).toHaveLength(0);
      expect(console.error).toHaveBeenCalledOnce();
    });

    it('returns empty array on auth failure (no throw)', async () => {
      server.use(makeTokenHandler(401));

      const scanner = new EbayScanner(TEST_CONFIG);
      const listings = await scanner.getTrending();

      expect(listings).toHaveLength(0);
    });

    it('returns empty array when no itemSummaries in response', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () => HttpResponse.json({ total: 0 })),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      const listings = await scanner.getTrending();

      expect(listings).toHaveLength(0);
    });
  });

  describe('inferVariantKeywords()', () => {
    it('extracts "Shadowless" from "Base Set (Shadowless)" set name', () => {
      const card: ResolvedCard = {
        id: '106999', name: 'Charizard', setName: 'Base Set (Shadowless)',
        setCode: 'base1s', number: '004/102', year: 1999, confidence: 0.95,
      };
      expect(inferVariantKeywords(card)).toEqual(['Shadowless']);
    });

    it('returns variant field when populated', () => {
      const card: ResolvedCard = {
        id: '1', name: 'Mew', setName: 'Some Set',
        setCode: 'ss', number: '1', year: 2020, variant: 'Alt Art', confidence: 1,
      };
      expect(inferVariantKeywords(card)).toEqual(['Alt Art']);
    });

    it('returns empty array for plain set name with no variant', () => {
      const card: ResolvedCard = {
        id: '1', name: 'Pikachu', setName: 'Evolving Skies',
        setCode: 'evs', number: '1', year: 2021, confidence: 1,
      };
      expect(inferVariantKeywords(card)).toEqual([]);
    });

    it('returns empty array for "Base Set" without parenthetical', () => {
      const card: ResolvedCard = {
        id: '1', name: 'Charizard', setName: 'Base Set',
        setCode: 'base1', number: '4', year: 1999, confidence: 1,
      };
      expect(inferVariantKeywords(card)).toEqual([]);
    });

    it('extracts "1st Edition" from set name parenthetical', () => {
      const card: ResolvedCard = {
        id: '1', name: 'Blastoise', setName: 'Base Set (1st Edition)',
        setCode: 'base1e', number: '2', year: 1999, confidence: 1,
      };
      expect(inferVariantKeywords(card)).toEqual(['1st Edition']);
    });

    it('prefers variant field over setName parenthetical', () => {
      const card: ResolvedCard = {
        id: '1', name: 'Charizard', setName: 'Base Set (Shadowless)',
        setCode: 'base1s', number: '4', year: 1999, variant: 'Shadowless', confidence: 1,
      };
      // variant field takes priority — returns variant, not parenthetical
      expect(inferVariantKeywords(card)).toEqual(['Shadowless']);
    });
  });

  describe('scan() — auto variant filtering', () => {
    const shadowlessCard: ResolvedCard = {
      id: '106999', name: 'Charizard', setName: 'Base Set (Shadowless)',
      setCode: 'base1s', number: '004/102', year: 1999, confidence: 0.95,
    };

    function makeListingItem(title: string, itemId = 'v1|999|0') {
      return {
        itemId,
        title,
        price: { value: '5000.00', currency: 'USD' },
        shippingOptions: [],
        buyingOptions: ['FIXED_PRICE'],
        seller: { username: 'test', feedbackScore: 100, feedbackPercentage: '99.0' },
        itemWebUrl: `https://www.ebay.com/itm/${itemId}`,
      };
    }

    it('auto-filters listings missing variant keyword from set name', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 3,
            itemSummaries: [
              makeListingItem('Charizard Shadowless PSA 10 Base Set', 'v1|001|0'),
              makeListingItem('Charizard PSA 10 Base Set Unlimited', 'v1|002|0'),
              makeListingItem('Charizard PSA 10 Base Set Holo', 'v1|003|0'),
            ],
          }),
        ),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(shadowlessCard, 10);

      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]!.title).toContain('Shadowless');
    });

    it('does not auto-filter when customQuery override is set', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 2,
            itemSummaries: [
              makeListingItem('Charizard Shadowless PSA 10', 'v1|001|0'),
              makeListingItem('Charizard PSA 10 Base Set', 'v1|002|0'),
            ],
          }),
        ),
      );

      const override: EbaySearchOverride = {
        cardId: '106999',
        customQuery: 'Charizard Base Set',
        notes: 'Custom query',
        createdAt: new Date().toISOString(),
      };

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(shadowlessCard, 10, 'PSA', override);

      // Both returned — auto-filter skipped because customQuery is present
      expect(result.listings).toHaveLength(2);
    });

    it('does not filter for cards without variant keywords', async () => {
      const plainCard: ResolvedCard = {
        id: 'base1-4', name: 'Charizard', setName: 'Base Set',
        setCode: 'base1', number: '4', year: 1999, confidence: 1,
      };

      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 2,
            itemSummaries: [
              makeListingItem('Charizard PSA 10 Base Set', 'v1|001|0'),
              makeListingItem('Charizard PSA 10 Holo', 'v1|002|0'),
            ],
          }),
        ),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(plainCard, 10);

      expect(result.listings).toHaveLength(2);
    });

    it('auto-filter stacks with manual override filter', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 3,
            itemSummaries: [
              makeListingItem('Charizard Shadowless PSA 10 Base Set', 'v1|001|0'),
              makeListingItem('Charizard Shadowless Celebrations PSA 10', 'v1|002|0'),
              makeListingItem('Charizard PSA 10 Unlimited', 'v1|003|0'),
            ],
          }),
        ),
      );

      const override: EbaySearchOverride = {
        cardId: '106999',
        excludeKeywords: ['celebrations'],
        notes: 'Exclude reprints',
        createdAt: new Date().toISOString(),
      };

      const scanner = new EbayScanner(TEST_CONFIG);
      const result = await scanner.scan(shadowlessCard, 10, 'PSA', override);

      // v1|003 filtered by auto-filter (no "Shadowless"), v1|002 filtered by override (celebrations)
      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]!.itemId).toBe('v1|001|0');
    });
  });

  describe('titleMatchesVariant()', () => {
    it('matches exact substring (case-insensitive)', () => {
      expect(titleMatchesVariant('psa 10 mew ex special illustration rare', 'Special Illustration Rare')).toBe(true);
    });

    it('matches known abbreviation "SIR" for "Special Illustration Rare"', () => {
      expect(titleMatchesVariant('PSA 10 Mew ex SIR 232/091 Paldean Fates', 'SPECIAL ILLUSTRATION RARE')).toBe(true);
    });

    it('matches known abbreviation "SAR" for "Special Art Rare"', () => {
      expect(titleMatchesVariant('PSA 10 Charizard SAR 201', 'Special Art Rare')).toBe(true);
    });

    it('matches "FA" for "Full Art"', () => {
      expect(titleMatchesVariant('Pikachu VMAX FA PSA 10', 'Full Art')).toBe(true);
    });

    it('does not match when neither full phrase nor abbreviation present', () => {
      expect(titleMatchesVariant('PSA 10 Mew ex 232 Paldean Fates', 'SPECIAL ILLUSTRATION RARE')).toBe(false);
    });

    it('does not false-match "SIR" inside other words', () => {
      // "desire" contains "sir" but not as a word boundary
      expect(titleMatchesVariant('Desire Pokemon Card PSA 10', 'SPECIAL ILLUSTRATION RARE')).toBe(false);
    });

    it('matches single-word variants directly', () => {
      expect(titleMatchesVariant('Charizard Shadowless PSA 10', 'Shadowless')).toBe(true);
    });

    it('returns false for unmatched single-word variant', () => {
      expect(titleMatchesVariant('Charizard PSA 10 Unlimited', 'Shadowless')).toBe(false);
    });

    it('matches multi-word non-rarity variant via word splitting ("POKEMON X VAN GOGH")', () => {
      expect(titleMatchesVariant(
        'PSA 10 Pikachu Grey Felt Hat Promo Card Pokemon x Van Gogh Museum SVP EN 085',
        'POKEMON X VAN GOGH',
      )).toBe(true);
    });

    it('matches word-split variant even when words are separated in title', () => {
      expect(titleMatchesVariant(
        'Pikachu Van Gogh Museum PSA 10',
        'POKEMON X VAN GOGH',
      )).toBe(true);
    });

    it('rejects word-split variant when distinctive words are missing', () => {
      // "van" present but "gogh" missing
      expect(titleMatchesVariant(
        'PSA 10 Pikachu Van Promo SVP 085',
        'POKEMON X VAN GOGH',
      )).toBe(false);
    });
  });

  describe('scanAuctions()', () => {
    function makeAuctionListingItem(title: string, itemId = 'v1|999|0', endDate = '2026-03-05T18:00:00Z') {
      return {
        itemId,
        title,
        price: { value: '100.00', currency: 'USD' },
        shippingOptions: [],
        buyingOptions: ['AUCTION'],
        seller: { username: 'test', feedbackScore: 100, feedbackPercentage: '99.0' },
        itemWebUrl: `https://www.ebay.com/itm/${itemId}`,
        itemEndDate: endDate,
        bidCount: 3,
      };
    }

    it('uses simplified query without grade or long variant phrases', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const sirCard: ResolvedCard = {
        id: 'paf-232',
        name: 'Mew ex',
        setName: 'Paldean Fates',
        setCode: 'paf',
        number: '232',
        year: 2024,
        variant: 'SPECIAL ILLUSTRATION RARE',
        confidence: 1.0,
      };

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scanAuctions(sirCard, 10);

      const url = new URL(capturedUrl);
      const query = url.searchParams.get('q') ?? '';
      expect(query).toContain('Mew ex');
      expect(query).toContain('232');
      // Long variant excluded from auction query
      expect(query).not.toContain('SPECIAL ILLUSTRATION RARE');
      // Grade not in text query — aspect_filter handles it
      expect(query).not.toContain('PSA');
    });

    it('includes short variant terms in query', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scanAuctions(testCard, 9);

      const url = new URL(capturedUrl);
      const query = url.searchParams.get('q') ?? '';
      expect(query).toContain('Charizard');
      expect(query).toContain('1st Edition');
      expect(query).toContain('4');
      expect(query).not.toContain('PSA');
    });

    it('sends auction filter and endingSoonest sort', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scanAuctions(testCard, 10);

      const url = new URL(capturedUrl);
      expect(url.searchParams.get('filter')).toBe('buyingOptions:{AUCTION}');
      expect(url.searchParams.get('sort')).toBe('endingSoonest');
      expect(url.searchParams.get('category_ids')).toBe('183454');
    });

    it('applies aspect_filter for grade and grader', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scanAuctions(testCard, 10, 'PSA');

      const url = new URL(capturedUrl);
      const aspectFilter = url.searchParams.get('aspect_filter') ?? '';
      expect(aspectFilter).toContain('PSA');
      expect(aspectFilter).toContain('10');
    });

    it('returns auction listings with abbreviation-aware variant filtering', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 3,
            itemSummaries: [
              makeAuctionListingItem('PSA 10 Mew ex SIR 232/091 Paldean Fates', 'v1|001|0'),
              makeAuctionListingItem('PSA 10 Mew ex 232 Special Illustration Rare', 'v1|002|0'),
              makeAuctionListingItem('PSA 10 Pikachu VMAX 044 Vivid Voltage', 'v1|003|0'),
            ],
          }),
        ),
      );

      const sirCard: ResolvedCard = {
        id: 'paf-232',
        name: 'Mew ex',
        setName: 'Paldean Fates',
        setCode: 'paf',
        number: '232',
        year: 2024,
        variant: 'SPECIAL ILLUSTRATION RARE',
        confidence: 1.0,
      };

      const scanner = new EbayScanner(TEST_CONFIG);
      const auctions = await scanner.scanAuctions(sirCard, 10);

      // SIR abbreviation and full phrase both match; Pikachu listing filtered out
      expect(auctions).toHaveLength(2);
      expect(auctions[0]!.itemId).toBe('v1|001|0');
      expect(auctions[1]!.itemId).toBe('v1|002|0');
    });

    it('cleans slashes from card name in auction query', async () => {
      let capturedUrl = '';
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ total: 0 });
        }),
      );

      const vanGoghCard: ResolvedCard = {
        id: 'svp-085',
        name: 'PIKACHU/GREY FELT HAT',
        setName: 'POKEMON SVP EN-SV BLACK STAR PROMO',
        setCode: 'svp',
        number: '085',
        year: 2023,
        variant: 'POKEMON X VAN GOGH',
        confidence: 1.0,
      };

      const scanner = new EbayScanner(TEST_CONFIG);
      await scanner.scanAuctions(vanGoghCard, 10);

      const url = new URL(capturedUrl);
      const query = url.searchParams.get('q') ?? '';
      // Slash replaced with space
      expect(query).toContain('PIKACHU GREY FELT HAT');
      expect(query).not.toContain('/');
      expect(query).toContain('085');
      // Long variant excluded
      expect(query).not.toContain('VAN GOGH');
    });

    it('finds Van Gogh auctions via word-split variant matching', async () => {
      server.use(
        makeTokenHandler(),
        http.get(EBAY_BROWSE_URL, () =>
          HttpResponse.json({
            total: 3,
            itemSummaries: [
              makeAuctionListingItem('PSA 10 Pikachu Grey Felt Hat Pokemon x Van Gogh Museum SVP EN 085', 'v1|001|0'),
              makeAuctionListingItem('PSA 10 Pikachu Grey Felt Hat Van Gogh Promo 085', 'v1|002|0'),
              makeAuctionListingItem('PSA 10 Pikachu VMAX Rainbow 044', 'v1|003|0'),
            ],
          }),
        ),
      );

      const vanGoghCard: ResolvedCard = {
        id: 'svp-085',
        name: 'PIKACHU/GREY FELT HAT',
        setName: 'POKEMON SVP EN-SV BLACK STAR PROMO',
        setCode: 'svp',
        number: '085',
        year: 2023,
        variant: 'POKEMON X VAN GOGH',
        confidence: 1.0,
      };

      const scanner = new EbayScanner(TEST_CONFIG);
      const auctions = await scanner.scanAuctions(vanGoghCard, 10);

      // Both Van Gogh listings match via word-split ("van" + "gogh"); Pikachu VMAX filtered out
      expect(auctions).toHaveLength(2);
      expect(auctions[0]!.itemId).toBe('v1|001|0');
      expect(auctions[1]!.itemId).toBe('v1|002|0');
    });

    it('returns empty array on error (no throw)', async () => {
      server.use(makeTokenHandler(401));

      const scanner = new EbayScanner(TEST_CONFIG);
      const auctions = await scanner.scanAuctions(testCard, 10);

      expect(auctions).toHaveLength(0);
    });
  });
});
