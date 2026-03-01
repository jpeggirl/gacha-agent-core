import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CascadingSearch } from './cascading-search.js';
import { InventoryManager } from '../inventory/manager.js';
import { CardRegistry } from './card-registry.js';
import { InMemoryStorage } from '../mocks/in-memory-storage.js';
import type { CardResolver } from '../card-resolver/resolver.js';
import type { InventoryItem, ResolveResult } from '../types/index.js';

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'inv-1',
    name: 'Pikachu with Grey Felt Hat',
    setName: 'Van Gogh Promo',
    number: '085',
    grade: 10,
    grader: 'PSA',
    price: 1500,
    quantity: 1,
    variant: 'Felt Hat',
    year: 2023,
    status: 'available',
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMockResolver(result?: ResolveResult): CardResolver {
  return {
    resolve: vi.fn().mockResolvedValue(
      result ?? {
        success: true,
        bestMatch: {
          id: 'ext-1',
          name: 'Charizard',
          setName: 'Base Set',
          setCode: 'base1',
          number: '4',
          year: 1999,
          confidence: 0.92,
        },
        candidates: [
          {
            card: {
              id: 'ext-1',
              name: 'Charizard',
              setName: 'Base Set',
              setCode: 'base1',
              number: '4',
              year: 1999,
              confidence: 0.92,
            },
            confidence: 0.92,
            matchReason: 'Primary match from parse-title API',
          },
        ],
        originalQuery: 'charizard base set',
        needsDisambiguation: false,
      },
    ),
    enrichCandidatesWithImages: vi.fn().mockImplementation((c) => Promise.resolve(c)),
  } as unknown as CardResolver;
}

describe('CascadingSearch', () => {
  let storage: InMemoryStorage;
  let inventoryManager: InventoryManager;
  let mockResolver: CardResolver;
  let cascading: CascadingSearch;

  beforeEach(() => {
    storage = new InMemoryStorage();
    inventoryManager = new InventoryManager(storage);
    mockResolver = makeMockResolver();
    cascading = new CascadingSearch(inventoryManager, mockResolver);
  });

  // 1. Inventory hit returns inventory candidates with confidence 0.90
  it('returns inventory candidates with confidence 0.90 when inventory matches', async () => {
    await storage.set('inventory:inv-1', makeItem());

    const result = await cascading.search('pikachu felt hat');

    expect(result.success).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].confidence).toBe(0.90);
    expect(result.candidates[0].card.name).toBe('Pikachu with Grey Felt Hat');
  });

  // 2. Inventory miss falls through to resolver.resolve()
  it('falls back to resolver when inventory has no matches', async () => {
    const result = await cascading.search('charizard base set');

    expect(result.success).toBe(true);
    expect(result.candidates[0].card.name).toBe('Charizard');
    expect(mockResolver.resolve).toHaveBeenCalledWith('charizard base set');
  });

  // 3. Inventory match sets success: true, needsDisambiguation: false
  it('sets success true and needsDisambiguation false for inventory hits', async () => {
    await storage.set('inventory:inv-1', makeItem());

    const result = await cascading.search('grey felt hat');

    expect(result.success).toBe(true);
    expect(result.needsDisambiguation).toBe(false);
  });

  // 4. resolver.resolve() NOT called when inventory has results
  it('does not call resolver when inventory has results', async () => {
    await storage.set('inventory:inv-1', makeItem());

    await cascading.search('pikachu');

    expect(mockResolver.resolve).not.toHaveBeenCalled();
  });

  // 5. InventoryItem → CardCandidate field mapping
  it('correctly maps InventoryItem fields to CardCandidate', async () => {
    await storage.set('inventory:inv-1', makeItem());

    const result = await cascading.search('pikachu');
    const candidate = result.candidates[0];

    expect(candidate.card.id).toBe('inv-1');
    expect(candidate.card.setCode).toBe('inventory');
    expect(candidate.card.year).toBe(2023);
    expect(candidate.card.variant).toBe('Felt Hat');
    expect(candidate.card.setName).toBe('Van Gogh Promo');
    expect(candidate.card.number).toBe('085');
    expect(candidate.matchReason).toBe('Matched from Gacha inventory');
  });

  // 5b. Year fallback to current year when item.year is undefined
  it('falls back to current year when inventory item has no year', async () => {
    await storage.set('inventory:inv-1', makeItem({ year: undefined }));

    const result = await cascading.search('pikachu');
    const candidate = result.candidates[0];

    expect(candidate.card.year).toBe(new Date().getFullYear());
  });

  // 6. Deduplicates inventory results by name+number+set
  it('deduplicates inventory results by name, number, and set', async () => {
    await storage.set('inventory:inv-1', makeItem({ id: 'inv-1' }));
    await storage.set('inventory:inv-2', makeItem({ id: 'inv-2' })); // same name/number/set

    const result = await cascading.search('pikachu');

    expect(result.candidates).toHaveLength(1);
  });

  // 7. End-to-end: "grey felt hat pikachu" finds inventory item
  it('finds inventory item with fuzzy query "grey felt hat pikachu"', async () => {
    await storage.set('inventory:inv-1', makeItem());

    const result = await cascading.search('grey felt hat pikachu');

    expect(result.success).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].card.name).toBe('Pikachu with Grey Felt Hat');
    expect(mockResolver.resolve).not.toHaveBeenCalled();
  });

  // ─── Cache Tests ───

  // 8. Cache hit: second search returns cached result, resolver NOT called again
  it('returns cached result on second search, resolver not called again', async () => {
    await cascading.search('charizard base set');
    expect(mockResolver.resolve).toHaveBeenCalledTimes(1);

    await cascading.search('charizard base set');
    expect(mockResolver.resolve).toHaveBeenCalledTimes(1); // still 1 — cached
  });

  // 9. Cache miss on different query: different query still calls resolver
  it('calls resolver for a different query (cache miss)', async () => {
    await cascading.search('charizard base set');
    await cascading.search('blastoise base set');

    expect(mockResolver.resolve).toHaveBeenCalledTimes(2);
  });

  // 10. Cache normalizes keys: varied whitespace/casing shares cache entry
  it('normalizes cache keys so varied casing/whitespace shares entry', async () => {
    await cascading.search('Charizard  Base Set');
    await cascading.search('charizard base set');
    await cascading.search('  CHARIZARD BASE SET  ');

    expect(mockResolver.resolve).toHaveBeenCalledTimes(1); // all normalized to same key
  });

  // 11. warmUp populates cache so subsequent searches skip resolver
  it('warmUp populates cache so subsequent searches skip resolver', async () => {
    await cascading.warmUp(['charizard base set']);
    expect(mockResolver.resolve).toHaveBeenCalledTimes(1);

    await cascading.search('charizard base set');
    expect(mockResolver.resolve).toHaveBeenCalledTimes(1); // cached from warmUp
  });

  // ─── Query Preprocessing Tests ───

  describe('query preprocessing', () => {
    it('strips "POKEMON" before resolver call', async () => {
      await cascading.search('POKEMON charizard');

      expect(mockResolver.resolve).toHaveBeenCalledWith('charizard');
    });

    it('strips year before resolver call', async () => {
      await cascading.search('2019 charizard base set');

      expect(mockResolver.resolve).toHaveBeenCalledWith('charizard base set');
    });

    it('strips "#" prefix from numbers', async () => {
      await cascading.search('charizard #4');

      expect(mockResolver.resolve).toHaveBeenCalledWith('charizard 4');
    });

    it('splits non-numeric "/" into space ("FA/EEVEE" → "FA EEVEE")', async () => {
      await cascading.search('FA/EEVEE');

      expect(mockResolver.resolve).toHaveBeenCalledWith('FA EEVEE');
    });

    it('preserves numeric "/" ("171/181" stays)', async () => {
      await cascading.search('eevee 171/181');

      expect(mockResolver.resolve).toHaveBeenCalledWith('eevee 171/181');
    });

    it('preprocesses full noisy query from bug report correctly', async () => {
      await cascading.search('2019 POKEMON SUN & MOON TEAM UP FA/EEVEE & SNORLAX GX #171');

      expect(mockResolver.resolve).toHaveBeenCalledWith('SUN & MOON TEAM UP FA EEVEE & SNORLAX GX 171');
    });

    it('preserves raw query as originalQuery', async () => {
      const rawQuery = '2019 POKEMON charizard base set';
      const result = await cascading.search(rawQuery);

      expect(result.originalQuery).toBe(rawQuery);
    });

    it('shares cache between raw and preprocessed-equivalent queries', async () => {
      await cascading.search('POKEMON charizard base set');
      await cascading.search('charizard base set');

      expect(mockResolver.resolve).toHaveBeenCalledTimes(1);
    });

    it('returns empty result when query is empty after preprocessing', async () => {
      const result = await cascading.search('2019 POKEMON');

      expect(result.success).toBe(false);
      expect(result.candidates).toHaveLength(0);
      expect(result.originalQuery).toBe('2019 POKEMON');
      expect(mockResolver.resolve).not.toHaveBeenCalled();
    });
  });

  // ─── Card Registry Tier Tests ───

  describe('card registry tier', () => {
    let registryStorage: InMemoryStorage;
    let cardRegistry: CardRegistry;
    let cascadingWithRegistry: CascadingSearch;

    beforeEach(() => {
      registryStorage = new InMemoryStorage();
      cardRegistry = new CardRegistry(registryStorage);
      cascadingWithRegistry = new CascadingSearch(inventoryManager, mockResolver, cardRegistry);
    });

    it('returns registry results when inventory misses but registry matches', async () => {
      await cardRegistry.register({
        name: 'Pikachu Scream Munch',
        imageUrl: 'https://example.com/pikachu.jpg',
        ebayItemId: 'ebay-123',
        query: 'pikachu scream',
      });

      const result = await cascadingWithRegistry.search('pikachu scream');

      expect(result.success).toBe(true);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].card.name).toBe('Pikachu Scream Munch');
      expect(result.candidates[0].confidence).toBe(0.80);
      expect(mockResolver.resolve).not.toHaveBeenCalled();
    });

    it('inventory takes priority over registry', async () => {
      await storage.set('inventory:inv-1', makeItem({ name: 'Pikachu Scream Special' }));
      await cardRegistry.register({
        name: 'Pikachu Scream Munch',
        ebayItemId: 'ebay-123',
        query: 'pikachu scream',
      });

      const result = await cascadingWithRegistry.search('pikachu scream');

      expect(result.success).toBe(true);
      expect(result.candidates[0].card.name).toBe('Pikachu Scream Special');
      expect(result.candidates[0].confidence).toBe(0.90); // inventory confidence
    });

    it('falls through to resolver when both inventory and registry miss', async () => {
      const result = await cascadingWithRegistry.search('charizard base set');

      expect(result.success).toBe(true);
      expect(result.candidates[0].card.name).toBe('Charizard');
      expect(mockResolver.resolve).toHaveBeenCalledWith('charizard base set');
    });

    it('works without registry (backward-compatible)', async () => {
      const cascadingNoRegistry = new CascadingSearch(inventoryManager, mockResolver);
      const result = await cascadingNoRegistry.search('charizard base set');

      expect(result.success).toBe(true);
      expect(result.candidates[0].card.name).toBe('Charizard');
    });
  });

  // ─── Cache Invalidation Tests ───

  describe('invalidateQuery', () => {
    it('invalidates cached result so next search re-fetches', async () => {
      await cascading.search('charizard base set');
      expect(mockResolver.resolve).toHaveBeenCalledTimes(1);

      cascading.invalidateQuery('charizard base set');

      await cascading.search('charizard base set');
      expect(mockResolver.resolve).toHaveBeenCalledTimes(2); // re-fetched
    });

    it('normalizes query before invalidating', async () => {
      await cascading.search('Charizard Base Set');
      expect(mockResolver.resolve).toHaveBeenCalledTimes(1);

      cascading.invalidateQuery('  CHARIZARD  BASE SET  ');

      await cascading.search('charizard base set');
      expect(mockResolver.resolve).toHaveBeenCalledTimes(2);
    });

    it('is a no-op for uncached queries', async () => {
      // Should not throw
      cascading.invalidateQuery('nonexistent query');
    });
  });
});
