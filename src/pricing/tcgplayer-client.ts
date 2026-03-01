import type { TcgPlayerPricing } from '../types/index.js';

const API_BASE = 'https://api.pokemontcg.io/v2';

// Variant preference order — holofoil is most commonly graded
const VARIANT_PREFERENCE = ['holofoil', 'reverseHolofoil', 'normal'] as const;

interface TcgPriceVariant {
  low?: number | null;
  mid?: number | null;
  high?: number | null;
  market?: number | null;
}

interface PokemonTcgCard {
  tcgplayer?: {
    prices?: Record<string, TcgPriceVariant>;
  };
}

interface PokemonTcgResponse {
  data?: PokemonTcgCard[];
}

export class TcgPlayerClient {
  private apiKey: string;
  private cache: Map<string, { value: TcgPlayerPricing | null; expiresAt: number }> = new Map();
  private cacheTtlMs = 30 * 60 * 1000; // 30 minutes

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getMarketPrice(tcgPlayerId: string): Promise<TcgPlayerPricing | null> {
    const cached = this.cache.get(tcgPlayerId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const url = `${API_BASE}/cards?q=tcgplayer.productId:${encodeURIComponent(tcgPlayerId)}`;
      const res = await fetch(url, {
        headers: { 'X-Api-Key': this.apiKey },
      });

      if (!res.ok) {
        console.error(`[TcgPlayerClient] API error ${res.status} for tcgPlayerId=${tcgPlayerId}`);
        return null;
      }

      const json = (await res.json()) as PokemonTcgResponse;

      if (!json.data || json.data.length === 0 || !json.data[0]?.tcgplayer?.prices) {
        this.cacheResult(tcgPlayerId, null);
        return null;
      }

      const prices = json.data[0].tcgplayer.prices;
      const { variant, data } = this.selectBestVariant(prices);

      if (!data) {
        this.cacheResult(tcgPlayerId, null);
        return null;
      }

      const result: TcgPlayerPricing = {
        label: 'TCGPlayer',
        market: data.market ?? null,
        low: data.low ?? null,
        mid: data.mid ?? null,
        high: data.high ?? null,
        variant,
      };

      this.cacheResult(tcgPlayerId, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TcgPlayerClient] Failed to fetch price for tcgPlayerId=${tcgPlayerId}: ${message}`);
      return null;
    }
  }

  private selectBestVariant(prices: Record<string, TcgPriceVariant>): { variant: string; data: TcgPriceVariant | null } {
    // Try preferred variants in order
    for (const variant of VARIANT_PREFERENCE) {
      if (prices[variant]) {
        return { variant, data: prices[variant]! };
      }
    }

    // Fall back to first available variant
    const keys = Object.keys(prices);
    if (keys.length > 0) {
      return { variant: keys[0]!, data: prices[keys[0]!]! };
    }

    return { variant: 'unknown', data: null };
  }

  private cacheResult(tcgPlayerId: string, value: TcgPlayerPricing | null): void {
    this.cache.set(tcgPlayerId, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  clearCache(): void {
    this.cache.clear();
  }
}
