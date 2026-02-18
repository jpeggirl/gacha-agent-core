// ─── Card Identity Types ───

export interface ResolvedCard {
  id: string;
  name: string;
  setName: string;
  setCode: string;
  number: string;
  year: number;
  rarity?: string;
  variant?: string; // "1st Edition", "Shadowless", "Holo", etc.
  imageUrl?: string;
  confidence: number; // 0-1.0 from parse-title API
}

export interface CardCandidate {
  card: ResolvedCard;
  confidence: number;
  matchReason: string;
}

export interface ResolveResult {
  success: boolean;
  bestMatch?: ResolvedCard;
  candidates: CardCandidate[];
  originalQuery: string;
  needsDisambiguation: boolean; // true when confidence < 0.7
}

// ─── Watchlist Types ───

export type AlertChannel = 'telegram' | 'webhook';

export interface WatchlistEntry {
  id: string;
  userId: string;
  card: ResolvedCard;
  targetPrice: number; // alert when listing price is at or below this
  alertChannels: AlertChannel[];
  active: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string;
  lastScannedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateWatchlistInput {
  userId: string;
  card: ResolvedCard;
  targetPrice: number;
  alertChannels?: AlertChannel[];
}

// ─── Pricing Types ───

export interface PricePoint {
  source: string;
  price: number;
  currency: string;
  date: string;
  saleType?: 'completed' | 'active' | 'estimate';
}

export interface FairMarketValue {
  cardId: string;
  grade: number;
  fmv: number;
  currency: string;
  prices: PricePoint[];
  lastUpdated: string;
  populationCount?: number;
}

// ─── eBay Scanner Types ───

export type ListingType = 'BuyItNow' | 'Auction' | 'BestOffer';

export interface EbayListing {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  shippingCost: number;
  totalPrice: number; // price + shipping
  listingType: ListingType;
  sellerUsername: string;
  sellerFeedbackScore: number;
  sellerFeedbackPercent: number;
  imageUrl?: string;
  itemUrl: string;
  endDate?: string;
  condition?: string;
}

export interface ScanResult {
  card: ResolvedCard;
  listings: EbayListing[];
  scannedAt: string;
  totalFound: number;
}

// ─── Deal Scorer Types ───

export type DealSignal =
  | 'strong_buy'
  | 'buy'
  | 'fair'
  | 'overpriced'
  | 'avoid';

export interface ScoredDeal {
  listing: EbayListing;
  card: ResolvedCard;
  fmv: FairMarketValue;
  score: number; // 0-100
  signal: DealSignal;
  reasoning: string;
  savingsPercent: number;
  savingsAmount: number;
}

// ─── Alert Types ───

export interface DealAlert {
  id: string;
  deal: ScoredDeal;
  watchlistEntryId: string;
  sentAt: string;
  channel: AlertChannel;
}

// ─── Scheduler Types ───

export interface ScanJob {
  watchlistEntryId: string;
  priority: number; // higher = scan sooner
  lastScannedAt?: string;
  nextScanAt: string;
}

export interface SchedulerConfig {
  scanIntervalMs: number; // default 15 min
  ebayDailyLimit: number; // 5000
  pricingDailyLimit: number; // 100
  minDealScore: number; // minimum score to trigger alert
  maxConcurrentScans: number;
}

// ─── Storage Adapter ───

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}

// ─── Agent Types ───

export interface Agent {
  id: string; // UUID
  name: string;
  description: string;
  apiKey: string; // gacha_ prefixed
  createdAt: string; // ISO 8601
  lastSeenAt?: string;
}

export interface AgentHeartbeatState {
  agentId: string;
  lastSkillUpdate?: string;
  lastScan?: string;
  lastPrune?: string;
  activeAlerts: number;
  errorCount: number;
  lastPing?: string;
}

// ─── Config ───

export interface GachaAgentConfig {
  pokemonPriceTracker: {
    apiKey: string;
    baseUrl: string;
  };
  ebay?: {
    appId: string;
    certId: string;
    devId?: string;
    sandbox?: boolean;
  };
  telegram?: {
    botToken: string;
    defaultChatId?: string;
  };
  storage: {
    type: 'json' | 'supabase';
    jsonPath?: string;
    supabaseUrl?: string;
    supabaseKey?: string;
  };
  scheduler: SchedulerConfig;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  scanIntervalMs: 15 * 60 * 1000, // 15 minutes
  ebayDailyLimit: 5000,
  pricingDailyLimit: 100,
  minDealScore: 60,
  maxConcurrentScans: 3,
};
