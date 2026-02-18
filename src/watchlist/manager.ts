import { randomUUID } from 'node:crypto';
import type {
  WatchlistEntry,
  CreateWatchlistInput,
  StorageAdapter,
} from '../types/index.js';

const WATCHLIST_PREFIX = 'watchlist:';

export class WatchlistManager {
  private storage: StorageAdapter;

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  async add(input: CreateWatchlistInput): Promise<WatchlistEntry> {
    const now = new Date().toISOString();
    const entry: WatchlistEntry = {
      id: randomUUID(),
      userId: input.userId,
      card: input.card,
      targetPrice: input.targetPrice,
      alertChannels: input.alertChannels ?? ['telegram'],
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.set(this.key(entry.id), entry);

    // Maintain a user index for fast lookups
    const userIndex = await this.getUserIndex(input.userId);
    userIndex.push(entry.id);
    await this.storage.set(this.userKey(input.userId), userIndex);

    return entry;
  }

  async get(id: string): Promise<WatchlistEntry | null> {
    return this.storage.get<WatchlistEntry>(this.key(id));
  }

  async update(
    id: string,
    updates: Partial<Pick<WatchlistEntry, 'targetPrice' | 'alertChannels' | 'active'>>,
  ): Promise<WatchlistEntry | null> {
    const entry = await this.get(id);
    if (!entry) return null;

    const updated: WatchlistEntry = {
      ...entry,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await this.storage.set(this.key(id), updated);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const entry = await this.get(id);
    if (!entry) return false;

    await this.storage.delete(this.key(id));

    // Remove from user index
    const userIndex = await this.getUserIndex(entry.userId);
    const filtered = userIndex.filter((eid) => eid !== id);
    await this.storage.set(this.userKey(entry.userId), filtered);

    return true;
  }

  async listByUser(userId: string): Promise<WatchlistEntry[]> {
    const index = await this.getUserIndex(userId);
    const entries: WatchlistEntry[] = [];
    for (const id of index) {
      const entry = await this.get(id);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  async listActive(): Promise<WatchlistEntry[]> {
    const keys = await this.storage.list(WATCHLIST_PREFIX);
    const entries: WatchlistEntry[] = [];
    for (const key of keys) {
      const entry = await this.storage.get<WatchlistEntry>(key);
      if (entry?.active) entries.push(entry);
    }
    return entries;
  }

  async markScanned(id: string): Promise<void> {
    const entry = await this.get(id);
    if (!entry) return;
    entry.lastScannedAt = new Date().toISOString();
    entry.updatedAt = entry.lastScannedAt;
    await this.storage.set(this.key(id), entry);
  }

  private key(id: string): string {
    return `${WATCHLIST_PREFIX}${id}`;
  }

  private userKey(userId: string): string {
    return `watchlist-user:${userId}`;
  }

  private async getUserIndex(userId: string): Promise<string[]> {
    return (await this.storage.get<string[]>(this.userKey(userId))) ?? [];
  }
}
