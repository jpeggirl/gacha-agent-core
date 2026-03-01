import { describe, it, expect, beforeEach } from 'vitest';
import { EbayOverrideRegistry } from './ebay-overrides.js';
import type { StorageAdapter, EbaySearchOverride, EbayListing, ResolvedCard, ListingReport } from '../types/index.js';

function makeInMemoryStorage(): StorageAdapter {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | null> {
      const val = data.get(key);
      return val !== undefined ? (val as T) : null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      data.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return data.delete(key);
    },
    async list(prefix: string): Promise<string[]> {
      return Array.from(data.keys()).filter((k) => k.startsWith(prefix));
    },
  };
}

function makeListing(title: string, itemId = 'v1|test|0'): EbayListing {
  return {
    itemId,
    title,
    price: 100,
    currency: 'USD',
    shippingCost: 0,
    totalPrice: 100,
    listingType: 'BuyItNow',
    sellerUsername: 'test_seller',
    sellerFeedbackScore: 1000,
    sellerFeedbackPercent: 99.5,
    itemUrl: `https://www.ebay.com/itm/${itemId}`,
  };
}

describe('EbayOverrideRegistry', () => {
  let registry: EbayOverrideRegistry;

  beforeEach(() => {
    registry = new EbayOverrideRegistry(makeInMemoryStorage());
  });

  describe('CRUD operations', () => {
    it('set() stores and returns override with createdAt', async () => {
      const override = await registry.set({
        cardId: '106999',
        requiredKeywords: ['shadowless'],
        excludeKeywords: ['celebrations'],
        notes: 'Test override',
      });

      expect(override.cardId).toBe('106999');
      expect(override.requiredKeywords).toEqual(['shadowless']);
      expect(override.excludeKeywords).toEqual(['celebrations']);
      expect(override.createdAt).toBeTruthy();
    });

    it('get() returns stored override', async () => {
      await registry.set({
        cardId: '106999',
        notes: 'Test',
      });

      const result = await registry.get('106999');
      expect(result).not.toBeNull();
      expect(result!.cardId).toBe('106999');
    });

    it('get() returns null for nonexistent cardId', async () => {
      const result = await registry.get('nonexistent');
      expect(result).toBeNull();
    });

    it('getAll() returns all stored overrides', async () => {
      await registry.set({ cardId: '100', notes: 'First' });
      await registry.set({ cardId: '200', notes: 'Second' });
      await registry.set({ cardId: '300', notes: 'Third' });

      const all = await registry.getAll();
      expect(all).toHaveLength(3);
      expect(all.map((o) => o.cardId).sort()).toEqual(['100', '200', '300']);
    });

    it('getAll() returns empty array when no overrides exist', async () => {
      const all = await registry.getAll();
      expect(all).toHaveLength(0);
    });

    it('delete() removes override and returns true', async () => {
      await registry.set({ cardId: '106999', notes: 'To delete' });
      const deleted = await registry.delete('106999');
      expect(deleted).toBe(true);

      const result = await registry.get('106999');
      expect(result).toBeNull();
    });

    it('delete() returns false for nonexistent cardId', async () => {
      const deleted = await registry.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('set() overwrites existing override for same cardId', async () => {
      await registry.set({ cardId: '106999', notes: 'Original' });
      await registry.set({
        cardId: '106999',
        excludeKeywords: ['celebrations'],
        notes: 'Updated',
      });

      const result = await registry.get('106999');
      expect(result!.notes).toBe('Updated');
      expect(result!.excludeKeywords).toEqual(['celebrations']);
    });
  });

  describe('applyTitleFilter()', () => {
    it('filters out listings matching excludeKeywords (case-insensitive)', () => {
      const listings = [
        makeListing('Charizard Shadowless PSA 9 Base Set', 'v1|001|0'),
        makeListing('Charizard Celebrations Classic Collection PSA 9', 'v1|002|0'),
        makeListing('Charizard Base Set PSA 9 Holo', 'v1|003|0'),
      ];
      const override: EbaySearchOverride = {
        cardId: '106999',
        excludeKeywords: ['celebrations', 'classic collection'],
        notes: 'test',
        createdAt: new Date().toISOString(),
      };

      const filtered = EbayOverrideRegistry.applyTitleFilter(listings, override);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((l) => l.itemId)).toEqual(['v1|001|0', 'v1|003|0']);
    });

    it('keeps only listings matching all requiredKeywords', () => {
      const listings = [
        makeListing('Charizard Shadowless PSA 9 Base Set', 'v1|001|0'),
        makeListing('Charizard PSA 9 Base Set Holo', 'v1|002|0'),
        makeListing('Charizard Shadowless 1st Edition PSA 9', 'v1|003|0'),
      ];
      const override: EbaySearchOverride = {
        cardId: '106999',
        requiredKeywords: ['shadowless'],
        notes: 'test',
        createdAt: new Date().toISOString(),
      };

      const filtered = EbayOverrideRegistry.applyTitleFilter(listings, override);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((l) => l.itemId)).toEqual(['v1|001|0', 'v1|003|0']);
    });

    it('applies both required and exclude keywords together', () => {
      const listings = [
        makeListing('Charizard Shadowless PSA 9 Base Set', 'v1|001|0'),
        makeListing('Charizard Shadowless Celebrations PSA 9', 'v1|002|0'),
        makeListing('Charizard PSA 9 Holo', 'v1|003|0'),
      ];
      const override: EbaySearchOverride = {
        cardId: '106999',
        requiredKeywords: ['shadowless'],
        excludeKeywords: ['celebrations'],
        notes: 'test',
        createdAt: new Date().toISOString(),
      };

      const filtered = EbayOverrideRegistry.applyTitleFilter(listings, override);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.itemId).toBe('v1|001|0');
    });

    it('requires ALL required keywords to be present', () => {
      const listings = [
        makeListing('Charizard Shadowless 1st Edition PSA 9', 'v1|001|0'),
        makeListing('Charizard Shadowless PSA 9', 'v1|002|0'),
        makeListing('Charizard 1st Edition PSA 9', 'v1|003|0'),
      ];
      const override: EbaySearchOverride = {
        cardId: '106999',
        requiredKeywords: ['shadowless', '1st edition'],
        notes: 'test',
        createdAt: new Date().toISOString(),
      };

      const filtered = EbayOverrideRegistry.applyTitleFilter(listings, override);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.itemId).toBe('v1|001|0');
    });

    it('returns all listings when no keywords specified', () => {
      const listings = [
        makeListing('Charizard PSA 9', 'v1|001|0'),
        makeListing('Pikachu PSA 10', 'v1|002|0'),
      ];
      const override: EbaySearchOverride = {
        cardId: '106999',
        notes: 'No filters',
        createdAt: new Date().toISOString(),
      };

      const filtered = EbayOverrideRegistry.applyTitleFilter(listings, override);
      expect(filtered).toHaveLength(2);
    });

    it('handles case-insensitive matching for excludeKeywords', () => {
      const listings = [
        makeListing('Charizard CELEBRATIONS Classic PSA 9', 'v1|001|0'),
        makeListing('Charizard Base Set PSA 9', 'v1|002|0'),
      ];
      const override: EbaySearchOverride = {
        cardId: '106999',
        excludeKeywords: ['celebrations'],
        notes: 'test',
        createdAt: new Date().toISOString(),
      };

      const filtered = EbayOverrideRegistry.applyTitleFilter(listings, override);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.itemId).toBe('v1|002|0');
    });
  });

  describe('report storage', () => {
    it('stores and retrieves reports by cardId', async () => {
      const report: ListingReport = {
        id: 'rpt_test1',
        ebayItemId: 'v1|123|0',
        ebayTitle: 'Charizard PSA 10 Base Set',
        ebayUrl: 'https://ebay.com/itm/123',
        cardId: '106999',
        cardName: 'Charizard',
        grade: 10,
        reportedSignal: 'strong_buy',
        reportedScore: 90,
        reportedFmv: 5000,
        reportedPrice: 100,
        timestamp: new Date().toISOString(),
      };

      await registry.storeReport(report);
      const reports = await registry.getReports('106999');
      expect(reports).toHaveLength(1);
      expect(reports[0]!.id).toBe('rpt_test1');
    });

    it('returns empty array when no reports exist', async () => {
      const reports = await registry.getReports('nonexistent');
      expect(reports).toHaveLength(0);
    });

    it('appends multiple reports for same card', async () => {
      const base: ListingReport = {
        id: 'rpt_1',
        ebayItemId: 'v1|1|0',
        ebayTitle: 'Charizard PSA 10',
        ebayUrl: 'https://ebay.com/itm/1',
        cardId: '106999',
        cardName: 'Charizard',
        grade: 10,
        reportedSignal: 'strong_buy',
        reportedScore: 90,
        reportedFmv: 5000,
        reportedPrice: 100,
        timestamp: new Date().toISOString(),
      };

      await registry.storeReport({ ...base, id: 'rpt_1' });
      await registry.storeReport({ ...base, id: 'rpt_2' });
      const reports = await registry.getReports('106999');
      expect(reports).toHaveLength(2);
    });
  });

  describe('suggestFromReport()', () => {
    const shadowlessCard: ResolvedCard = {
      id: '106999',
      name: 'Charizard',
      setName: 'Base Set (Shadowless)',
      setCode: 'base1s',
      number: '004/102',
      year: 1999,
      confidence: 0.95,
    };

    function makeReport(title: string): ListingReport {
      return {
        id: 'rpt_test',
        ebayItemId: 'v1|123|0',
        ebayTitle: title,
        ebayUrl: 'https://ebay.com/itm/123',
        cardId: '106999',
        cardName: 'Charizard',
        grade: 10,
        reportedSignal: 'strong_buy',
        reportedScore: 90,
        reportedFmv: 5000,
        reportedPrice: 100,
        timestamp: new Date().toISOString(),
      };
    }

    it('creates auto-override when reported title lacks variant keyword', async () => {
      const report = makeReport('Charizard PSA 10 Base Set Unlimited');
      const override = await registry.suggestFromReport(shadowlessCard, report);

      expect(override).not.toBeNull();
      expect(override!.autoGenerated).toBe(true);
      expect(override!.requiredKeywords).toContain('Shadowless');
      expect(override!.reportCount).toBe(1);
    });

    it('returns null when reported title contains variant keyword', async () => {
      const report = makeReport('Charizard Shadowless PSA 10 Base Set');
      const override = await registry.suggestFromReport(shadowlessCard, report);
      expect(override).toBeNull();
    });

    it('does not overwrite manual override', async () => {
      await registry.set({
        cardId: '106999',
        customQuery: 'Charizard Shadowless Base',
        notes: 'Manual override',
      });

      const report = makeReport('Charizard PSA 10 Base Set');
      const override = await registry.suggestFromReport(shadowlessCard, report);
      expect(override).toBeNull();

      // Verify manual override is preserved
      const existing = await registry.get('106999');
      expect(existing!.customQuery).toBe('Charizard Shadowless Base');
    });

    it('increments reportCount on subsequent reports', async () => {
      const report1 = makeReport('Charizard PSA 10 Base Set');
      const override1 = await registry.suggestFromReport(shadowlessCard, report1);
      expect(override1!.reportCount).toBe(1);

      const report2 = makeReport('Charizard PSA 10 Holo');
      const override2 = await registry.suggestFromReport(shadowlessCard, report2);
      expect(override2!.reportCount).toBe(2);
    });

    it('returns null for card with no variant keywords', async () => {
      const plainCard: ResolvedCard = {
        id: 'base1-4',
        name: 'Charizard',
        setName: 'Base Set',
        setCode: 'base1',
        number: '4',
        year: 1999,
        confidence: 1,
      };
      const report = makeReport('Charizard PSA 10 Base Set');
      const override = await registry.suggestFromReport(plainCard, report);
      expect(override).toBeNull();
    });
  });
});
