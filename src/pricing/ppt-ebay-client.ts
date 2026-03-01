import type { GachaAgentConfig, PptEbayPricing, PptEbayGradeData, ResolvedCard } from '../types/index.js';

interface SmartMarketPrice {
  price: number;
  confidence: 'high' | 'medium' | 'low';
}

interface GradeSalesData {
  count?: number;
  smartMarketPrice?: SmartMarketPrice | null;
  medianPrice?: number | null;
  marketTrend?: 'up' | 'down' | null;
}

interface PptCardResponse {
  ebay?: {
    salesByGrade?: Record<string, GradeSalesData>;
  };
}

export class PptEbayClient {
  private baseUrl: string;
  private apiKey: string;
  private cache: Map<string, { value: PptEbayPricing | null; expiresAt: number }> = new Map();
  private cacheTtlMs = 30 * 60 * 1000; // 30 minutes

  constructor(config: GachaAgentConfig) {
    this.baseUrl = this.normalizeBaseUrl(config.pokemonPriceTracker.baseUrl);
    this.apiKey = config.pokemonPriceTracker.apiKey;
  }

  async getEbaySales(card: ResolvedCard): Promise<PptEbayPricing | null> {
    const cacheKey = card.id;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      // Numeric IDs are tcgPlayerIds — use exact lookup.
      // Non-numeric IDs (UUIDs from parse-title) need search fallback.
      const isNumeric = /^\d+$/.test(card.id);
      const queryParam = isNumeric
        ? `tcgPlayerId=${encodeURIComponent(card.id)}`
        : `search=${encodeURIComponent(card.name + ' ' + card.setName)}`;
      const url = `${this.baseUrl}/api/v2/cards?${queryParam}&includeEbay=true`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!res.ok) {
        console.error(`[PptEbayClient] API error ${res.status} for card=${card.id}`);
        return null;
      }

      const json = (await res.json()) as { data: PptCardResponse | PptCardResponse[] };
      const pptCard = Array.isArray(json.data) ? json.data[0] : json.data;

      if (!pptCard?.ebay?.salesByGrade) {
        this.cacheResult(cacheKey, null);
        return null;
      }

      const gradeData: Record<number, PptEbayGradeData> = {};

      for (let grade = 1; grade <= 10; grade++) {
        const key = `psa${grade}`;
        const sales = pptCard.ebay.salesByGrade[key];
        if (!sales?.smartMarketPrice?.price) continue;

        gradeData[grade] = {
          fmv: sales.smartMarketPrice.price,
          confidence: sales.smartMarketPrice.confidence,
          salesCount: sales.count ?? 0,
          medianPrice: sales.medianPrice ?? null,
          marketTrend: sales.marketTrend ?? null,
        };
      }

      if (Object.keys(gradeData).length === 0) {
        this.cacheResult(cacheKey, null);
        return null;
      }

      const result: PptEbayPricing = {
        label: 'eBay Sales',
        gradeData,
      };

      this.cacheResult(cacheKey, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[PptEbayClient] Failed to fetch eBay sales for card=${card.id}: ${message}`);
      return null;
    }
  }

  private cacheResult(cacheKey: string, value: PptEbayPricing | null): void {
    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(
      '://pokemonpricetracker.com',
      '://www.pokemonpricetracker.com',
    );
  }

  clearCache(): void {
    this.cache.clear();
  }
}
