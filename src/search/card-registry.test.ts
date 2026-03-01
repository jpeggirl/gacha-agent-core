import { describe, it, expect, beforeEach } from 'vitest';
import { CardRegistry } from './card-registry.js';
import { InMemoryStorage } from '../mocks/in-memory-storage.js';

describe('CardRegistry', () => {
  let storage: InMemoryStorage;
  let registry: CardRegistry;

  beforeEach(() => {
    storage = new InMemoryStorage();
    registry = new CardRegistry(storage);
  });

  // ─── register() ───

  it('registers a new card and returns RegisteredCard', async () => {
    const result = await registry.register({
      name: 'Pikachu Scream Munch',
      imageUrl: 'https://example.com/pikachu.jpg',
      ebayItemId: 'ebay-123',
      query: 'pikachu scream',
    });

    expect(result.card.id).toBe('registered:pikachu-scream-munch');
    expect(result.card.name).toBe('Pikachu Scream Munch');
    expect(result.card.setCode).toBe('user-registered');
    expect(result.card.confidence).toBe(0.80);
    expect(result.card.imageUrl).toBe('https://example.com/pikachu.jpg');
    expect(result.sourceEbayItemId).toBe('ebay-123');
    expect(result.sourceQuery).toBe('pikachu scream');
    expect(result.searchAliases).toEqual(['pikachu-scream']);
  });

  it('deduplicates by normalized name — adds query as alias instead', async () => {
    await registry.register({
      name: 'Pikachu Scream Munch',
      ebayItemId: 'ebay-123',
      query: 'pikachu scream',
    });

    const second = await registry.register({
      name: 'Pikachu Scream Munch',
      ebayItemId: 'ebay-456',
      query: 'scream pikachu munch card',
    });

    // Should be same entry, not a duplicate
    const all = await registry.getAll();
    expect(all).toHaveLength(1);
    // Second query added as alias
    expect(second.searchAliases).toContain('scream-pikachu-munch-card');
    expect(second.searchAliases).toContain('pikachu-scream');
  });

  it('does not add duplicate aliases', async () => {
    await registry.register({
      name: 'Pikachu Scream Munch',
      ebayItemId: 'ebay-123',
      query: 'pikachu scream',
    });

    await registry.register({
      name: 'Pikachu Scream Munch',
      ebayItemId: 'ebay-456',
      query: 'pikachu scream',
    });

    const all = await registry.getAll();
    expect(all[0].searchAliases.filter((a) => a === 'pikachu-scream')).toHaveLength(1);
  });

  it('does not add alias when query normalizes to the same as the name', async () => {
    const result = await registry.register({
      name: 'Pikachu Scream',
      ebayItemId: 'ebay-123',
      query: 'pikachu scream',
    });

    expect(result.searchAliases).toEqual([]);
  });

  // ─── search() ───

  it('finds registered card by name tokens', async () => {
    await registry.register({
      name: 'Pikachu Scream Munch',
      ebayItemId: 'ebay-123',
      query: 'pikachu scream',
    });

    const results = await registry.search('pikachu scream');
    expect(results).toHaveLength(1);
    expect(results[0].card.name).toBe('Pikachu Scream Munch');
    expect(results[0].confidence).toBe(0.80);
    expect(results[0].matchReason).toContain('card registry');
  });

  it('finds card by alias', async () => {
    await registry.register({
      name: 'Pikachu Scream Munch',
      ebayItemId: 'ebay-123',
      query: 'munch pikachu',
    });

    // Search using the alias query
    const results = await registry.search('munch pikachu');
    expect(results).toHaveLength(1);
  });

  it('returns empty for non-matching query', async () => {
    await registry.register({
      name: 'Pikachu Scream Munch',
      ebayItemId: 'ebay-123',
      query: 'pikachu scream',
    });

    const results = await registry.search('charizard base set');
    expect(results).toHaveLength(0);
  });

  it('strips stopwords from search query', async () => {
    await registry.register({
      name: 'Pikachu Scream Munch',
      ebayItemId: 'ebay-123',
      query: 'pikachu scream',
    });

    // "the" and "pokemon" are stopwords, should still match
    const results = await registry.search('the pokemon pikachu scream');
    expect(results).toHaveLength(1);
  });

  it('returns empty for empty query after stopword removal', async () => {
    await registry.register({
      name: 'Pikachu Scream',
      ebayItemId: 'ebay-123',
      query: 'pikachu scream',
    });

    const results = await registry.search('the and or');
    expect(results).toHaveLength(0);
  });

  // ─── getAll() ───

  it('returns all registered cards', async () => {
    await registry.register({
      name: 'Pikachu Scream',
      ebayItemId: 'ebay-1',
      query: 'pikachu scream',
    });
    await registry.register({
      name: 'Charizard Alt Art',
      ebayItemId: 'ebay-2',
      query: 'charizard alt art',
    });

    const all = await registry.getAll();
    expect(all).toHaveLength(2);
  });

  it('returns empty array when no cards registered', async () => {
    const all = await registry.getAll();
    expect(all).toEqual([]);
  });
});
