// PriceCharting API client
// Search API: GET https://www.pricecharting.com/api/products?q=<name>&t=<key>
// Product API: GET https://www.pricecharting.com/api/product?id=<id>&t=<key>
// All prices are returned in cents — divide by 100 for USD.
//
// PriceCharting repurposes video-game fields for Pokemon cards:
//   manual-only-price  → PSA 10
//   box-only-price     → PSA 9
//   new-price          → PSA 8
//   cib-price          → PSA 7
//   bgs-10-price       → BGS 10
//   loose-price        → Ungraded
//
// NOTE: graded-price is NOT PSA 7 — it's an aggregate "any graded" value
// (~91% of PSA 9 consistently). Do not use it for any specific PSA grade.

import type { Grader } from '../types/index.js';

const BASE_URL = 'https://www.pricecharting.com/api';

interface GradeFieldResult {
  field: string;
  isApproximate: boolean;
  sourceLabel: string;
}

// Map grader + grade to PriceCharting field name
function gradeField(grader: Grader, grade: number): GradeFieldResult | null {
  // Native BGS field
  if (grader === 'BGS' && grade === 10) {
    return { field: 'bgs-10-price', isApproximate: false, sourceLabel: 'PriceCharting BGS 10' };
  }

  // PSA native fields (each grade has its own dedicated API field)
  if (grader === 'PSA') {
    if (grade === 10) return { field: 'manual-only-price', isApproximate: false, sourceLabel: 'PriceCharting PSA 10' };
    if (grade === 9) return { field: 'box-only-price', isApproximate: false, sourceLabel: 'PriceCharting PSA 9' };
    if (grade === 8) return { field: 'new-price', isApproximate: false, sourceLabel: 'PriceCharting PSA 8' };
    if (grade === 7) return { field: 'cib-price', isApproximate: false, sourceLabel: 'PriceCharting PSA 7' };
    // No dedicated field for PSA 6 and below
    return null;
  }

  // Non-PSA without native field → PSA same-grade fallback, marked approximate
  if (grade === 10) return { field: 'manual-only-price', isApproximate: true, sourceLabel: `PriceCharting PSA 10 (approximate for ${grader} ${grade})` };
  if (grade === 9) return { field: 'box-only-price', isApproximate: true, sourceLabel: `PriceCharting PSA 9 (approximate for ${grader} ${grade})` };
  if (grade === 8) return { field: 'new-price', isApproximate: true, sourceLabel: `PriceCharting PSA 8 (approximate for ${grader} ${grade})` };
  if (grade === 7) return { field: 'cib-price', isApproximate: true, sourceLabel: `PriceCharting PSA 7 (approximate for ${grader} ${grade})` };
  return null;
}

export interface PriceChartingProduct {
  id: string;
  'product-name': string;
  'console-name': string;
  genre?: string;
  'tcg-id'?: string;
  'graded-price'?: number;
  'manual-only-price'?: number;
  'box-only-price'?: number;
  'bgs-10-price'?: number;
  'loose-price'?: number;
  'new-price'?: number;
  'cib-price'?: number;
}

interface SearchResponse {
  products?: PriceChartingProduct[];
  status: string;
}

export interface PriceChartingResult {
  price: number;
  field: string;
  productId: string;
  productName: string;
  isApproximate: boolean;
  sourceLabel: string;
}

export class PriceChartingClient {
  private apiKey: string;
  // Cache full product responses by product ID — avoids re-fetching for multi-grade lookups
  private productCache: Map<string, { value: PriceChartingProduct | null; expiresAt: number }> =
    new Map();
  // Cache search results by tcgPlayerId to avoid re-searching
  private searchCache: Map<string, { value: PriceChartingProduct | null; expiresAt: number }> =
    new Map();
  private cacheTtlMs = 30 * 60 * 1000; // 30 minutes

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getPrice(
    tcgPlayerId: string,
    cardName: string,
    cardNumber: string,
    grade: number,
    grader: Grader = 'PSA',
  ): Promise<PriceChartingResult | null> {
    try {
      const mapping = gradeField(grader, grade);
      if (!mapping) return null; // No dedicated PriceCharting field for this grade

      const product = await this.resolveProduct(tcgPlayerId, cardName, cardNumber);
      if (!product) return null;

      const { field, isApproximate, sourceLabel } = mapping;
      const priceCents = product[field as keyof PriceChartingProduct] as number | undefined;

      if (!priceCents || priceCents === 0) return null;

      return {
        price: priceCents / 100,
        field,
        productId: product.id,
        productName: product['product-name'],
        isApproximate,
        sourceLabel,
      };
    } catch {
      return null;
    }
  }

  private async resolveProduct(
    tcgPlayerId: string,
    name: string,
    number: string,
  ): Promise<PriceChartingProduct | null> {
    // Check search cache first (maps tcgPlayerId → product)
    const searchCached = this.searchCache.get(tcgPlayerId);
    if (searchCached && searchCached.expiresAt > Date.now()) {
      return searchCached.value;
    }

    // Search for the product
    const product = await this.searchProduct(tcgPlayerId, name, number);
    this.searchCache.set(tcgPlayerId, {
      value: product,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    if (product) {
      // Also cache the full product by its ID
      this.productCache.set(product.id, {
        value: product,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }

    return product;
  }

  async getProductById(productId: string): Promise<PriceChartingProduct | null> {
    const cached = this.productCache.get(productId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const url = `${BASE_URL}/product?id=${encodeURIComponent(productId)}&t=${this.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const product = (await res.json()) as PriceChartingProduct;
    if (!product?.id) return null;

    this.productCache.set(productId, {
      value: product,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
    return product;
  }

  private async searchProduct(
    tcgPlayerId: string,
    name: string,
    number: string,
  ): Promise<PriceChartingProduct | null> {
    const url = `${BASE_URL}/products?q=${encodeURIComponent(name)}&t=${this.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = (await res.json()) as SearchResponse;
    if (data.status !== 'success' || !data.products?.length) return null;

    const pokemonProducts = data.products.filter(
      (p) => p.genre === 'Pokemon Card',
    );
    if (!pokemonProducts.length) return null;

    // Prefer exact tcg-id match (most reliable)
    const byTcgId = pokemonProducts.find((p) => p['tcg-id'] === tcgPlayerId);
    if (byTcgId) return byTcgId;

    // Fall back: match by card number in product name
    if (number) {
      const byNumber = pokemonProducts.find((p) =>
        p['product-name'].includes(`#${number}`),
      );
      if (byNumber) return byNumber;
    }

    // Last resort: first Pokemon card result
    return pokemonProducts[0] ?? null;
  }

  clearCache(): void {
    this.productCache.clear();
    this.searchCache.clear();
  }
}
