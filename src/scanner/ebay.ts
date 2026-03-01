import type {
  ResolvedCard,
  EbayListing,
  EbaySearchOverride,
  ScanResult,
  ListingType,
  GachaAgentConfig,
  Grader,
} from '../types/index.js';
import { EBAY_GRADER_MAP, graderTitleRegex, graderNegationRegex, formatGradeLabel } from '../grader/utils.js';
import { EbayOverrideRegistry } from './ebay-overrides.js';

const EBAY_BROWSE_API = 'https://api.ebay.com/buy/browse/v1';
const EBAY_SANDBOX_API = 'https://api.sandbox.ebay.com/buy/browse/v1';
const GRADED_CARDS_CATEGORY = '183454';

/** Known rarity abbreviation mappings for variant post-filtering.
 * Keys are the full rarity phrase (lowercased); values are abbreviations/alternates. */
const VARIANT_ABBREVIATION_MAP: Record<string, string[]> = {
  'special illustration rare': ['sir'],
  'special art rare': ['sar'],
  'illustration rare': ['ir'],
  'art rare': ['ar'],
  'hyper rare': ['hr'],
  'secret rare': ['sr'],
  'ultra rare': ['ur'],
  'full art': ['fa'],
  'rainbow rare': ['rr', 'rainbow'],
  'alternate art': ['alt art', 'aa'],
  'alt art': ['alternate art', 'aa'],
};

/** Words too common in Pokemon card titles to be useful for variant matching. */
const GENERIC_VARIANT_WORDS = new Set([
  'pokemon', 'card', 'cards', 'rare', 'holo', 'reverse',
  'promo', 'promos', 'x', 'the', 'a', 'an', 'of', 'and', 'or', 'en',
]);

/** Check if a title matches a variant keyword, including known abbreviations.
 * For multi-word variants not in the abbreviation map, falls back to
 * word-splitting: filters out generic words and requires all distinctive words. */
export function titleMatchesVariant(title: string, keyword: string): boolean {
  const titleLower = title.toLowerCase();
  const kwLower = keyword.toLowerCase();
  // 1. Direct substring match
  if (titleLower.includes(kwLower)) return true;
  // 2. Known rarity abbreviation match
  const abbreviations = VARIANT_ABBREVIATION_MAP[kwLower];
  if (abbreviations) {
    return abbreviations.some((abbr) => {
      const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(title);
    });
  }
  // 3. Word-splitting fallback for multi-word variants (e.g. "POKEMON X VAN GOGH")
  const words = kwLower.split(/\s+/).filter((w) => !GENERIC_VARIANT_WORDS.has(w));
  if (words.length >= 2) {
    return words.every((w) => titleLower.includes(w));
  }
  return false;
}

/** Clean a card name for eBay search — normalizes PPT formatting quirks. */
function cleanCardName(name: string): string {
  return name
    .replace(/\//g, ' ')   // "PIKACHU/GREY FELT HAT" → "PIKACHU GREY FELT HAT"
    .replace(/\s+/g, ' ')
    .trim();
}

/** Noise words commonly found in raw eBay titles that don't help search specificity. */
const RAW_TITLE_NOISE = new Set([
  'pokemon', 'jpn', 'japan', 'japanese', 'eng', 'english',
  'promo', 'promos', 'foil', 'holo', 'holofoil', 'holographic',
  'card', 'cards', 'tcg', 'ccg', 'cgc', 'mint',
  'comics', 'comic', 'magazine',
  'rare', 'ultra', 'secret', 'common', 'uncommon',
]);

/** Year-like tokens at the start of raw titles (e.g., "2001", "1999"). */
const YEAR_RE = /^(19|20)\d{2}$/;

/**
 * Shorten an overly long raw eBay title to its distinctive terms.
 * If the name is ≤5 words it's likely a clean name ("Shining Mew") — returned as-is.
 * If >5 words, strip noise and keep up to 4 distinctive terms.
 *
 * Example: "2001 POKEMON JPN PROMO COROCORO COMICS FOIL 151 SHINING MEW"
 *        → "COROCORO 151 SHINING MEW"
 */
export function shortenRawTitle(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length <= 5) return name;

  const distinctive = words.filter((w) => {
    const lower = w.toLowerCase();
    if (RAW_TITLE_NOISE.has(lower)) return false;
    if (YEAR_RE.test(w)) return false;
    return true;
  });

  // Keep up to 4 distinctive words; if nothing survived, fall back to last 3 words
  if (distinctive.length === 0) return words.slice(-3).join(' ');
  return distinctive.slice(0, 4).join(' ');
}

/**
 * Extract variant-distinguishing keywords from card metadata.
 * Used to both refine the eBay query and post-filter results.
 */
export function inferVariantKeywords(card: ResolvedCard): string[] {
  // If variant field is populated, use it directly
  if (card.variant) {
    return [card.variant];
  }

  // Extract parenthetical content from setName (e.g., "Base Set (Shadowless)" → "Shadowless")
  const parenMatch = card.setName.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const content = parenMatch[1]!.trim();
    // Only return known variant terms that distinguish price tiers
    const knownVariants = ['Shadowless', '1st Edition', 'Unlimited'];
    for (const kv of knownVariants) {
      if (content.toLowerCase() === kv.toLowerCase()) {
        return [content];
      }
    }
    // If it's not a known variant but is parenthetical, still use it
    return [content];
  }

  return [];
}

interface EbayTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface EbaySearchResponse {
  total: number;
  itemSummaries?: Array<{
    itemId: string;
    title: string;
    price?: { value: string; currency: string };
    currentBidPrice?: { value: string; currency: string };
    shippingOptions?: Array<{
      shippingCost?: { value: string; currency: string };
    }>;
    buyingOptions: string[];
    seller?: {
      username: string;
      feedbackScore: number;
      feedbackPercentage: string;
    };
    image?: { imageUrl: string };
    itemWebUrl: string;
    itemEndDate?: string;
    condition?: string;
    bidCount?: number;
  }>;
}

export class EbayScanner {
  private appId: string;
  private certId: string;
  private sandbox: boolean;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: GachaAgentConfig) {
    if (!config.ebay) {
      throw new Error('eBay configuration is required for EbayScanner');
    }
    this.appId = config.ebay.appId;
    this.certId = config.ebay.certId;
    this.sandbox = config.ebay.sandbox ?? false;
  }

  async searchByQuery(query: string, options?: { grade?: number; grader?: Grader; override?: EbaySearchOverride }): Promise<EbayListing[]> {
    await this.ensureToken();
    const listings = await this.searchListings(query, options?.grade, options?.grader);
    if (options?.override) {
      return EbayOverrideRegistry.applyTitleFilter(listings, options.override);
    }
    return listings;
  }

  async getTrending(limit = 20): Promise<EbayListing[]> {
    try {
      await this.ensureToken();
      const baseUrl = this.sandbox ? EBAY_SANDBOX_API : EBAY_BROWSE_API;
      const params = new URLSearchParams({
        q: 'PSA Pokemon card',
        category_ids: GRADED_CARDS_CATEGORY,
        limit: String(limit),
        sort: 'newlyListed',
      });

      const res = await fetch(`${baseUrl}/item_summary/search?${params}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        throw new Error(`eBay Browse API error: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as EbaySearchResponse;
      if (!data.itemSummaries) return [];

      return data.itemSummaries
        .filter((item) => item.price != null || item.currentBidPrice != null)
        .map((item) => {
        const priceObj = item.price ?? item.currentBidPrice!;
        const price = parseFloat(priceObj.value);
        const shippingCost = item.shippingOptions?.[0]?.shippingCost
          ? parseFloat(item.shippingOptions[0].shippingCost.value)
          : 0;

        const listingType: ListingType = item.buyingOptions.includes('FIXED_PRICE')
          ? 'BuyItNow'
          : item.buyingOptions.includes('BEST_OFFER')
            ? 'BestOffer'
            : 'Auction';

        return {
          itemId: item.itemId,
          title: item.title,
          price,
          currency: priceObj.currency,
          shippingCost,
          totalPrice: price + shippingCost,
          listingType,
          sellerUsername: item.seller?.username ?? 'unknown',
          sellerFeedbackScore: item.seller?.feedbackScore ?? 0,
          sellerFeedbackPercent: item.seller?.feedbackPercentage
            ? parseFloat(item.seller.feedbackPercentage)
            : 0,
          imageUrl: item.image?.imageUrl,
          itemUrl: item.itemWebUrl,
          endDate: item.itemEndDate,
          condition: item.condition,
          bidCount: item.bidCount,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[EbayScanner] getTrending failed: ${message}`);
      return [];
    }
  }

  async scan(card: ResolvedCard, grade?: number, grader: Grader = 'PSA', override?: EbaySearchOverride): Promise<ScanResult> {
    try {
      await this.ensureToken();

      const query = override?.customQuery
        ? (grade ? `${override.customQuery} ${formatGradeLabel(grader, grade)}` : override.customQuery)
        : this.buildSearchQuery(card, grade, grader);
      let listings = await this.searchListings(query, grade, grader);

      // Auto-filter: require variant keywords in titles when no custom query override
      // This catches mismatches like Unlimited Charizards appearing for Shadowless searches
      if (!override?.customQuery) {
        const variantKeywords = inferVariantKeywords(card);
        if (variantKeywords.length > 0) {
          const required = variantKeywords.map((kw) => kw.toLowerCase());
          listings = listings.filter((listing) => {
            const title = listing.title.toLowerCase();
            return required.every((kw) => title.includes(kw));
          });
        }
      }

      // Apply manual override title filter (stacks with auto-filter above)
      if (override) {
        listings = EbayOverrideRegistry.applyTitleFilter(listings, override);
      }

      return {
        card,
        listings,
        scannedAt: new Date().toISOString(),
        totalFound: listings.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[EbayScanner] Scan failed: ${message}`);
      return {
        card,
        listings: [],
        scannedAt: new Date().toISOString(),
        totalFound: 0,
      };
    }
  }

  /**
   * Auction-specific scan: uses a simplified query strategy to find active auctions.
   * Unlike scan(), this method:
   * - Uses a shorter query (card name + number only) to maximize eBay results
   * - Doesn't include grade/grader in the text query (aspect_filter handles it)
   * - Skips long variant phrases that make queries too specific
   * - Uses abbreviation-aware variant filtering (e.g. "SIR" matches "Special Illustration Rare")
   * - Sorts by endingSoonest to surface auctions ending soon
   */
  async scanAuctions(card: ResolvedCard, grade?: number, grader: Grader = 'PSA', override?: EbaySearchOverride): Promise<EbayListing[]> {
    try {
      await this.ensureToken();

      const query = override?.customQuery
        ? override.customQuery
        : this.buildAuctionQuery(card);
      let listings = await this.searchAuctionListings(query, grade, grader);

      // Abbreviation-aware variant filter
      if (!override?.customQuery) {
        const variantKeywords = inferVariantKeywords(card);
        if (variantKeywords.length > 0) {
          listings = listings.filter((listing) => {
            const title = listing.title.toLowerCase();
            return variantKeywords.every((kw) => titleMatchesVariant(title, kw));
          });
        }
      }

      if (override) {
        listings = EbayOverrideRegistry.applyTitleFilter(listings, override);
      }

      return listings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[EbayScanner] scanAuctions failed: ${message}`);
      return [];
    }
  }

  /** Build a short query for auction searches — cleaned card name + number only.
   * Long variant phrases and grade labels are omitted to maximize results;
   * the aspect_filter and post-filter handle those concerns. */
  private buildAuctionQuery(card: ResolvedCard): string {
    const cleaned = cleanCardName(card.name);
    const parts: string[] = [shortenRawTitle(cleaned)];

    // Only include short variant terms (≤2 words) like "Shadowless", "1st Edition"
    if (card.variant) {
      const wordCount = card.variant.trim().split(/\s+/).length;
      if (wordCount <= 2) {
        parts.push(card.variant);
      }
    }

    if (card.number && card.number !== 'unknown') {
      parts.push(card.number);
    }

    // Inferred variant keywords from set name (only short ones)
    const variantKeywords = inferVariantKeywords(card);
    for (const kw of variantKeywords) {
      const wordCount = kw.trim().split(/\s+/).length;
      if (wordCount <= 2 && !parts.some((p) => p.toLowerCase() === kw.toLowerCase())) {
        parts.push(kw);
      }
    }

    return parts.join(' ');
  }

  /** Search eBay specifically for auctions, sorted by ending soonest. */
  private async searchAuctionListings(
    query: string,
    grade?: number,
    grader: Grader = 'PSA',
  ): Promise<EbayListing[]> {
    const baseUrl = this.sandbox ? EBAY_SANDBOX_API : EBAY_BROWSE_API;
    const params = new URLSearchParams({
      q: query,
      limit: '50',
      filter: 'buyingOptions:{AUCTION}',
      sort: 'endingSoonest',
    });

    params.set('category_ids', GRADED_CARDS_CATEGORY);
    if (grade) {
      params.set(
        'aspect_filter',
        `categoryId:${GRADED_CARDS_CATEGORY},Professional Grader:{${EBAY_GRADER_MAP[grader]}},Grade:{${grade}}`,
      );
    } else {
      params.set(
        'aspect_filter',
        `categoryId:${GRADED_CARDS_CATEGORY},Professional Grader:{${EBAY_GRADER_MAP[grader]}}`,
      );
    }

    const res = await fetch(`${baseUrl}/item_summary/search?${params}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`eBay Browse API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as EbaySearchResponse;
    if (!data.itemSummaries) return [];

    // Auction items use `currentBidPrice` instead of `price`
    const listings = data.itemSummaries
      .filter((item) => item.price != null || item.currentBidPrice != null)
      .map((item) => {
        const priceObj = item.currentBidPrice ?? item.price!;
        const price = parseFloat(priceObj.value);
        const shippingCost = item.shippingOptions?.[0]?.shippingCost
          ? parseFloat(item.shippingOptions[0].shippingCost.value)
          : 0;

        return {
          itemId: item.itemId,
          title: item.title,
          price,
          currency: priceObj.currency,
          shippingCost,
          totalPrice: price + shippingCost,
          listingType: 'Auction' as ListingType,
          sellerUsername: item.seller?.username ?? 'unknown',
          sellerFeedbackScore: item.seller?.feedbackScore ?? 0,
          sellerFeedbackPercent: item.seller?.feedbackPercentage
            ? parseFloat(item.seller.feedbackPercentage)
            : 0,
          imageUrl: item.image?.imageUrl,
          itemUrl: item.itemWebUrl,
          endDate: item.itemEndDate,
          condition: item.condition,
          bidCount: item.bidCount,
        };
      });

    return this.filterByGrader(listings, grade, grader);
  }

  private buildSearchQuery(card: ResolvedCard, grade?: number, grader: Grader = 'PSA'): string {
    const parts: string[] = [];

    parts.push(shortenRawTitle(card.name));

    // Intentionally exclude set name to avoid overly narrow search
    // eBay title matches are more reliable with card name + variant + number

    if (card.variant) {
      parts.push(card.variant);
    }

    if (card.number && card.number !== 'unknown') {
      parts.push(card.number);
    }

    // Append variant keywords inferred from set name (e.g., "Shadowless" from "Base Set (Shadowless)")
    // These may overlap with card.variant but dedup below prevents double-inclusion
    const variantKeywords = inferVariantKeywords(card);
    for (const kw of variantKeywords) {
      // Avoid duplicating if already included via card.variant
      if (!parts.some((p) => p.toLowerCase() === kw.toLowerCase())) {
        parts.push(kw);
      }
    }

    if (grade) {
      parts.push(formatGradeLabel(grader, grade));
    }

    return parts.join(' ');
  }

  private async searchListings(
    query: string,
    grade?: number,
    grader: Grader = 'PSA',
  ): Promise<EbayListing[]> {
    const baseUrl = this.sandbox ? EBAY_SANDBOX_API : EBAY_BROWSE_API;
    const params = new URLSearchParams({
      q: query,
      limit: '50',
    });

    // Always search within graded cards category and filter by grader (PSA).
    // When a specific grade is requested, also filter by grade and sort by price for deal scanning.
    // When no grade, use relevance sorting ("Best Match") to surface the most relevant PSA cards.
    params.set('category_ids', GRADED_CARDS_CATEGORY);
    if (grade) {
      params.set('sort', 'price');
      params.set(
        'aspect_filter',
        `categoryId:${GRADED_CARDS_CATEGORY},Professional Grader:{${EBAY_GRADER_MAP[grader]}},Grade:{${grade}}`,
      );
    } else {
      params.set(
        'aspect_filter',
        `categoryId:${GRADED_CARDS_CATEGORY},Professional Grader:{${EBAY_GRADER_MAP[grader]}}`,
      );
    }

    const res = await fetch(`${baseUrl}/item_summary/search?${params}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`eBay Browse API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as EbaySearchResponse;

    if (!data.itemSummaries) return [];

    const listings = data.itemSummaries
      .filter((item) => item.price != null || item.currentBidPrice != null)
      .map((item) => {
      const priceObj = item.price ?? item.currentBidPrice!;
      const price = parseFloat(priceObj.value);
      const shippingCost = item.shippingOptions?.[0]?.shippingCost
        ? parseFloat(item.shippingOptions[0].shippingCost.value)
        : 0;

      const listingType: ListingType = item.buyingOptions.includes(
        'FIXED_PRICE',
      )
        ? 'BuyItNow'
        : item.buyingOptions.includes('BEST_OFFER')
          ? 'BestOffer'
          : 'Auction';

      return {
        itemId: item.itemId,
        title: item.title,
        price,
        currency: priceObj.currency,
        shippingCost,
        totalPrice: price + shippingCost,
        listingType,
        sellerUsername: item.seller?.username ?? 'unknown',
        sellerFeedbackScore: item.seller?.feedbackScore ?? 0,
        sellerFeedbackPercent: item.seller?.feedbackPercentage
          ? parseFloat(item.seller.feedbackPercentage)
          : 0,
        imageUrl: item.image?.imageUrl,
        itemUrl: item.itemWebUrl,
        endDate: item.itemEndDate,
        condition: item.condition,
        bidCount: item.bidCount,
      };
    });

    return this.filterByGrader(listings, grade, grader);
  }

  private filterByGrader(listings: EbayListing[], grade?: number, grader: Grader = 'PSA'): EbayListing[] {
    if (!grade) return listings;
    const { requested } = graderTitleRegex(grader);
    const negation = graderNegationRegex(grader);

    return listings.filter((l) => {
      // Reject if title explicitly negates the requested grader ("not PSA", "no PSA")
      if (negation.test(l.title)) return false;
      // Require the requested grader to appear in the title
      return requested.test(l.title);
    });
  }

  private async ensureToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return;

    const credentials = Buffer.from(
      `${this.appId}:${this.certId}`,
    ).toString('base64');

    const tokenUrl = this.sandbox
      ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
      : 'https://api.ebay.com/identity/v1/oauth2/token';

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      }),
    });

    if (!res.ok) {
      throw new Error(`eBay OAuth error: ${res.status} ${res.statusText}`);
    }

    const token = (await res.json()) as EbayTokenResponse;
    this.accessToken = token.access_token;
    // Refresh 5 minutes before expiry
    this.tokenExpiresAt = Date.now() + (token.expires_in - 300) * 1000;
  }
}
