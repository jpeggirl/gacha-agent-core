# Testing Patterns

**Analysis Date:** 2026-02-18

## Test Framework

**Runner:**
- Vitest v1.2.0
- Config: `vitest.config.ts`
- Native ESM support with TypeScript

**Assertion Library:**
- Vitest's built-in expect (alias to Chai)

**Run Commands:**
```bash
npm run test              # Run all tests (vitest run)
npm run test:watch       # Watch mode (vitest)
npm run build            # TypeScript compilation (required before tests)
```

**Config Details from `vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

## Test File Organization

**Location:** Co-located with source
- Test files live in same directory as source: `src/scanner/deal-scorer.test.ts` alongside `src/scanner/deal-scorer.ts`
- Pattern allows easy navigation and shared dependencies

**Naming:** `{module}.test.ts` suffix
- `src/scanner/deal-scorer.test.ts`
- `src/watchlist/manager.test.ts`

**Coverage Status:**
- Only 2 test suites present in codebase
- `deal-scorer.test.ts` and `manager.test.ts`
- Large areas untested (resolver, scanner, scheduler, server)

## Test Structure

**Suite Organization (from `src/watchlist/manager.test.ts`):**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { WatchlistManager } from './manager.js';
import type { StorageAdapter, ResolvedCard } from '../types/index.js';

// Test data/fixtures defined at top level
const testCard: ResolvedCard = {
  id: 'base1-4',
  name: 'Charizard',
  // ...
};

describe('WatchlistManager', () => {
  let manager: WatchlistManager;

  beforeEach(() => {
    manager = new WatchlistManager(new InMemoryStorage());
  });

  it('adds an entry and retrieves it', async () => {
    const entry = await manager.add({...});
    expect(entry.id).toBeTruthy();
    expect(entry.card.name).toBe('Charizard');
  });

  it('lists entries by user', async () => {
    // ...
  });
});
```

**Patterns:**
- `describe()` wraps test suite for a single class/module
- `beforeEach()` resets state before each test
- `it()` for each test case with descriptive name
- Helper functions (like `makeListing()`) defined before test suite

**Helper Pattern from `src/scanner/deal-scorer.test.ts`:**
```typescript
function makeListing(overrides: Partial<EbayListing> = {}): EbayListing {
  return {
    itemId: 'test-1',
    title: 'Charizard Base Set 1st Edition PSA 9',
    price: 4000,
    currency: 'USD',
    shippingCost: 0,
    totalPrice: 4000,
    listingType: 'BuyItNow',
    sellerUsername: 'topcardseller',
    sellerFeedbackScore: 5000,
    sellerFeedbackPercent: 99.8,
    itemUrl: 'https://ebay.com/itm/test-1',
    ...overrides,
  };
}
```

## Mocking

**Framework:** Vitest's built-in mocking (vi module)
- NOT heavily used in current test suite
- No mock libraries imported (no Sinon, Jest mocks, etc.)

**Pattern: Test Doubles (Manual)**
- Use real implementations when possible
- Create simple test doubles for interfaces

**Example from `src/watchlist/manager.test.ts` (manual test double):**
```typescript
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
```

**What to Mock:**
- External dependencies (not yet done — see coverage gaps)
- API responses in tests for modules that call external APIs
- Storage backends when testing managers

**What NOT to Mock:**
- Domain logic (CardResolver, DealScorer calculation)
- Core algorithms
- Type definitions

## Fixtures and Factories

**Test Data:**
- Defined at module level before test suite
- Static objects for common test cards and listings

**Card Fixture from `src/scanner/deal-scorer.test.ts`:**
```typescript
const card: ResolvedCard = {
  id: 'base1-4',
  name: 'Charizard',
  setName: 'Base Set',
  setCode: 'base1',
  number: '4',
  year: 1999,
  rarity: 'Rare Holo',
  variant: '1st Edition',
  confidence: 0.95,
};

const fmv: FairMarketValue = {
  cardId: 'base1-4',
  grade: 9,
  fmv: 5000,
  currency: 'USD',
  prices: [],
  lastUpdated: new Date().toISOString(),
  populationCount: 150,
};
```

**Factory Function:**
```typescript
function makeListing(overrides: Partial<EbayListing> = {}): EbayListing {
  return {
    itemId: 'test-1',
    title: 'Charizard Base Set 1st Edition PSA 9',
    // ... defaults
    ...overrides,  // Allow customization per test
  };
}
```

**Location:** Defined directly in test file, no separate fixtures directory

## Coverage

**Requirements:** Not enforced — no coverage threshold configured

**View Coverage:** Not configured
- Run `vitest run --coverage` if coverage tools installed (not present in devDependencies)

**Current Status:** Low coverage
- Only 2 test files: `deal-scorer.test.ts`, `manager.test.ts`
- No tests for: CardResolver, EbayScanner, PriceEngine, ScanScheduler, CLI, Server
- Estimated <20% coverage overall

## Test Types

**Unit Tests:**
- Scope: Individual class methods
- Approach: Test in isolation with mocked dependencies
- Examples:
  - `DealScorer.score()` with various listing/FMV combinations
  - `WatchlistManager.add()`, `.update()`, `.listByUser()`

**Integration Tests:**
- Not yet implemented in repo
- Would test: Manager + Storage interaction, Scheduler + all components

**E2E Tests:**
- Framework: Not used
- Could be added for CLI commands and server endpoints

## Common Patterns

**Async Testing:**
```typescript
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
```

**Parameterized Tests (multiple cases same scenario):**
```typescript
it('prefers BuyItNow over Auction', () => {
  const binDeal = scorer.score(
    makeListing({ listingType: 'BuyItNow', totalPrice: 4500 }),
    card,
    fmv,
  );
  const auctionDeal = scorer.score(
    makeListing({ listingType: 'Auction', totalPrice: 4500 }),
    card,
    fmv,
  );
  expect(binDeal.score).toBeGreaterThan(auctionDeal.score);
});
```

**Assertion Patterns:**
```typescript
// Equality
expect(entry.card.name).toBe('Charizard');
expect(entry).toEqual(entry);

// Numeric comparisons
expect(deal.score).toBeGreaterThanOrEqual(70);
expect(deal.score).toBeLessThan(50);
expect(deal.savingsAmount).toBeGreaterThan(0);

// Truthiness
expect(entry.id).toBeTruthy();
expect(deal.reasoning).toBeTruthy();

// Presence/length
expect(entries).toHaveLength(2);
expect(results[0]!.listing.itemId).toBe('2');
```

**Error Testing:**
- Not yet implemented in test suite
- Pattern would use `.rejects` for async throws: `await expect(fn()).rejects.toThrow()`

**Benchmarking:**
- Not used
- Would use vitest bench() if performance regressions needed tracking

---

*Testing analysis: 2026-02-18*
