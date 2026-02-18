import type {
  ResolvedCard,
  EbayListing,
  ScanResult,
  ListingType,
  GachaAgentConfig,
} from '../types/index.js';

const EBAY_BROWSE_API = 'https://api.ebay.com/buy/browse/v1';
const EBAY_SANDBOX_API = 'https://api.sandbox.ebay.com/buy/browse/v1';
const GRADED_CARDS_CATEGORY = '183454';

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
    price: { value: string; currency: string };
    shippingOptions?: Array<{
      shippingCost?: { value: string; currency: string };
    }>;
    buyingOptions: string[];
    seller: {
      username: string;
      feedbackScore: number;
      feedbackPercentage: string;
    };
    image?: { imageUrl: string };
    itemWebUrl: string;
    itemEndDate?: string;
    condition?: string;
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

  async scan(card: ResolvedCard, grade?: number): Promise<ScanResult> {
    await this.ensureToken();

    const query = this.buildSearchQuery(card, grade);
    const listings = await this.searchListings(query, grade);

    return {
      card,
      listings,
      scannedAt: new Date().toISOString(),
      totalFound: listings.length,
    };
  }

  private buildSearchQuery(card: ResolvedCard, grade?: number): string {
    const parts: string[] = [];

    parts.push(card.name);
    parts.push(card.setName);

    if (card.variant) {
      parts.push(card.variant);
    }

    if (card.number) {
      parts.push(`#${card.number}`);
    }

    if (grade) {
      parts.push(`PSA ${grade}`);
    }

    return parts.join(' ');
  }

  private async searchListings(
    query: string,
    grade?: number,
  ): Promise<EbayListing[]> {
    const baseUrl = this.sandbox ? EBAY_SANDBOX_API : EBAY_BROWSE_API;
    const params = new URLSearchParams({
      q: query,
      category_ids: GRADED_CARDS_CATEGORY,
      limit: '50',
      sort: 'price',
    });

    // Add PSA grade aspect filter if specified
    if (grade) {
      params.set(
        'aspect_filter',
        `categoryId:${GRADED_CARDS_CATEGORY},Professional Grader:{PSA},Grade:{${grade}}`,
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

    return data.itemSummaries.map((item) => {
      const price = parseFloat(item.price.value);
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
        currency: item.price.currency,
        shippingCost,
        totalPrice: price + shippingCost,
        listingType,
        sellerUsername: item.seller.username,
        sellerFeedbackScore: item.seller.feedbackScore,
        sellerFeedbackPercent: parseFloat(item.seller.feedbackPercentage),
        imageUrl: item.image?.imageUrl,
        itemUrl: item.itemWebUrl,
        endDate: item.itemEndDate,
        condition: item.condition,
      };
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
