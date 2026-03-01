import type { InventoryItem, CardCandidate, ResolveResult } from '../types/index.js';
import type { InventoryManager } from '../inventory/manager.js';
import type { CardResolver } from '../card-resolver/resolver.js';
import type { CardRegistry } from './card-registry.js';

const INVENTORY_CONFIDENCE = 0.90;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export class CascadingSearch {
  private cache = new Map<string, { result: ResolveResult; expiresAt: number }>();

  constructor(
    private inventoryManager: InventoryManager,
    private resolver: CardResolver,
    private cardRegistry?: CardRegistry,
  ) {}

  async search(query: string): Promise<ResolveResult> {
    const cleaned = this.preprocessQuery(query);
    const key = this.normalizeKey(cleaned);

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    // Guard against empty-after-preprocessing (e.g. user types just "2019 POKEMON")
    if (!cleaned) {
      return {
        success: false,
        candidates: [],
        originalQuery: query,
        needsDisambiguation: false,
      };
    }

    let result: ResolveResult;

    const inventoryHits = await this.inventoryManager.search(cleaned);

    if (inventoryHits.length > 0) {
      const candidates = this.dedup(inventoryHits.map((item) => this.toCandidate(item)));
      result = {
        success: true,
        bestMatch: candidates[0]?.card,
        candidates,
        originalQuery: query,
        needsDisambiguation: false,
      };
    } else if (this.cardRegistry) {
      const registryHits = await this.cardRegistry.search(cleaned);
      if (registryHits.length > 0) {
        const candidates = this.dedup(registryHits);
        result = {
          success: true,
          bestMatch: candidates[0]?.card,
          candidates,
          originalQuery: query,
          needsDisambiguation: false,
        };
      } else {
        result = await this.resolver.resolve(cleaned);
        result = { ...result, originalQuery: query };
      }
    } else {
      result = await this.resolver.resolve(cleaned);
      // Preserve raw query for display regardless of what resolver returns
      result = { ...result, originalQuery: query };
    }

    // Enrich candidates with images (moved from server.ts so cached result is complete)
    result = {
      ...result,
      candidates: await this.resolver.enrichCandidatesWithImages(result.candidates),
    };

    this.cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });

    return result;
  }

  invalidateQuery(query: string): void {
    const cleaned = this.preprocessQuery(query);
    const key = this.normalizeKey(cleaned);
    this.cache.delete(key);
  }

  async warmUp(queries: string[]): Promise<void> {
    for (const query of queries) {
      await this.search(query);
    }
  }

  /** Strip noise from user input before passing to inventory/resolver. */
  private preprocessQuery(query: string): string {
    return query
      .replace(/\bpokemon\b/gi, '')          // "POKEMON" is franchise noise
      .replace(/\b(19|20)\d{2}\b/g, '')      // Strip years ("2019", "2023")
      .replace(/\b(prices?|values?|worth)\b/gi, '') // Search-engine noise
      .replace(/#(\d+)/g, '$1')              // "#171" → "171"
      .replace(/(?<!\d)\/(?!\d)/g, ' ')      // "FA/EEVEE" → "FA EEVEE" (keep "171/181")
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeKey(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  private toCandidate(item: InventoryItem): CardCandidate {
    return {
      card: {
        id: item.id,
        name: item.name,
        setName: item.setName,
        setCode: 'inventory',
        number: item.number,
        year: item.year ?? new Date().getFullYear(),
        variant: item.variant,
        imageUrl: item.imageUrl,
        confidence: INVENTORY_CONFIDENCE,
      },
      confidence: INVENTORY_CONFIDENCE,
      matchReason: 'Matched from Gacha inventory',
    };
  }

  private dedup(candidates: CardCandidate[]): CardCandidate[] {
    const seen = new Set<string>();
    return candidates.filter((c) => {
      const key = `${c.card.name}|${c.card.number}|${c.card.setName}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
