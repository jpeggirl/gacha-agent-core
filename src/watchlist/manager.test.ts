import { describe, it, expect, beforeEach } from 'vitest';
import { WatchlistManager } from './manager.js';
import type { StorageAdapter, ResolvedCard } from '../types/index.js';

class InMemoryStorage implements StorageAdapter {
  private data: Map<string, unknown> = new Map();

  async get<T>(key: string): Promise<T | null> {
    const val = this.data.get(key);
    return val !== undefined ? (val as T) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return Array.from(this.data.keys()).filter((k) => k.startsWith(prefix));
  }
}

const testCard: ResolvedCard = {
  id: 'base1-4',
  name: 'Charizard',
  setName: 'Base Set',
  setCode: 'base1',
  number: '4',
  year: 1999,
  confidence: 0.95,
};

describe('WatchlistManager', () => {
  let manager: WatchlistManager;

  beforeEach(() => {
    manager = new WatchlistManager(new InMemoryStorage());
  });

  it('adds an entry and retrieves it', async () => {
    const entry = await manager.add({
      userId: 'user1',
      card: testCard,
      targetPrice: 5000,
    });

    expect(entry.id).toBeTruthy();
    expect(entry.card.name).toBe('Charizard');
    expect(entry.targetPrice).toBe(5000);
    expect(entry.active).toBe(true);

    const retrieved = await manager.get(entry.id);
    expect(retrieved).toEqual(entry);
  });

  it('lists entries by user', async () => {
    await manager.add({ userId: 'user1', card: testCard, targetPrice: 5000 });
    await manager.add({ userId: 'user1', card: testCard, targetPrice: 3000 });
    await manager.add({ userId: 'user2', card: testCard, targetPrice: 4000 });

    const user1Entries = await manager.listByUser('user1');
    expect(user1Entries).toHaveLength(2);

    const user2Entries = await manager.listByUser('user2');
    expect(user2Entries).toHaveLength(1);
  });

  it('updates an entry', async () => {
    const entry = await manager.add({
      userId: 'user1',
      card: testCard,
      targetPrice: 5000,
    });

    const updated = await manager.update(entry.id, { targetPrice: 4500 });
    expect(updated?.targetPrice).toBe(4500);
  });

  it('removes an entry', async () => {
    const entry = await manager.add({
      userId: 'user1',
      card: testCard,
      targetPrice: 5000,
    });

    const removed = await manager.remove(entry.id);
    expect(removed).toBe(true);

    const entries = await manager.listByUser('user1');
    expect(entries).toHaveLength(0);
  });

  it('lists active entries across all users', async () => {
    const e1 = await manager.add({
      userId: 'user1',
      card: testCard,
      targetPrice: 5000,
    });
    await manager.add({ userId: 'user2', card: testCard, targetPrice: 3000 });

    // Deactivate one
    await manager.update(e1.id, { active: false });

    const active = await manager.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]!.userId).toBe('user2');
  });

  it('marks entry as scanned', async () => {
    const entry = await manager.add({
      userId: 'user1',
      card: testCard,
      targetPrice: 5000,
    });

    await manager.markScanned(entry.id);
    const updated = await manager.get(entry.id);
    expect(updated?.lastScannedAt).toBeTruthy();
  });
});
