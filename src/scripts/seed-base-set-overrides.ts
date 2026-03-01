/**
 * Seed eBay search overrides for popular Base Set cards.
 *
 * Base Set holos share card numbers with XY Evolutions (2016) and
 * Celebrations Classic Collection (2021) reprints, causing eBay searches
 * to return wrong results. This script registers exclude-keyword overrides
 * so the scanner filters out reprints automatically.
 *
 * Usage:  npx tsx src/scripts/seed-base-set-overrides.ts
 */
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { JsonStorageAdapter } from '../storage/storage-json.js';
import { CardResolver } from '../card-resolver/resolver.js';
import { EbayOverrideRegistry } from '../scanner/ebay-overrides.js';

interface BaseSetCard {
  query: string;      // Search query for PPT resolver
  number: string;     // Base Set card number
  notes: string;      // Why this override is needed
  excludeKeywords: string[];
  requiredKeywords?: string[];
}

const BASE_SET_OVERRIDES: BaseSetCard[] = [
  {
    query: 'Charizard 4/102 Base Set',
    number: '4/102',
    excludeKeywords: ['celebrations', 'classic collection', 'evolutions', 'xy'],
    notes: 'Base Set Charizard — reprinted in Celebrations Classic Collection and XY Evolutions',
  },
  {
    query: 'Blastoise 2/102 Base Set',
    number: '2/102',
    excludeKeywords: ['celebrations', 'classic collection', 'evolutions', 'xy'],
    notes: 'Base Set Blastoise — reprinted in Celebrations Classic Collection and XY Evolutions',
  },
  {
    query: 'Venusaur 15/102 Base Set',
    number: '15/102',
    excludeKeywords: ['celebrations', 'classic collection', 'evolutions', 'xy'],
    notes: 'Base Set Venusaur — reprinted in Celebrations Classic Collection and XY Evolutions',
  },
  {
    query: 'Machamp 8/102 Base Set',
    number: '8/102',
    excludeKeywords: ['evolutions', 'xy', 'legendary collection'],
    notes: 'Base Set Machamp — reprinted in XY Evolutions; 1st Edition extremely common (starter deck)',
  },
  {
    query: 'Mewtwo 10/102 Base Set',
    number: '10/102',
    excludeKeywords: ['evolutions', 'xy', 'legendary collection'],
    notes: 'Base Set Mewtwo — reprinted in XY Evolutions',
  },
  {
    query: 'Zapdos 16/102 Base Set',
    number: '16/102',
    excludeKeywords: ['evolutions', 'xy', 'legendary collection'],
    notes: 'Base Set Zapdos — reprinted in XY Evolutions',
  },
  {
    query: 'Alakazam 1/102 Base Set',
    number: '1/102',
    excludeKeywords: ['evolutions', 'xy', 'legendary collection'],
    notes: 'Base Set Alakazam — reprinted in XY Evolutions',
  },
  {
    query: 'Charmander 46/102 Base Set',
    number: '46/102',
    excludeKeywords: ['evolutions', 'xy', 'legendary collection'],
    notes: 'Base Set Charmander — reprinted in XY Evolutions',
  },
  {
    query: 'Raichu 14/102 Base Set',
    number: '14/102',
    excludeKeywords: ['evolutions', 'xy', 'legendary collection'],
    notes: 'Base Set Raichu — reprinted in XY Evolutions',
  },
  {
    query: 'Chansey 3/102 Base Set',
    number: '3/102',
    excludeKeywords: ['evolutions', 'xy', 'legendary collection'],
    notes: 'Base Set Chansey — reprinted in XY Evolutions',
  },
];

async function main() {
  const config = loadConfig();
  const storage = new JsonStorageAdapter(config.storage.jsonPath ?? './data');
  const resolver = new CardResolver(config);
  const registry = new EbayOverrideRegistry(storage);

  console.log(`Seeding ${BASE_SET_OVERRIDES.length} Base Set eBay overrides...\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of BASE_SET_OVERRIDES) {
    try {
      // Resolve to get the PPT card ID
      const result = await resolver.resolve(entry.query);
      if (!result.success || !result.bestMatch) {
        console.log(`  SKIP  ${entry.query} — could not resolve (no match)`);
        skipped++;
        continue;
      }

      const card = result.bestMatch;

      // Verify it's actually the Base Set card (not a reprint)
      if (!card.setName.toLowerCase().includes('base set') && card.setCode !== 'base1') {
        console.log(`  SKIP  ${entry.query} — resolved to "${card.setName}" (not Base Set)`);
        skipped++;
        continue;
      }

      // Check if override already exists
      const existing = await registry.get(card.id);
      if (existing) {
        console.log(`  EXISTS ${card.name} #${card.number} (id=${card.id})`);
        skipped++;
        continue;
      }

      const override = await registry.set({
        cardId: card.id,
        excludeKeywords: entry.excludeKeywords,
        requiredKeywords: entry.requiredKeywords,
        notes: entry.notes,
      });

      console.log(`  OK    ${card.name} #${card.number} (id=${card.id}) — ${override.excludeKeywords?.length ?? 0} exclude keywords`);
      created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  FAIL  ${entry.query} — ${msg}`);
      failed++;
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped, ${failed} failed`);

  // Show all registered overrides
  const all = await registry.getAll();
  if (all.length > 0) {
    console.log(`\nAll registered overrides (${all.length}):`);
    for (const o of all) {
      console.log(`  ${o.cardId}: exclude=[${o.excludeKeywords?.join(', ') ?? ''}] require=[${o.requiredKeywords?.join(', ') ?? ''}]`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
