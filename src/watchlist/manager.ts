import { randomUUID } from 'node:crypto';
import type { StorageAdapter, WatchlistEntry, Grader } from '../types/index.js';

const PREFIX = 'watchlist:';

export interface AddWatchlistInput {
  email: string;
  cardId: string;
  grade: number;
  grader?: Grader;
  cardName: string;
  setName?: string;
  imageUrl?: string;
}

export class WatchlistManager {
  constructor(private storage: StorageAdapter) {}

  async add(input: AddWatchlistInput): Promise<WatchlistEntry> {
    const email = input.email.toLowerCase().trim();

    // Deduplicate by email + cardId + grade
    const existing = await this.getByEmail(email);
    const duplicate = existing.find(
      (e) => e.cardId === input.cardId && e.grade === input.grade,
    );
    if (duplicate) return duplicate;

    const entry: WatchlistEntry = {
      id: randomUUID(),
      email,
      cardId: input.cardId,
      grade: input.grade,
      grader: input.grader ?? 'PSA',
      cardName: input.cardName,
      setName: input.setName ?? '',
      imageUrl: input.imageUrl,
      createdAt: new Date().toISOString(),
    };

    await this.storage.set(`${PREFIX}${entry.id}`, entry);
    return entry;
  }

  async getByEmail(email: string): Promise<WatchlistEntry[]> {
    const normalizedEmail = email.toLowerCase().trim();
    const keys = await this.storage.list(PREFIX);
    const entries: WatchlistEntry[] = [];

    for (const key of keys) {
      const entry = await this.storage.get<WatchlistEntry>(key);
      if (entry && entry.email === normalizedEmail) {
        entries.push(entry);
      }
    }

    return entries.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async remove(id: string): Promise<boolean> {
    return this.storage.delete(`${PREFIX}${id}`);
  }
}
