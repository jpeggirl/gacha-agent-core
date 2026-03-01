import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WatchlistManager } from './manager.js';
import { InMemoryStorage } from '../mocks/in-memory-storage.js';

describe('WatchlistManager', () => {
  let storage: InMemoryStorage;
  let manager: WatchlistManager;

  beforeEach(() => {
    storage = new InMemoryStorage();
    manager = new WatchlistManager(storage);
  });

  it('adds a watchlist entry', async () => {
    const entry = await manager.add({
      email: 'test@example.com',
      cardId: '416',
      grade: 10,
      cardName: 'Charizard',
      setName: 'Base Set',
    });

    expect(entry.id).toBeTruthy();
    expect(entry.email).toBe('test@example.com');
    expect(entry.cardId).toBe('416');
    expect(entry.grade).toBe(10);
    expect(entry.grader).toBe('PSA');
    expect(entry.cardName).toBe('Charizard');
    expect(entry.setName).toBe('Base Set');
    expect(entry.createdAt).toBeTruthy();
  });

  it('deduplicates by email + cardId + grade', async () => {
    const first = await manager.add({
      email: 'test@example.com',
      cardId: '416',
      grade: 10,
      cardName: 'Charizard',
    });

    const second = await manager.add({
      email: 'test@example.com',
      cardId: '416',
      grade: 10,
      cardName: 'Charizard',
    });

    expect(second.id).toBe(first.id);

    const entries = await manager.getByEmail('test@example.com');
    expect(entries).toHaveLength(1);
  });

  it('allows same card at different grades', async () => {
    await manager.add({
      email: 'test@example.com',
      cardId: '416',
      grade: 9,
      cardName: 'Charizard',
    });

    await manager.add({
      email: 'test@example.com',
      cardId: '416',
      grade: 10,
      cardName: 'Charizard',
    });

    const entries = await manager.getByEmail('test@example.com');
    expect(entries).toHaveLength(2);
  });

  it('normalizes email to lowercase', async () => {
    await manager.add({
      email: 'Test@Example.COM',
      cardId: '416',
      grade: 10,
      cardName: 'Charizard',
    });

    const entries = await manager.getByEmail('test@example.com');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.email).toBe('test@example.com');
  });

  it('getByEmail returns empty for unknown email', async () => {
    const entries = await manager.getByEmail('nobody@example.com');
    expect(entries).toEqual([]);
  });

  it('removes an entry by id', async () => {
    const entry = await manager.add({
      email: 'test@example.com',
      cardId: '416',
      grade: 10,
      cardName: 'Charizard',
    });

    const removed = await manager.remove(entry.id);
    expect(removed).toBe(true);

    const entries = await manager.getByEmail('test@example.com');
    expect(entries).toHaveLength(0);
  });

  it('remove returns false for nonexistent id', async () => {
    const removed = await manager.remove('nonexistent-id');
    expect(removed).toBe(false);
  });

  it('returns entries sorted newest first', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    await manager.add({
      email: 'test@example.com',
      cardId: '416',
      grade: 10,
      cardName: 'Charizard',
    });

    vi.setSystemTime(new Date('2025-01-02T00:00:00Z'));

    await manager.add({
      email: 'test@example.com',
      cardId: '444',
      grade: 9,
      cardName: 'Pikachu',
    });

    vi.useRealTimers();

    const entries = await manager.getByEmail('test@example.com');
    expect(entries).toHaveLength(2);
    // Second added should be first (newest)
    expect(entries[0]!.cardName).toBe('Pikachu');
    expect(entries[1]!.cardName).toBe('Charizard');
  });

  it('preserves imageUrl if provided', async () => {
    const entry = await manager.add({
      email: 'test@example.com',
      cardId: '416',
      grade: 10,
      cardName: 'Charizard',
      imageUrl: 'https://example.com/charizard.png',
    });

    expect(entry.imageUrl).toBe('https://example.com/charizard.png');
  });
});
