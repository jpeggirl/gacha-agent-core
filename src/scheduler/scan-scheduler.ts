import type {
  SchedulerConfig,
  WatchlistEntry,
  GachaAgentConfig,
} from '../types/index.js';
import { WatchlistManager } from '../watchlist/manager.js';
import { EbayScanner } from '../scanner/ebay.js';
import { PriceEngine } from '../pricing/engine.js';
import { DealScorer } from '../scanner/deal-scorer.js';
import { TelegramAlerts } from '../alerts/telegram.js';

export class ScanScheduler {
  private config: SchedulerConfig;
  private watchlist: WatchlistManager;
  private scanner: EbayScanner;
  private priceEngine: PriceEngine;
  private dealScorer: DealScorer;
  private alerts: TelegramAlerts;

  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ebayCallsToday = 0;
  private pricingCallsToday = 0;
  private lastResetDate: string = '';

  // Track sent alert item IDs per watchlist entry to prevent duplicates
  private sentAlertKeys: Set<string> = new Set();

  constructor(
    config: GachaAgentConfig,
    watchlist: WatchlistManager,
    scanner: EbayScanner,
    priceEngine: PriceEngine,
    dealScorer: DealScorer,
    alerts: TelegramAlerts,
  ) {
    this.config = config.scheduler;
    this.watchlist = watchlist;
    this.scanner = scanner;
    this.priceEngine = priceEngine;
    this.dealScorer = dealScorer;
    this.alerts = alerts;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(
      `[Scheduler] Started — scanning every ${this.config.scanIntervalMs / 1000}s`,
    );
    this.scheduleNext(0); // Run immediately on start
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[Scheduler] Stopped');
  }

  async runOnce(): Promise<void> {
    this.resetDailyCountersIfNeeded();

    const entries = await this.watchlist.listActive();
    if (entries.length === 0) {
      console.log('[Scheduler] No active watchlist entries');
      return;
    }

    const prioritized = this.prioritize(entries);
    console.log(
      `[Scheduler] Scanning ${prioritized.length} entries (${this.ebayCallsToday}/${this.config.ebayDailyLimit} eBay calls used)`,
    );

    // Process in batches respecting concurrency limit
    for (let i = 0; i < prioritized.length; i += this.config.maxConcurrentScans) {
      if (!this.canMakeEbayCall()) {
        console.log('[Scheduler] eBay daily rate limit reached — stopping');
        break;
      }

      const batch = prioritized.slice(i, i + this.config.maxConcurrentScans);
      await Promise.all(batch.map((entry) => this.scanEntry(entry)));
    }
  }

  private async scanEntry(entry: WatchlistEntry): Promise<void> {
    try {
      if (!this.canMakeEbayCall()) return;

      // Default grade to 9 if not specified in card metadata
      const grade = (entry.metadata?.grade as number) ?? 9;

      // 1. Scan eBay
      this.ebayCallsToday++;
      const scanResult = await this.scanner.scan(entry.card, grade);
      console.log(
        `[Scheduler] Found ${scanResult.totalFound} listings for ${entry.card.name}`,
      );

      if (scanResult.listings.length === 0) {
        await this.watchlist.markScanned(entry.id);
        return;
      }

      // 2. Get FMV
      if (!this.canMakePricingCall()) {
        console.log('[Scheduler] Pricing daily limit reached — skipping FMV');
        return;
      }
      this.pricingCallsToday++;
      const fmv = await this.priceEngine.getFMV(entry.card, grade);

      // 3. Score deals
      const scoredDeals = this.dealScorer.scoreMany(
        scanResult.listings,
        entry.card,
        fmv,
      );

      // 4. Alert on deals that meet threshold and are below target price
      const alertDeals = scoredDeals.filter(
        (deal) =>
          deal.score >= this.config.minDealScore &&
          deal.listing.totalPrice <= entry.targetPrice,
      );

      for (const deal of alertDeals) {
        const alertKey = `${entry.id}:${deal.listing.itemId}`;
        if (this.sentAlertKeys.has(alertKey)) continue;

        if (entry.alertChannels.includes('telegram')) {
          const alert = await this.alerts.sendDealAlert(deal, entry.id);
          if (alert) {
            this.sentAlertKeys.add(alertKey);
            console.log(
              `[Scheduler] Alert sent: ${deal.card.name} — $${deal.listing.totalPrice} (score: ${deal.score})`,
            );
          }
        }
      }

      await this.watchlist.markScanned(entry.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(
        `[Scheduler] Error scanning ${entry.card.name}: ${msg}`,
      );
    }
  }

  private prioritize(entries: WatchlistEntry[]): WatchlistEntry[] {
    return [...entries].sort((a, b) => {
      // Entries never scanned go first
      if (!a.lastScannedAt && b.lastScannedAt) return -1;
      if (a.lastScannedAt && !b.lastScannedAt) return 1;

      // Then by oldest scan time
      if (a.lastScannedAt && b.lastScannedAt) {
        return (
          new Date(a.lastScannedAt).getTime() -
          new Date(b.lastScannedAt).getTime()
        );
      }

      // Then by creation date (newer first — user just added it)
      return (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.runOnce();
      this.scheduleNext(this.config.scanIntervalMs);
    }, delayMs);
  }

  private canMakeEbayCall(): boolean {
    return this.ebayCallsToday < this.config.ebayDailyLimit;
  }

  private canMakePricingCall(): boolean {
    return this.pricingCallsToday < this.config.pricingDailyLimit;
  }

  private resetDailyCountersIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0]!;
    if (today !== this.lastResetDate) {
      this.ebayCallsToday = 0;
      this.pricingCallsToday = 0;
      this.lastResetDate = today;
    }
  }
}
