# Coding Conventions

**Analysis Date:** 2026-02-18

## Naming Patterns

**Files:**
- Classes: PascalCase (`CardResolver`, `WatchlistManager`, `DealScorer`, `EbayScanner`)
- Module files: kebab-case when used as entry points (`card-resolver`, `deal-scorer`) or grouped as descriptive names (`storage-json.ts`)
- Test files: `{module}.test.ts` suffix (e.g., `deal-scorer.test.ts`, `manager.test.ts`)
- Types file: `index.ts` in `types/` directory

**Functions:**
- camelCase for all functions (`getFMV`, `normalizeQuery`, `buildCandidates`, `scoreMany`)
- Private methods: prefixed with underscore in private properties, but descriptive names (`_normalizeQuery`, `_buildCandidates`)
- Async methods use `async`/`await` pattern, names indicate async nature where relevant

**Variables:**
- camelCase: `accessToken`, `baseUrl`, `cacheKey`, `userId`, `targetPrice`
- Constants: SCREAMING_SNAKE_CASE (`CONFIDENCE_THRESHOLD`, `DEFAULT_WEIGHTS`, `EBAY_BROWSE_API`, `GACHA_ADMIN_KEY`)
- Private properties: prefixed with underscore (`_storage`, `_cache`, `_running`)
- Map/Set types: `sentAlerts`, `data` (for Map<string, unknown>)

**Types:**
- Interfaces: PascalCase (`ResolvedCard`, `EbayListing`, `ScoredDeal`, `StorageAdapter`)
- Type unions: kebab-case suffix (`DealSignal` = literal union type)
- Response interface types: descriptive with "Response" suffix (`ParseTitleResponse`, `EbayTokenResponse`, `TelegramResponse`)

**Example from `src/types/index.ts`:**
```typescript
export interface ResolvedCard {
  id: string;
  name: string;
  setName: string;
  setCode: string;
  number: string;
  year: number;
  rarity?: string;
  variant?: string;
  imageUrl?: string;
  confidence: number;
}

export type DealSignal = 'strong_buy' | 'buy' | 'fair' | 'overpriced' | 'avoid';

const CONFIDENCE_THRESHOLD = 0.7;
```

## Code Style

**Formatting:**
- ESLint configured but no config file in repo — uses Node.js TypeScript defaults
- No Prettier config found — manual formatting follows standard TypeScript conventions
- Line length: practical limit around 80-100 characters (observed in code)
- Semicolons: always required (TypeScript strict mode)
- Quote style: single quotes for strings, backticks for templates

**Indentation:**
- 2 spaces (observed throughout codebase)
- No tabs

**Linting:**
- ESLint run via `npm run lint` targets `src/` directory
- Uses TypeScript strict mode: `"strict": true` in `tsconfig.json`
- Forced consistent casing with `forceConsistentCasingInFileNames: true`

**Example from `src/cli.ts`:**
```typescript
function env(name: string, fallback?: string): string {
  const val = process.env[name] ?? fallback;
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}
```

## Import Organization

**Order:**
1. Built-in Node.js modules (`import 'dotenv/config'`, `import { randomUUID } from 'node:crypto'`)
2. External dependencies (none currently in main source)
3. Type imports (`import type { ... } from ...`)
4. Local module imports (relative paths with `.js` extension)

**Path Aliases:**
- No path aliases configured in tsconfig — all imports use relative paths
- Imports always include `.js` extension for ES modules: `./card-resolver/resolver.js`

**Example from `src/cli.ts`:**
```typescript
import 'dotenv/config';
import { CardResolver } from './card-resolver/resolver.js';
import { WatchlistManager } from './watchlist/manager.js';
import type { GachaAgentConfig, ResolvedCard } from './types/index.js';
import { DEFAULT_SCHEDULER_CONFIG } from './types/index.js';
```

**Example type-only imports from `src/scanner/deal-scorer.ts`:**
```typescript
import type {
  EbayListing,
  ResolvedCard,
  FairMarketValue,
  ScoredDeal,
  DealSignal,
} from '../types/index.js';
```

## Error Handling

**Patterns:**
- Try-catch blocks capture errors as `error instanceof Error` to safely extract messages
- Graceful fallbacks: errors in optional operations return `null` instead of throwing
- Fatal errors: process.exit(1) for CLI entry points on missing config
- External API errors: wrap in descriptive Error messages with context

**Example from `src/card-resolver/resolver.ts`:**
```typescript
try {
  const response = await this.callParseTitle(normalized);
  const candidates = this.buildCandidates(response, query);
  // ...
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return {
    success: false,
    candidates: [],
    originalQuery: query,
    needsDisambiguation: false,
  };
}
```

**Example from `src/pricing/engine.ts`:**
```typescript
const promises = grades.map(async (grade) => {
  try {
    const fmv = await this.getFMV(card, grade);
    results.set(grade, fmv);
  } catch {
    // Skip grades that fail — may not have pricing data
  }
});
```

**Example from `src/watchlist/storage-json.ts`:**
```typescript
private async ensureLoaded(): Promise<void> {
  if (this.loaded) return;
  try {
    const raw = await readFile(this.dataFile, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    // ...
  } catch {
    // File doesn't exist yet — start fresh
  }
  this.loaded = true;
}
```

## Logging

**Framework:** `console` (no logging library)

**Patterns:**
- `console.log()` for informational messages (status, progress)
- `console.error()` for error conditions (config missing, failures)
- Contextual prefixes in brackets: `[Scheduler]`, `[Scheduler]` indicates which module
- ISO 8601 timestamps embedded in stored objects, not in logs

**Example from `src/scheduler/scan-scheduler.ts`:**
```typescript
console.log(
  `[Scheduler] Started — scanning every ${this.config.scanIntervalMs / 1000}s`,
);
console.log('[Scheduler] No active watchlist entries');
console.error('eBay credentials required. Set EBAY_APP_ID and EBAY_CERT_ID.');
```

**Example from `src/cli.ts`:**
```typescript
console.log(`Resolving: "${query}"...`);
console.error('Usage: gacha resolve <card description>');
process.exit(1);
```

## Comments

**When to Comment:**
- Explain *why* not *what* — code should be self-documenting for the "what"
- Comment non-obvious algorithm decisions
- Comment integration points with external APIs
- Mark sections with visual separators for major sections

**JSDoc/TSDoc:**
- Not consistently used in codebase
- Type annotations via TypeScript interfaces provide most documentation
- Complex functions may benefit from JSDoc but not required

**Example from `src/types/index.ts` (visual separators):**
```typescript
// ─── Card Identity Types ───

export interface ResolvedCard {
  // ...
}

// ─── Watchlist Types ───

export interface WatchlistEntry {
  // ...
}
```

**Example from `src/card-resolver/resolver.ts` (explanatory comments):**
```typescript
// "Charizard ex" should prefer Charizard variants over unrelated suffixes.
if (queryVariant) {
  if (candidateVariant === queryVariant) {
    adjustment += 0.2;
  } else if (candidateVariant && candidateVariant !== queryVariant) {
    adjustment -= 0.25;
  }
}
```

**Example from `src/pricing/engine.ts` (why, not what):**
```typescript
// Use median as FMV — more resistant to outliers than mean
const fmv: FairMarketValue = {
  cardId: card.id,
  grade,
  fmv: d.median,
  // ...
};
```

## Function Design

**Size:** Keep functions focused on single responsibility. Observed functions range 10-40 lines for utility methods, up to 100 lines for orchestration/scanning logic.

**Parameters:**
- Use objects for multiple parameters (3+) instead of positional args
- Make optional parameters explicit with `?:` in interfaces
- Type all parameters explicitly

**Example from `src/scanner/deal-scorer.ts` (single responsibility):**
```typescript
private scorePriceVsFmv(totalPrice: number, fmvPrice: number): number {
  if (fmvPrice <= 0) return 50;
  const ratio = totalPrice / fmvPrice;
  if (ratio <= 0.5) return 100;
  if (ratio <= 1.0) return 100 - (ratio - 0.5) * 100;
  if (ratio <= 1.5) return 50 - (ratio - 1.0) * 100;
  return 0;
}
```

**Return Values:**
- Async functions return specific types or null on not-found
- Results wrapped in result objects for operations that may fail: `{ success: boolean, data?, error? }`
- Use null to indicate absence, undefined for unset optional fields

**Example from `src/watchlist/manager.ts`:**
```typescript
async get(id: string): Promise<WatchlistEntry | null> {
  return this.storage.get<WatchlistEntry>(this.key(id));
}

async update(
  id: string,
  updates: Partial<Pick<WatchlistEntry, 'targetPrice' | 'alertChannels' | 'active'>>,
): Promise<WatchlistEntry | null> {
  const entry = await this.get(id);
  if (!entry) return null;
  // ...
}
```

## Module Design

**Exports:**
- Default exports: none (use named exports only)
- Export classes and types together: `export class ClassName` and `export interface InterfaceName`
- Index files re-export for public API: `src/index.ts` exports all public classes and types

**Barrel Files:**
- Central barrel: `src/types/index.ts` contains all type definitions
- No nested barrel files — imports use relative paths directly to modules

**Example from `src/index.ts` (public API):**
```typescript
export type {
  ResolvedCard,
  CardCandidate,
  ResolveResult,
  WatchlistEntry,
  // ... all types
} from './types/index.js';

export { CardResolver } from './card-resolver/resolver.js';
export { WatchlistManager } from './watchlist/manager.js';
export { PriceEngine } from './pricing/engine.js';
```

**Class Pattern (encapsulation with private state):**
```typescript
export class DealScorer {
  private weights: ScoringWeights;

  constructor(weights?: Partial<ScoringWeights>) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  score(...): ScoredDeal {
    // public method
  }

  private scorePriceVsFmv(...): number {
    // private method
  }
}
```

---

*Convention analysis: 2026-02-18*
