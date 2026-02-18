import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StorageAdapter } from '../types/index.js';

export class JsonStorageAdapter implements StorageAdapter {
  private basePath: string;
  private cache: Map<string, unknown> = new Map();
  private loaded = false;
  private dataFile: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.dataFile = join(basePath, 'gacha-agent-data.json');
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.dataFile, 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(data)) {
        this.cache.set(k, v);
      }
    } catch {
      // File doesn't exist yet — start fresh
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.dataFile), { recursive: true });
    const data: Record<string, unknown> = {};
    for (const [k, v] of this.cache.entries()) {
      data[k] = v;
    }
    await writeFile(this.dataFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureLoaded();
    const val = this.cache.get(key);
    return val !== undefined ? (val as T) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.ensureLoaded();
    this.cache.set(key, value);
    await this.persist();
  }

  async delete(key: string): Promise<boolean> {
    await this.ensureLoaded();
    const existed = this.cache.has(key);
    this.cache.delete(key);
    if (existed) await this.persist();
    return existed;
  }

  async list(prefix: string): Promise<string[]> {
    await this.ensureLoaded();
    return Array.from(this.cache.keys()).filter((k) =>
      k.startsWith(prefix),
    );
  }
}
