import { randomUUID } from 'node:crypto';
import type { StorageAdapter, InteractionLog, InteractionType } from '../types/index.js';

const MAX_ENTRIES = 50;

export class InteractionLogger {
  private storage: StorageAdapter;
  private agentId: string;
  private lastInteraction: InteractionLog | null = null;

  constructor(storage: StorageAdapter, agentId: string) {
    this.storage = storage;
    this.agentId = agentId;
  }

  private storageKey(): string {
    return `interactions:${this.agentId}`;
  }

  async log(
    type: InteractionType,
    input: unknown,
    output: unknown,
  ): Promise<InteractionLog> {
    const entry: InteractionLog = {
      id: `int_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      agentId: this.agentId,
      type,
      input,
      output,
      timestamp: new Date().toISOString(),
    };

    const entries = await this.getEntries();
    entries.push(entry);
    // Rolling buffer: keep last MAX_ENTRIES
    if (entries.length > MAX_ENTRIES) {
      entries.splice(0, entries.length - MAX_ENTRIES);
    }
    await this.storage.set(this.storageKey(), entries);

    this.lastInteraction = entry;
    return entry;
  }

  getLastInteraction(): InteractionLog | null {
    return this.lastInteraction;
  }

  async getEntries(): Promise<InteractionLog[]> {
    return (await this.storage.get<InteractionLog[]>(this.storageKey())) ?? [];
  }

  async getById(id: string): Promise<InteractionLog | null> {
    const entries = await this.getEntries();
    return entries.find((e) => e.id === id) ?? null;
  }
}
