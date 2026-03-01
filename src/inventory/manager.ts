import type { StorageAdapter, InventoryItem, ResolvedCard, Grader } from '../types/index.js';
import { parseInventoryCSV, parseGachaExportCSV } from './csv-parser.js';
import type { SetAliasRegistry } from '../search/set-aliases.js';
import type { ParsedQuery } from '../search/query-normalizer.js';
import { computeSKU } from '../search/sku.js';

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
  private registry?: SetAliasRegistry;

  constructor(private storage: StorageAdapter, registry?: SetAliasRegistry) {
    this.registry = registry;
  }

  async importFromCSV(csvContent: string): Promise<ImportResult> {
    const isGachaExport = this.detectGachaExportFormat(csvContent);
    const { items, errors } = isGachaExport
      ? parseGachaExportCSV(csvContent, this.registry)
      : parseInventoryCSV(csvContent, this.registry);

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

  /**
   * Three-tier inventory search:
   * Tier 1 — SKU match (exact, fast)
   * Tier 2 — Name + number match (fuzzy)
   * Tier 3 — All-terms fallback (backward compatible)
   */
  async search(query: string, parsed?: ParsedQuery): Promise<InventoryItem[]> {
    const all = await this.getAll();
    const available = all.filter((item) => item.status === 'available');

    // ─── Tier 1: SKU Match ───
    if (parsed && parsed.cardNumber && parsed.setHints.length > 0 && this.registry) {
      const setMatch = this.registry.lookup(parsed.setHints[0]!);
      if (setMatch) {
        const targetSku = computeSKU(setMatch.setCode, parsed.cardNumber);
        if (targetSku) {
          const skuMatches = available.filter((item) => item.sku === targetSku);
          if (skuMatches.length > 0) return skuMatches;
        }
      }
    }

    // ─── Tier 2: Name + Number Match ───
    if (parsed && parsed.cardName && parsed.cardNumber) {
      const nameLower = parsed.cardName.toLowerCase();
      const nameTokens = nameLower.split(/\s+/).filter(Boolean);
      const numberNormalized = parsed.cardNumber.replace(/^0+/, '') || '0';

      const nameNumberMatches = available.filter((item) => {
        const itemNameLower = item.name.toLowerCase();
        const itemNumber = item.number.split('/')[0]?.replace(/^0+/, '') || '';
        // All name tokens must appear in item name
        const nameMatch = nameTokens.every((t) => itemNameLower.includes(t));
        // Number must match (numerator comparison)
        const numberMatch = itemNumber === numberNormalized || item.number.includes(parsed.cardNumber!);
        return nameMatch && numberMatch;
      });
      if (nameNumberMatches.length > 0) return nameNumberMatches;
    }

    // ─── Tier 3: Term Fallback (original logic) ───
    const terms = query.toLowerCase().split(/[\s/]+/).map((t) => t.replace(/^#/, '')).filter((t) => t && !STOPWORDS.has(t));

    return available.filter((item) => {
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
