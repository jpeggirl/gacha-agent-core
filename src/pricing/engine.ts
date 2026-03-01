import type {
  ResolvedCard,
  FairMarketValue,
  PricePoint,
  GachaAgentConfig,
  Grader,
  MultiSourcePricing,
  PriceChartingPricing,
} from '../types/index.js';
import { PriceChartingClient } from './pricecharting.js';
import { PptEbayClient } from './ppt-ebay-client.js';
import { TcgPlayerClient } from './tcgplayer-client.js';

export class PriceEngine {
  private pcClient: PriceChartingClient | null;
  private pptClient: PptEbayClient | null;
  private tcgClient: TcgPlayerClient | null;
  private cache: Map<string, { value: FairMarketValue; expiresAt: number }> =
    new Map();
  private cacheTtlMs = 30 * 60 * 1000; // 30 minutes

  constructor(config: GachaAgentConfig) {
    this.pcClient = config.priceCharting?.apiKey
      ? new PriceChartingClient(config.priceCharting.apiKey)
      : null;
    this.pptClient = config.pokemonPriceTracker?.apiKey
      ? new PptEbayClient(config)
      : null;
    this.tcgClient = config.pokemonTcg?.apiKey
      ? new TcgPlayerClient(config.pokemonTcg.apiKey)
      : null;
  }

  async getFMV(card: ResolvedCard, grade: number, grader: Grader = 'PSA'): Promise<FairMarketValue | null> {
    const cacheKey = `${card.id}:${grader}:${grade}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      if (!this.pcClient) {
        console.error(`[PriceEngine] No pricing source configured for ${card.name} ${grader} ${grade}`);
        return null;
      }

      const result = await this.pcClient.getPrice(
        card.id,
        card.name,
        card.number,
        grade,
        grader,
      );

      if (!result) {
        console.error(`[PriceEngine] No pricing data found for ${card.name} ${grader} ${grade}`);
        return null;
      }

      const prices: PricePoint[] = [
        {
          source: result.sourceLabel,
          price: result.price,
          currency: 'USD',
          date: new Date().toISOString().split('T')[0]!,
          saleType: 'estimate',
        },
      ];

      // PriceCharting does not provide populationCount
      const fmv: FairMarketValue = {
        cardId: card.id,
        grade,
        grader,
        fmv: result.price,
        currency: 'USD',
        prices,
        lastUpdated: new Date().toISOString(),
        pricingSource: result.sourceLabel,
      };

      this.cache.set(cacheKey, {
        value: fmv,
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      return fmv;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[PriceEngine] Failed to fetch pricing for ${card.name} ${grader} ${grade}: ${message}`);
      return null;
    }
  }

  async getMultiGradeFMV(
    card: ResolvedCard,
    grades: number[],
    grader: Grader = 'PSA',
  ): Promise<Map<number, FairMarketValue>> {
    const results = new Map<number, FairMarketValue>();
    // Fetch in parallel
    const promises = grades.map(async (grade) => {
      const fmv = await this.getFMV(card, grade, grader);
      if (fmv) {
        results.set(grade, fmv);
      }
    });
    await Promise.all(promises);
    return results;
  }

  async getMultiSourcePricing(
    card: ResolvedCard,
    grade: number,
    grader: Grader = 'PSA',
  ): Promise<MultiSourcePricing> {
    // Only fetch grades 6-10 — lower grades lack accurate per-grade data
    const grades = [6, 7, 8, 9, 10];

    // Fire all sources in parallel — each handles its own errors
    const [pcResult, pptResult, tcgResult] = await Promise.all([
      this.getMultiGradeFMV(card, grades, grader).catch((err) => {
        console.error(`[PriceEngine] PriceCharting source failed: ${err}`);
        return new Map<number, FairMarketValue>();
      }),
      this.pptClient?.getEbaySales(card).catch((err) => {
        console.error(`[PriceEngine] PPT eBay source failed: ${err}`);
        return null;
      }) ?? Promise.resolve(null),
      this.tcgClient?.getMarketPrice(card.id).catch((err) => {
        console.error(`[PriceEngine] TCGPlayer source failed: ${err}`);
        return null;
      }) ?? Promise.resolve(null),
    ]);

    // PriceCharting has dedicated fields for PSA 7-10.
    // PSA 6 and below have no dedicated field — rely on PPT eBay for those.
    const pcDedicatedGrades = new Set([7, 8, 9, 10]);

    // Build PriceCharting source
    let priceCharting: PriceChartingPricing | null = null;
    const pcAllGrades: Record<number, number | null> = {};
    for (let g = 6; g <= 10; g++) {
      pcAllGrades[g] = pcResult.get(g)?.fmv ?? null;
    }
    const hasPcData = Object.values(pcAllGrades).some((v) => v !== null);
    if (hasPcData) {
      priceCharting = {
        label: 'PriceCharting',
        fmv: pcResult.get(grade)?.fmv ?? null,
        allGrades: pcAllGrades,
      };
    }

    // Merge allGrades: prefer PriceCharting for grades with dedicated fields (7-10),
    // fall back to PPT eBay for grades without dedicated PriceCharting fields (6 and below)
    const allGrades: Record<number, number | null> = {};
    for (let g = 6; g <= 10; g++) {
      const pptPrice = pptResult?.gradeData?.[g]?.fmv ?? null;
      const pcPrice = pcResult.get(g)?.fmv ?? null;
      if (pcDedicatedGrades.has(g)) {
        allGrades[g] = pcPrice ?? pptPrice;
      } else {
        allGrades[g] = pptPrice ?? pcPrice;
      }
    }

    // Prefer PriceCharting for hero FMV (more stable, aggregates more data),
    // fall back to PPT eBay when PriceCharting has no data for this grade
    const pcFmv = pcResult.get(grade)?.fmv ?? null;
    const pptFmv = pptResult?.gradeData?.[grade]?.fmv ?? null;
    const fmv = pcDedicatedGrades.has(grade) ? (pcFmv ?? pptFmv) : (pptFmv ?? pcFmv);

    return {
      card,
      grade,
      grader,
      fmv,
      allGrades,
      sources: {
        priceCharting,
        pptEbay: pptResult,
        tcgPlayer: tcgResult,
      },
    };
  }

  clearCache(): void {
    this.cache.clear();
  }
}
