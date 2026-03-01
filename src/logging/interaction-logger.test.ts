import { describe, it, expect, beforeEach } from 'vitest';
import { InteractionLogger } from './interaction-logger.js';
import { InMemoryStorage } from '../mocks/in-memory-storage.js';

// ─── Tests ───

describe('InteractionLogger', () => {
  let storage: InMemoryStorage;
  let logger: InteractionLogger;

  beforeEach(() => {
    storage = new InMemoryStorage();
    logger = new InteractionLogger(storage, 'test-agent');
  });

  it('logs an interaction and returns it with correct fields', async () => {
    const entry = await logger.log('resolve', 'pikachu base set', { name: 'Pikachu' });

    expect(entry.id).toMatch(/^int_/);
    expect(entry.agentId).toBe('test-agent');
    expect(entry.type).toBe('resolve');
    expect(entry.input).toBe('pikachu base set');
    expect(entry.output).toEqual({ name: 'Pikachu' });
    expect(entry.timestamp).toBeTruthy();
  });

  it('getLastInteraction returns the most recently logged entry', async () => {
    expect(logger.getLastInteraction()).toBeNull();

    await logger.log('resolve', 'query1', 'result1');
    await logger.log('price', 'query2', 'result2');

    const last = logger.getLastInteraction();
    expect(last).not.toBeNull();
    expect(last!.type).toBe('price');
    expect(last!.input).toBe('query2');
  });

  it('getEntries returns all logged entries', async () => {
    await logger.log('resolve', 'q1', 'r1');
    await logger.log('price', 'q2', 'r2');
    await logger.log('scan', 'q3', 'r3');

    const entries = await logger.getEntries();
    expect(entries).toHaveLength(3);
    expect(entries[0]!.type).toBe('resolve');
    expect(entries[2]!.type).toBe('scan');
  });

  it('getById retrieves a specific entry', async () => {
    const entry = await logger.log('resolve', 'pikachu', 'found');
    const found = await logger.getById(entry.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(entry.id);
    expect(found!.input).toBe('pikachu');
  });

  it('getById returns null for unknown ID', async () => {
    const found = await logger.getById('int_doesnotexist');
    expect(found).toBeNull();
  });

  it('rolling buffer keeps only last 50 entries', async () => {
    for (let i = 0; i < 60; i++) {
      await logger.log('resolve', `query-${i}`, `result-${i}`);
    }

    const entries = await logger.getEntries();
    expect(entries).toHaveLength(50);
    // First entry should be query-10 (oldest 10 were trimmed)
    expect(entries[0]!.input).toBe('query-10');
    expect(entries[49]!.input).toBe('query-59');
  });

  it('persists entries across logger instances with same storage', async () => {
    await logger.log('resolve', 'query1', 'result1');

    const logger2 = new InteractionLogger(storage, 'test-agent');
    const entries = await logger2.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.input).toBe('query1');
  });

  it('different agentIds have isolated entries', async () => {
    const loggerA = new InteractionLogger(storage, 'agent-a');
    const loggerB = new InteractionLogger(storage, 'agent-b');

    await loggerA.log('resolve', 'queryA', 'resultA');
    await loggerB.log('price', 'queryB', 'resultB');

    const entriesA = await loggerA.getEntries();
    const entriesB = await loggerB.getEntries();

    expect(entriesA).toHaveLength(1);
    expect(entriesA[0]!.input).toBe('queryA');
    expect(entriesB).toHaveLength(1);
    expect(entriesB[0]!.input).toBe('queryB');
  });
});
