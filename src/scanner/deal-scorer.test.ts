import { describe, it, expect } from 'vitest';
import { DealScorer } from './deal-scorer.js';
import type {
  EbayListing,
  ResolvedCard,
  FairMarketValue,
} from '../types/index.js';

const card: ResolvedCard = {
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

const fmv: FairMarketValue = {
  cardId: 'base1-4',
  grade: 9,
  grader: 'PSA',
  fmv: 5000,
  currency: 'USD',
  prices: [],
  lastUpdated: new Date().toISOString(),
  populationCount: 150,
};

function makeListing(overrides: Partial<EbayListing> = {}): EbayListing {
  return {
    itemId: 'test-1',
    title: 'Charizard Base Set 1st Edition PSA 9',
    price: 4000,
    currency: 'USD',
    shippingCost: 0,
    totalPrice: 4000,
    listingType: 'BuyItNow',
    sellerUsername: 'topcardseller',
    sellerFeedbackScore: 5000,
    sellerFeedbackPercent: 99.8,
    itemUrl: 'https://ebay.com/itm/test-1',
    ...overrides,
  };
}

describe('DealScorer', () => {
  const scorer = new DealScorer();

  it('scores a good deal highly', () => {
    const listing = makeListing({ totalPrice: 3500 }); // 30% below FMV
    const deal = scorer.score(listing, card, fmv);
    expect(deal.score).toBeGreaterThanOrEqual(70);
    expect(deal.signal).toBe('strong_buy');
    expect(deal.savingsAmount).toBeGreaterThan(0);
    expect(deal.savingsPercent).toBeGreaterThan(20);
  });

  it('scores an overpriced listing low', () => {
    const listing = makeListing({ totalPrice: 6500 }); // 30% above FMV
    const deal = scorer.score(listing, card, fmv);
    expect(deal.score).toBeLessThan(50);
    expect(deal.savingsAmount).toBeLessThan(0);
  });

  it('marks low-feedback sellers as avoid', () => {
    const listing = makeListing({
      totalPrice: 3500,
      sellerFeedbackPercent: 90,
    });
    const deal = scorer.score(listing, card, fmv);
    expect(deal.signal).toBe('avoid');
  });

  it('accounts for shipping cost in total price', () => {
    const listing = makeListing({
      price: 3500,
      shippingCost: 500,
      totalPrice: 4000,
    });
    const deal = scorer.score(listing, card, fmv);
    // 4000 vs 5000 FMV = 20% discount
    expect(deal.savingsAmount).toBe(1000);
  });

  it('prefers BuyItNow over Auction', () => {
    const binDeal = scorer.score(
      makeListing({ listingType: 'BuyItNow', totalPrice: 4500 }),
      card,
      fmv,
    );
    const auctionDeal = scorer.score(
      makeListing({ listingType: 'Auction', totalPrice: 4500 }),
      card,
      fmv,
    );
    expect(binDeal.score).toBeGreaterThan(auctionDeal.score);
  });

  it('scoreMany returns sorted by score descending', () => {
    const listings = [
      makeListing({ itemId: '1', totalPrice: 6000 }), // overpriced
      makeListing({ itemId: '2', totalPrice: 3000 }), // great deal
      makeListing({ itemId: '3', totalPrice: 4500 }), // okay
    ];
    const results = scorer.scoreMany(listings, card, fmv);
    expect(results[0]!.listing.itemId).toBe('2');
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    expect(results[1]!.score).toBeGreaterThan(results[2]!.score);
  });

  it('generates readable reasoning', () => {
    const listing = makeListing({ totalPrice: 3500 });
    const deal = scorer.score(listing, card, fmv);
    expect(deal.reasoning).toBeTruthy();
    expect(deal.reasoning.length).toBeGreaterThan(10);
  });

  it('includes approximate FMV note when pricingSource contains "approximate"', () => {
    const approxFmv: FairMarketValue = {
      ...fmv,
      grader: 'CGC',
      pricingSource: 'PriceCharting PSA 10 (approximate for CGC 10)',
    };
    const listing = makeListing({ totalPrice: 3500 });
    const deal = scorer.score(listing, card, approxFmv);
    expect(deal.reasoning).toContain('approximate');
  });

  it('uses grader name in population reasoning', () => {
    const bgsFmv: FairMarketValue = {
      ...fmv,
      grader: 'BGS',
      populationCount: 50,
    };
    const listing = makeListing({ totalPrice: 3500 });
    const deal = scorer.score(listing, card, bgsFmv);
    expect(deal.reasoning).toContain('Low BGS population');
  });
});
