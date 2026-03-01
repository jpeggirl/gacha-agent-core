import type { StorageAdapter, InventoryItem, ResolvedCard, Grader } from '../types/index.js';
import { parseInventoryCSV, parseGachaExportCSV } from './csv-parser.js';

const INVENTORY_PREFIX = 'inventory:';
const STOPWORDS = new Set([
  'a', 'an', 'the', 'with', 'of', 'in', 'for', 'and', 'or', 'on', 'at', 'to', 'from', 'by',
  'pokemon',
]);

export interface ImportResult {
  imported: number;
  errors: string[];
}

export class InventoryManager {
  constructor(private storage: StorageAdapter) {}

  async importFromCSV(csvContent: string): Promise<ImportResult> {
    const isGachaExport = this.detectGachaExportFormat(csvContent);
    const { items, errors } = isGachaExport
      ? parseGachaExportCSV(csvContent)
      : parseInventoryCSV(csvContent);

    for (const item of items) {
      await this.storage.set(`${INVENTORY_PREFIX}${item.id}`, item);
    }

    return { imported: items.length, errors };
  }

  private detectGachaExportFormat(csvContent: string): boolean {
    const firstLine = csvContent.split(/\r?\n/)[0]?.toLowerCase() ?? '';
    return firstLine.includes('uuid') && firstLine.includes('details');
  }

  async matchCard(card: ResolvedCard, grade?: number, grader?: Grader): Promise<InventoryItem[]> {
    const all = await this.getAll();
    const nameLower = card.name.toLowerCase();

    return all.filter((item) => {
      if (item.status !== 'available') return false;

      // Name match — check if card name appears in inventory name or vice versa
      const itemNameLower = item.name.toLowerCase();
      const nameMatch = itemNameLower.includes(nameLower) || nameLower.includes(itemNameLower);
      if (!nameMatch) return false;

      // Optional grade filter
      if (grade !== undefined && item.grade !== grade) return false;

      // Optional grader filter
      if (grader !== undefined && item.grader !== grader) return false;

      return true;
    });
  }

  async search(query: string): Promise<InventoryItem[]> {
    const all = await this.getAll();
    const terms = query.toLowerCase().split(/[\s/]+/).map((t) => t.replace(/^#/, '')).filter((t) => t && !STOPWORDS.has(t));

    return all.filter((item) => {
      if (item.status !== 'available') return false;
      const searchable = `${item.name} ${item.setName} ${item.number} ${item.variant ?? ''} ${item.grader} ${item.grade}`.toLowerCase();
      return terms.every((term) => searchable.includes(term));
    });
  }

  async getAll(): Promise<InventoryItem[]> {
    const keys = await this.storage.list(INVENTORY_PREFIX);
    const items: InventoryItem[] = [];

    for (const key of keys) {
      const item = await this.storage.get<InventoryItem>(key);
      if (item) items.push(item);
    }

    return items;
  }

  async getAvailable(): Promise<InventoryItem[]> {
    const all = await this.getAll();
    return all.filter((item) => item.status === 'available' && item.quantity > 0);
  }

  async getById(id: string): Promise<InventoryItem | null> {
    return this.storage.get<InventoryItem>(`${INVENTORY_PREFIX}${id}`);
  }
}
