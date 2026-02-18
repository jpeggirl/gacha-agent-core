import type {
  EbayListing,
  ResolvedCard,
  FairMarketValue,
  ScoredDeal,
  DealSignal,
} from '../types/index.js';

interface ScoringWeights {
  priceVsFmv: number;
  sellerReputation: number;
  listingType: number;
  populationRarity: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  priceVsFmv: 0.60,
  sellerReputation: 0.15,
  listingType: 0.10,
  populationRarity: 0.15,
};

export class DealScorer {
  private weights: ScoringWeights;

  constructor(weights?: Partial<ScoringWeights>) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  score(
    listing: EbayListing,
    card: ResolvedCard,
    fmv: FairMarketValue,
  ): ScoredDeal {
    const priceScore = this.scorePriceVsFmv(listing.totalPrice, fmv.fmv);
    const sellerScore = this.scoreSellerReputation(listing);
    const listingTypeScore = this.scoreListingType(listing);
    const rarityScore = this.scorePopulationRarity(fmv);

    const rawScore =
      priceScore * this.weights.priceVsFmv +
      sellerScore * this.weights.sellerReputation +
      listingTypeScore * this.weights.listingType +
      rarityScore * this.weights.populationRarity;

    const score = Math.round(Math.max(0, Math.min(100, rawScore)));
    const signal = this.deriveSignal(score, listing, fmv);
    const savingsAmount = fmv.fmv - listing.totalPrice;
    const savingsPercent =
      fmv.fmv > 0 ? (savingsAmount / fmv.fmv) * 100 : 0;

    return {
      listing,
      card,
      fmv,
      score,
      signal,
      reasoning: this.buildReasoning(
        score,
        signal,
        listing,
        fmv,
        savingsPercent,
        {
          priceScore,
          sellerScore,
          listingTypeScore,
          rarityScore,
        },
      ),
      savingsPercent: Math.round(savingsPercent * 10) / 10,
      savingsAmount: Math.round(savingsAmount * 100) / 100,
    };
  }

  scoreMany(
    listings: EbayListing[],
    card: ResolvedCard,
    fmv: FairMarketValue,
  ): ScoredDeal[] {
    return listings
      .map((listing) => this.score(listing, card, fmv))
      .sort((a, b) => b.score - a.score);
  }

  private scorePriceVsFmv(totalPrice: number, fmvPrice: number): number {
    if (fmvPrice <= 0) return 50;
    const ratio = totalPrice / fmvPrice;

    // ratio < 0.5 => exceptional deal (100)
    // ratio = 0.7 => good deal (80)
    // ratio = 1.0 => fair (50)
    // ratio = 1.3 => overpriced (20)
    // ratio > 1.5 => bad (0)
    if (ratio <= 0.5) return 100;
    if (ratio <= 1.0) return 100 - (ratio - 0.5) * 100;
    if (ratio <= 1.5) return 50 - (ratio - 1.0) * 100;
    return 0;
  }

  private scoreSellerReputation(listing: EbayListing): number {
    const feedbackScore = Math.min(listing.sellerFeedbackScore / 1000, 1) * 50;
    const feedbackPercent = (listing.sellerFeedbackPercent / 100) * 50;
    return feedbackScore + feedbackPercent;
  }

  private scoreListingType(listing: EbayListing): number {
    switch (listing.listingType) {
      case 'BuyItNow':
        return 80; // Preferred — instant purchase
      case 'BestOffer':
        return 60; // Good — can negotiate
      case 'Auction':
        return 40; // Risky — price may increase
      default:
        return 50;
    }
  }

  private scorePopulationRarity(fmv: FairMarketValue): number {
    if (!fmv.populationCount) return 50; // No data — neutral

    // Lower population = rarer = better deal opportunity
    if (fmv.populationCount < 50) return 90;
    if (fmv.populationCount < 200) return 75;
    if (fmv.populationCount < 1000) return 60;
    if (fmv.populationCount < 5000) return 40;
    return 25;
  }

  private deriveSignal(
    score: number,
    listing: EbayListing,
    fmv: FairMarketValue,
  ): DealSignal {
    // Hard filters — avoid regardless of score
    if (listing.sellerFeedbackPercent < 95) return 'avoid';
    if (listing.sellerFeedbackScore < 10) return 'avoid';

    if (score >= 80) return 'strong_buy';
    if (score >= 65) return 'buy';
    if (score >= 45) return 'fair';
    if (score >= 25) return 'overpriced';
    return 'avoid';
  }

  private buildReasoning(
    score: number,
    signal: DealSignal,
    listing: EbayListing,
    fmv: FairMarketValue,
    savingsPercent: number,
    componentScores: {
      priceScore: number;
      sellerScore: number;
      listingTypeScore: number;
      rarityScore: number;
    },
  ): string {
    const parts: string[] = [];

    // Price assessment
    if (savingsPercent > 20) {
      parts.push(
        `${Math.abs(Math.round(savingsPercent))}% below FMV ($${listing.totalPrice} vs $${fmv.fmv} FMV)`,
      );
    } else if (savingsPercent > 0) {
      parts.push(
        `${Math.abs(Math.round(savingsPercent))}% below FMV — modest discount`,
      );
    } else {
      parts.push(
        `${Math.abs(Math.round(savingsPercent))}% above FMV`,
      );
    }

    // Seller assessment
    if (listing.sellerFeedbackPercent >= 99.5 && listing.sellerFeedbackScore > 1000) {
      parts.push('Top-rated seller');
    } else if (listing.sellerFeedbackPercent < 95) {
      parts.push('Low seller feedback — caution');
    }

    // Listing type
    if (listing.listingType === 'BuyItNow') {
      parts.push('Buy It Now — instant purchase');
    } else if (listing.listingType === 'Auction') {
      parts.push('Auction — price may increase');
    }

    // Population
    if (fmv.populationCount && fmv.populationCount < 100) {
      parts.push(`Low PSA population (${fmv.populationCount}) — scarce`);
    }

    return parts.join('. ') + '.';
  }
}
