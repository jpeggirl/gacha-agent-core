import type {
  ResolvedCard,
  FairMarketValue,
  PricePoint,
  GachaAgentConfig,
} from '../types/index.js';

interface PsaPricingResponse {
  success: boolean;
  data?: {
    cardId: string;
    grade: number;
    prices: Array<{
      price: number;
      currency: string;
      date: string;
      source: string;
      saleType: 'completed' | 'active' | 'estimate';
    }>;
    average: number;
    median: number;
    population?: number;
  };
  error?: string;
}

export class PriceEngine {
  private baseUrl: string;
  private apiKey: string;
  private cache: Map<string, { value: FairMarketValue; expiresAt: number }> =
    new Map();
  private cacheTtlMs = 30 * 60 * 1000; // 30 minutes

  constructor(config: GachaAgentConfig) {
    this.baseUrl = config.pokemonPriceTracker.baseUrl;
    this.apiKey = config.pokemonPriceTracker.apiKey;
  }

  async getFMV(card: ResolvedCard, grade: number): Promise<FairMarketValue> {
    const cacheKey = `${card.id}:${grade}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const response = await this.fetchPsaPricing(card.id, grade);

    if (!response.success || !response.data) {
      throw new Error(
        `Failed to fetch pricing for ${card.name} PSA ${grade}: ${response.error ?? 'Unknown error'}`,
      );
    }

    const d = response.data;
    const prices: PricePoint[] = d.prices.map((p) => ({
      source: p.source,
      price: p.price,
      currency: p.currency,
      date: p.date,
      saleType: p.saleType,
    }));

    // Use median as FMV — more resistant to outliers than mean
    const fmv: FairMarketValue = {
      cardId: card.id,
      grade,
      fmv: d.median,
      currency: 'USD',
      prices,
      lastUpdated: new Date().toISOString(),
      populationCount: d.population,
    };

    this.cache.set(cacheKey, {
      value: fmv,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return fmv;
  }

  async getMultiGradeFMV(
    card: ResolvedCard,
    grades: number[],
  ): Promise<Map<number, FairMarketValue>> {
    const results = new Map<number, FairMarketValue>();
    // Fetch in parallel
    const promises = grades.map(async (grade) => {
      try {
        const fmv = await this.getFMV(card, grade);
        results.set(grade, fmv);
      } catch {
        // Skip grades that fail — may not have pricing data
      }
    });
    await Promise.all(promises);
    return results;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async fetchPsaPricing(
    cardId: string,
    grade: number,
  ): Promise<PsaPricingResponse> {
    const url = `${this.baseUrl}/api/psa/pricing/${encodeURIComponent(cardId)}/${grade}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!res.ok) {
      throw new Error(
        `PokemonPriceTracker pricing API error: ${res.status} ${res.statusText}`,
      );
    }

    return res.json() as Promise<PsaPricingResponse>;
  }
}
