import type { StorageAdapter, ResolvedCard, CardCandidate } from '../types/index.js';

const REGISTRY_PREFIX = 'registered:';
const REGISTRY_CONFIDENCE = 0.80;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'with', 'of', 'in', 'for', 'and', 'or', 'on', 'at', 'to', 'from', 'by',
  'pokemon',
]);

export interface RegisteredCard {
  card: ResolvedCard;
  sourceQuery: string;
  sourceEbayItemId: string;
  registeredAt: string;
  searchAliases: string[];
}

export class CardRegistry {
  constructor(private storage: StorageAdapter) {}

  async register(params: {
    name: string;
    imageUrl?: string;
    ebayItemId: string;
    query: string;
  }): Promise<RegisteredCard> {
    const normalizedName = this.normalizeName(params.name);
    const key = `${REGISTRY_PREFIX}${normalizedName}`;

    const existing = await this.storage.get<RegisteredCard>(key);
    if (existing) {
      // Deduplicate: add query as alias if not already present
      const normalizedQuery = this.normalizeName(params.query);
      if (
        normalizedQuery !== normalizedName &&
        !existing.searchAliases.includes(normalizedQuery)
      ) {
        existing.searchAliases.push(normalizedQuery);
        await this.storage.set(key, existing);
      }
      return existing;
    }

    const card: ResolvedCard = {
      id: `registered:${normalizedName}`,
      name: params.name,
      setName: 'User Registered',
      setCode: 'user-registered',
      number: '',
      year: new Date().getFullYear(),
      imageUrl: params.imageUrl,
      confidence: REGISTRY_CONFIDENCE,
    };

    const normalizedQuery = this.normalizeName(params.query);
    const aliases = normalizedQuery !== normalizedName ? [normalizedQuery] : [];

    const entry: RegisteredCard = {
      card,
      sourceQuery: params.query,
      sourceEbayItemId: params.ebayItemId,
      registeredAt: new Date().toISOString(),
      searchAliases: aliases,
    };

    await this.storage.set(key, entry);
    return entry;
  }

  async search(query: string): Promise<CardCandidate[]> {
    const all = await this.getAll();
    const terms = query
      .toLowerCase()
      .split(/[\s/]+/)
      .map((t) => t.replace(/^#/, ''))
      .filter((t) => t && !STOPWORDS.has(t));

    if (terms.length === 0) return [];

    const results: CardCandidate[] = [];

    for (const entry of all) {
      const searchable = [
        entry.card.name.toLowerCase(),
        ...entry.searchAliases,
      ].join(' ');

      if (terms.every((term) => searchable.includes(term))) {
        results.push({
          card: entry.card,
          confidence: REGISTRY_CONFIDENCE,
          matchReason: 'Matched from card registry (user-discovered)',
        });
      }
    }

    return results;
  }

  async getAll(): Promise<RegisteredCard[]> {
    const keys = await this.storage.list(REGISTRY_PREFIX);
    const entries: RegisteredCard[] = [];

    for (const key of keys) {
      const entry = await this.storage.get<RegisteredCard>(key);
      if (entry) entries.push(entry);
    }

    return entries;
  }

  private normalizeName(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .trim();
  }
}
