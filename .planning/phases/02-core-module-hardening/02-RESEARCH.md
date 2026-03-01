# Phase 2: Core Module Hardening - Research

**Researched:** 2026-02-18
**Domain:** TypeScript module hardening — confidence gating, error handling, persistent state, Telegram rate limiting, API mocking in tests
**Confidence:** HIGH (architecture patterns), MEDIUM (Telegram throttler specifics, eBay aspect filter values), LOW (PokemonPriceTracker API response shape beyond what code already handles)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CARD-01 | User can resolve a card from natural language description to a canonical card identity | CardResolver already calls `/api/v2/parse-title`. Phase 2 hardens error path (catch block currently swallows errors silently) and verifies the resolve → bestMatch path works end-to-end. |
| CARD-02 | Card resolver handles ambiguous queries by returning ranked candidates with confidence scores | Already implemented — `buildCandidates()` sorts by confidence descending. Phase 2 adds tests to verify this path. |
| CARD-03 | Card resolver surfaces disambiguation options when confidence is below threshold | Currently uses a single 0.70 threshold. Phase 2 changes to two-tier gate: ≥0.85 auto-proceed, 0.70–0.84 return `needsDisambiguation: true` (already the output field), <0.70 return no match. The `ResolveResult` type already supports this — only `CONFIDENCE_THRESHOLD` constant and gating logic changes. |
| PRICE-01 | User can get FMV for any graded Pokémon card from PokemonPriceTracker | `PriceEngine.getFMV()` already implements this. Phase 2 hardens the error path — currently throws on API failure, blocking the scheduler. Fix: return `null` and let callers handle gracefully. |
| PRICE-02 | FMV results are cached (30-min TTL) to avoid redundant API calls | Already implemented with in-memory Map. Phase 2 verifies via tests. |
| PRICE-03 | FMV lookup returns population count alongside price data | Already present in `FairMarketValue.populationCount`. Phase 2 surfaces `prices.length` to the scorer for thin-market downgrade (see prior decisions). |
| SCORE-01 | Each eBay listing is scored (0-100) against FMV using weighted algorithm | Already implemented in `DealScorer`. Phase 2 adds thin-market signal downgrade when `fmv.prices.length < 5`. |
| SCORE-02 | Each listing receives a signal classification (strong_buy, buy, fair, overpriced, avoid) | Already implemented — `deriveSignal()` method. Phase 2 verifies via tests. |
| SCORE-03 | Seller quality filter excludes sellers with <95% feedback from positive signals | Already implemented — hard filter in `deriveSignal()`. Phase 2 ensures tests cover the boundary. |
| SCORE-04 | Deal score includes human-readable reasoning text explaining the signal | Already implemented — `buildReasoning()` method. Phase 2 verifies coverage and adds thin-market case to reasoning. |
| SCAN-01 | Agent scans eBay Browse API for listings matching a resolved card | `EbayScanner.scan()` already calls Browse API. Phase 2 hardens error handling: currently throws on non-200, blocking the scheduler. Fix: catch at scheduler boundary and continue. |
| SCAN-02 | Scanner builds optimized search queries from card name, set, variant, and grade | `buildSearchQuery()` already does this. Phase 2 verifies via tests that queries are well-formed. |
| SCAN-03 | Scan scheduler processes active watchlist entries on configurable interval (default 15 min) | `ScanScheduler` already implements this. Phase 2 verifies via unit tests with fake timers. |
| SCAN-04 | Scheduler prioritizes entries by last scan time (oldest first) with batch concurrency limits | `prioritize()` already sorts correctly. Phase 2 tests this sort order. |
| SCAN-05 | Scheduler respects daily API rate limits (eBay 5000/day, pricing 100/day) | Counter logic in `runOnce()` already present. Phase 2 hardens: persist daily counter to storage so it survives restart; verify counter reset on new UTC day. |
| WATCH-01 | User can add a card to watchlist with target price and grade | `WatchlistManager.add()` implemented. Phase 2 adds explicit `grade` field to `WatchlistEntry` (currently buried in `metadata`). |
| WATCH-02 | User can remove cards from watchlist | `WatchlistManager.remove()` implemented. Tests exist. Phase 2 covers edge case: remove from user index atomically. |
| WATCH-03 | User can list all active watchlist entries | `WatchlistManager.listActive()` implemented. Tests exist. |
| WATCH-04 | Watchlist entries support grade-specific targeting | Phase 2 adds explicit `grade?: number` field to `WatchlistEntry` type (replacing `metadata.grade` cast). Existing JSON data backward-compatible since field is optional. |
| WATCH-05 | Watchlist persists across process restarts via StorageAdapter | `JsonStorageAdapter` already persists to disk. Phase 2 adds restart integration test using the real file adapter on a temp directory. |
| ALERT-01 | Agent sends formatted deal alerts to Telegram with card info, listing price vs FMV, deal score, and reasoning | `TelegramAlerts.sendDealAlert()` formats and sends. Phase 2 replaces raw `fetch` with grammy's `Bot.api.sendMessage()` (already installed), adds throttler plugin. |
| ALERT-03 | Alert deduplication persists across process restarts | Currently `sentAlerts` is an in-memory `Set` — lost on restart. Fix: persist `sentAlertKeys` to `StorageAdapter`. This is the primary new logic for Phase 2 alerts. |
| ALERT-04 | Alerts respect Telegram rate limits to avoid bot throttling | Phase 2 integrates `@grammyjs/transformer-throttler` to queue outgoing messages and prevent 429 errors. |
</phase_requirements>

---

## Summary

Phase 2 is a hardening phase: the scaffolding exists for all 23 requirements, but critical production gaps remain. The existing modules share three categories of problems that must be fixed as a unit:

**Persistence gaps:** `TelegramAlerts.sentAlerts` and `ScanScheduler.sentAlertKeys` are in-memory Sets that vanish on restart. `ScanScheduler`'s daily API counters are also in-memory. The fix in all cases is the same: use the already-present `StorageAdapter` (backed by `JsonStorageAdapter`) to persist these keys. No new library is needed — just use the existing interface.

**Error handling gaps:** `PriceEngine.getFMV()` throws on API failure, which propagates up and stops the entire scheduler loop. `CardResolver.resolve()` silently catches all errors and returns `success: false` with no indication of why. The fix is consistent: differentiate between "no match" and "API error" at the boundary, log the error, and allow the scheduler to continue to the next entry.

**Confidence gating:** The card resolver uses a single 0.70 threshold. Prior decisions mandate a two-tier gate: ≥0.85 auto-proceed, 0.70–0.84 set `needsDisambiguation: true`, <0.70 return no match. This is a single constant and a logic change in `resolver.ts` — the `ResolveResult` type already has the `needsDisambiguation` field.

The Telegram rate-limiting problem is solved by `@grammyjs/transformer-throttler` (a grammY plugin). The test coverage gaps are addressed with MSW (Mock Service Worker) for HTTP-level mocking, enabling tests of `CardResolver`, `PriceEngine`, and `EbayScanner` without live network calls.

**Primary recommendation:** Fix the three persistence gaps first (sentAlerts, sentAlertKeys, daily counters), then harden error boundaries, then adjust the confidence gate, then add the throttler, then add tests for all of the above. No new database or storage backend is needed.

---

## Standard Stack

### Core (already installed — no new installs except throttler and MSW)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `grammy` | `^1.40.0` (installed) | Telegram Bot API framework | Already installed; Phase 2 actually uses it to replace the hand-rolled `fetch` calls in `telegram.ts` |
| `@grammyjs/transformer-throttler` | `^1.x` | Outgoing API call rate limiting | Queues sends via Bottleneck; prevents Telegram 429 errors during burst sends; official grammY plugin |
| `msw` | `^2.x` | HTTP-level mock in tests | Intercepts `fetch` at network level; works with Vitest in Node.js via `setupServer`; no code changes needed in production modules |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `write-file-atomic` | `^6.x` | Atomic JSON writes | Optional upgrade to `JsonStorageAdapter.persist()` — prevents half-written files on crash. Not strictly required since Node.js `rename()` is already atomic on POSIX. Only add if atomic writes become a reliability concern. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@grammyjs/transformer-throttler` | Manual `setTimeout` delays in `TelegramAlerts` | Throttler handles per-chat and global limits automatically; manual delays require tracking queues across calls — reinventing what Bottleneck already does |
| `msw` for test mocking | `vi.fn()` on `global.fetch` | `vi.fn()` mocks are simpler but couple tests to internal fetch call signatures; MSW intercepts at the network level and is more realistic; MSW is the officially recommended approach in Vitest docs |
| In-memory `Set` for dedup | SQLite or Redis | Overkill for single-user, single-process agent; `JsonStorageAdapter` is already present and handles persistence correctly |

**Installation (new packages only):**
```bash
npm install @grammyjs/transformer-throttler
npm install --save-dev msw
```

---

## Architecture Patterns

### Recommended Project Structure

No structural changes. Phase 2 adds test files alongside existing modules:

```
src/
├── alerts/
│   ├── telegram.ts          # MODIFY: use grammy Bot; add throttler; persist dedup keys
│   └── telegram.test.ts     # ADD: tests with MSW
├── card-resolver/
│   ├── resolver.ts          # MODIFY: two-tier confidence gate; improve error surfacing
│   └── resolver.test.ts     # ADD: tests with MSW
├── pricing/
│   ├── engine.ts            # MODIFY: return null on failure instead of throwing; surface prices.length
│   └── engine.test.ts       # ADD: tests with MSW
├── scanner/
│   ├── ebay.ts              # MODIFY: harden error path
│   ├── ebay.test.ts         # ADD: tests with MSW
│   ├── deal-scorer.ts       # MODIFY: thin-market downgrade when prices.length < 5
│   └── deal-scorer.test.ts  # ALREADY EXISTS: extend for new cases
├── scheduler/
│   ├── scan-scheduler.ts    # MODIFY: persist sentAlertKeys + daily counters; handle null FMV
│   └── scan-scheduler.test.ts # ADD: tests with fake timers + InMemoryStorage
├── watchlist/
│   ├── manager.ts           # NO CHANGE needed (already works correctly)
│   ├── manager.test.ts      # ALREADY EXISTS: add grade-specific entry test
│   ├── storage-json.ts      # NO CHANGE (optional: add atomic write)
│   └── storage-json.test.ts # ADD: restart persistence integration test
└── types/
    └── index.ts             # MODIFY: add explicit grade field to WatchlistEntry
```

### Pattern 1: Two-Tier Confidence Gate

**What:** Replace the single `CONFIDENCE_THRESHOLD = 0.7` with two thresholds. Confidence ≥ 0.85 auto-proceeds; 0.70–0.84 sets `needsDisambiguation: true`; <0.70 returns no match.
**When to use:** Card resolution only. This is the only module with a confidence score.
**Example:**
```typescript
// src/card-resolver/resolver.ts
const AUTO_PROCEED_THRESHOLD = 0.85;    // was: CONFIDENCE_THRESHOLD = 0.7
const DISAMBIGUATE_THRESHOLD = 0.70;

// In resolve():
const bestMatch = candidates[0]?.card;
const confidence = bestMatch?.confidence ?? 0;

const needsDisambiguation =
  !bestMatch ||
  (confidence >= DISAMBIGUATE_THRESHOLD && confidence < AUTO_PROCEED_THRESHOLD);

return {
  success: confidence >= AUTO_PROCEED_THRESHOLD && !!bestMatch,
  bestMatch: confidence >= AUTO_PROCEED_THRESHOLD ? bestMatch : undefined,
  candidates,
  originalQuery: query,
  needsDisambiguation,
  disambiguationReason:
    needsDisambiguation
      ? `Confidence ${Math.round(confidence * 100)}% — below auto-proceed threshold`
      : undefined,
};
```

### Pattern 2: Persistent Dedup Store via StorageAdapter

**What:** Load dedup keys from storage on init; write back on each new key added. The `StorageAdapter` interface already supports `get`, `set`, `delete`, `list`.
**When to use:** `TelegramAlerts.sentAlerts` and `ScanScheduler.sentAlertKeys` — both need restart persistence.
**Example:**
```typescript
// StorageAdapter-backed dedup — no new library
const SENT_ALERTS_KEY = 'alerts:sent-keys';

// On init (constructor or lazy-load):
const sentKeys = await this.storage.get<string[]>(SENT_ALERTS_KEY) ?? [];
this.sentAlerts = new Set(sentKeys);

// On send:
this.sentAlerts.add(dedupeKey);
await this.storage.set(SENT_ALERTS_KEY, Array.from(this.sentAlerts));
```

**Important:** `TelegramAlerts` currently has no `StorageAdapter` dependency. Phase 2 must either inject one or move dedup responsibility to `ScanScheduler` (which already has storage access via `WatchlistManager`). The cleaner approach is to move dedup to the scheduler since `TelegramAlerts` is otherwise stateless. `ScanScheduler.sentAlertKeys` already exists — just persist it.

### Pattern 3: Null-Return Error Boundary for PriceEngine

**What:** Replace throw-on-failure with null return in `getFMV()`. Callers (scheduler) check for null and skip FMV-dependent steps.
**When to use:** Any module called inside the scheduler loop where failure should not block other entries.
**Example:**
```typescript
// src/pricing/engine.ts
async getFMV(card: ResolvedCard, grade: number): Promise<FairMarketValue | null> {
  const cacheKey = `${card.id}:${grade}`;
  const cached = this.cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const response = await this.fetchPsaPricing(card.id, grade);
    if (!response.success || !response.data) {
      console.error(`[PriceEngine] No data for ${card.name} PSA ${grade}: ${response.error ?? 'Unknown'}`);
      return null;
    }
    // ... build fmv, cache it, return it
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PriceEngine] API error for ${card.name} PSA ${grade}: ${msg}`);
    return null;
  }
}

// In scheduler (scanEntry):
const fmv = await this.priceEngine.getFMV(entry.card, grade);
if (!fmv) {
  console.warn(`[Scheduler] Could not get FMV for ${entry.card.name} — skipping scoring`);
  await this.watchlist.markScanned(entry.id);
  return;
}
```

### Pattern 4: Thin-Market Signal Downgrade

**What:** When `fmv.prices.length < 5`, downgrade strong_buy/buy signals by one level and add a warning to reasoning.
**When to use:** `DealScorer.deriveSignal()` — after computing score but before returning.
**Example:**
```typescript
// src/scanner/deal-scorer.ts
private deriveSignal(score: number, listing: EbayListing, fmv: FairMarketValue): DealSignal {
  if (listing.sellerFeedbackPercent < 95) return 'avoid';
  if (listing.sellerFeedbackScore < 10) return 'avoid';

  let signal: DealSignal;
  if (score >= 80) signal = 'strong_buy';
  else if (score >= 65) signal = 'buy';
  else if (score >= 45) signal = 'fair';
  else if (score >= 25) signal = 'overpriced';
  else signal = 'avoid';

  // Thin market downgrade: < 5 price data points = unreliable FMV
  if (fmv.prices.length < 5) {
    if (signal === 'strong_buy') signal = 'buy';
    else if (signal === 'buy') signal = 'fair';
  }

  return signal;
}
```
Note: `fmv.prices` is the `PricePoint[]` array already present on `FairMarketValue`. No type change needed.

### Pattern 5: Telegram Rate Limiting with transformer-throttler

**What:** Wrap the grammy `Bot` instance with the throttler transformer. All `bot.api.sendMessage()` calls are automatically queued to respect Telegram limits.
**When to use:** Any time the bot sends outgoing messages — including deal alerts sent outside a polling context.
**Example:**
```typescript
// src/alerts/telegram.ts
import { Bot } from 'grammy';
import { apiThrottler } from '@grammyjs/transformer-throttler';

export class TelegramAlerts {
  private bot: Bot;

  constructor(config: GachaAgentConfig) {
    this.bot = new Bot(config.telegram!.botToken);
    this.bot.api.config.use(apiThrottler()); // default config handles Telegram limits
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    await this.bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
    // Throttler queues this automatically — no 429 errors
  }
}
```
**Note on `disable_web_page_preview`:** This option was deprecated in Telegram Bot API (layer 167+). The replacement is `link_preview_options: { is_disabled: true }`. Grammy v1.x supports the new field — update when migrating to grammy API calls.

### Pattern 6: MSW for HTTP Mocking in Vitest

**What:** Use Mock Service Worker to intercept all `fetch` calls to external APIs in tests. No changes to production code.
**When to use:** Any test for `CardResolver`, `PriceEngine`, `EbayScanner`, or `TelegramAlerts`.
**Example:**
```typescript
// src/mocks/server.ts
import { setupServer } from 'msw/node';
export const server = setupServer(); // handlers added per-test

// vitest.setup.ts
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './src/mocks/server';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// In a test file:
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

it('returns null when PokemonPriceTracker is down', async () => {
  server.use(
    http.get('https://www.pokemonpricetracker.com/api/psa/pricing/*', () =>
      HttpResponse.json({ success: false, error: 'Service unavailable' }, { status: 503 })
    )
  );
  const engine = new PriceEngine(testConfig);
  const result = await engine.getFMV(testCard, 10);
  expect(result).toBeNull();
});
```
**vitest.config.ts update required:**
```typescript
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'], // ADD THIS
  },
});
```

### Pattern 7: WatchlistEntry Grade Field Addition

**What:** Add explicit `grade?: number` field to `WatchlistEntry` interface. Read from `grade` first, fall back to `metadata?.grade` for backward compatibility.
**When to use:** `WatchlistManager.add()` input and all scheduler consumers.
**Example:**
```typescript
// src/types/index.ts
export interface WatchlistEntry {
  // ... existing fields
  grade?: number;        // ADD: explicit grade field (replaces metadata.grade)
  metadata?: Record<string, unknown>;
}

export interface CreateWatchlistInput {
  // ... existing fields
  grade?: number;        // ADD: explicit grade in input
}

// src/scheduler/scan-scheduler.ts
// CHANGE: was (entry.metadata?.grade as number) ?? 9
const grade = entry.grade ?? (entry.metadata?.grade as number | undefined) ?? 9;
```

### Anti-Patterns to Avoid

- **Removing `metadata` field from `WatchlistEntry`:** Existing persisted JSON data may have `metadata.grade`. Keep `metadata` and fall back to it for existing entries. Only new entries use the explicit `grade` field.
- **Throwing in `scanEntry()` without catching:** The scheduler's `scanEntry()` already wraps in try/catch, but callers of `getFMV()` and `scan()` still let errors propagate to it. Catch at each call site for better logging context.
- **Storing sentAlerts in `TelegramAlerts` constructor directly from storage:** `TelegramAlerts.constructor()` is currently synchronous. Adding async storage reads requires either a factory pattern (`static async create()`) or lazy-loading on first send. Lazy-loading is simpler.
- **Using grammy `Bot` polling in `TelegramAlerts`:** Phase 2 only needs outgoing message sending (no incoming webhook/polling). Use `bot.api.sendMessage()` directly — do not call `bot.start()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Telegram API rate limit queue | Manual `setTimeout` delay loop in `TelegramAlerts` | `@grammyjs/transformer-throttler` | Handles global (30/sec), group, and per-chat (1/sec) limits independently; uses Bottleneck internally; auto-retries on 429 |
| HTTP mocking in tests | `vi.fn(() => Promise.resolve(...))` on `global.fetch` | `msw` 2.x with `setupServer` | MSW intercepts at network level, supports request matching by URL pattern, simulates real HTTP error codes, recommended by Vitest docs |
| Custom atomic file write | `fs.writeFile()` directly | Either existing code (already correct) or `write-file-atomic` if paranoid about power loss | POSIX `rename()` used internally by atomic-write libraries is already atomic; existing `JsonStorageAdapter.persist()` is safe for this use case |

**Key insight:** The dedup persistence problem sounds complex but the existing `StorageAdapter` already solves it. Moving `sentAlertKeys` from an in-memory `Set` to a storage-backed `Set` (with lazy load on first use) is <20 lines of code in `scan-scheduler.ts`.

---

## Common Pitfalls

### Pitfall 1: Confidence Threshold Change Breaks Existing Callers

**What goes wrong:** Changing `CONFIDENCE_THRESHOLD = 0.7` to the two-tier system changes the meaning of `success: true` and `bestMatch` for all callers. The CLI (`src/cli.ts`) and server (`src/server.ts`) both consume `ResolveResult` — they must be updated to handle `needsDisambiguation: true` as a distinct case (not an error).
**Why it happens:** The type `ResolveResult` already has `needsDisambiguation: boolean`, but callers may not check it before using `bestMatch`.
**How to avoid:** Search all callers of `resolver.resolve()` and update handling — treat `needsDisambiguation: true` as a "prompt user for clarification" outcome, not a failure.
**Warning signs:** `bestMatch` is `undefined` but `candidates` is non-empty and `success` is `false` — this means disambiguation is needed.

### Pitfall 2: PriceEngine Return Type Change Breaks TypeScript Callers

**What goes wrong:** Changing `getFMV()` from `Promise<FairMarketValue>` to `Promise<FairMarketValue | null>` will cause TypeScript errors in every caller that assumes non-null return.
**Why it happens:** The scheduler calls `getFMV()` and immediately uses the result without null checking.
**How to avoid:** Fix `getFMV()` return type first, then let `tsc --noEmit` identify every caller that needs null handling. This is the safe sequence: type change → typecheck → fix callers.
**Warning signs:** `npm run typecheck` will fail with "Object is possibly null" — this is the intended behavior directing you to the exact lines to fix.

### Pitfall 3: grammy `Bot` Requires Token at Construction

**What goes wrong:** Constructing `new Bot(token)` validates the token format but does not make a network call. However, if `config.telegram` is undefined, constructing `TelegramAlerts` will throw. The current code already guards against this with the token check.
**Why it happens:** Switching from raw `fetch` to grammy `Bot` changes where the initialization throws.
**How to avoid:** Keep the existing guard: `if (!config.telegram?.botToken) throw new Error(...)`. The grammy `Bot` accepts any non-empty string as token at construction — network validation happens on first API call.

### Pitfall 4: Dedup Store Growing Unbounded

**What goes wrong:** `sentAlertKeys` is appended to on every alert sent, persisted to JSON. Over months, this set can grow large (one entry per eBay itemId per watchlist entry ever alerted).
**Why it happens:** No TTL or pruning logic.
**How to avoid:** Use a composite key `{entryId}:{itemId}:{dateYYYYMMDD}` and prune entries older than 30 days on startup (or weekly). Phase 2 should at minimum document this and add a TODO — full pruning can be Phase 3.

### Pitfall 5: eBay Aspect Filter Grader Name Case-Sensitivity

**What goes wrong:** The aspect filter `Professional Grader:{PSA}` may fail if the actual aspect name in eBay's category 183454 is different (e.g., `Grading Service` instead of `Professional Grader`).
**Why it happens:** eBay aspect names are case-sensitive and category-specific. The current code in `ebay.ts` (line 109) uses `Professional Grader:{PSA},Grade:{grade}` — this is unverified against the live API.
**How to avoid:** In tests, mock the eBay API response and validate that the search query URL contains the expected aspect filter string. In integration testing, use `fieldgroups=ASPECT_REFINEMENTS` to discover the actual aspect names for category 183454. Flag this as LOW confidence.
**Warning signs:** Scan returns 0 results for all grades, or returns listings regardless of grade.

### Pitfall 6: `JsonStorageAdapter.loaded` Flag and New Keys

**What goes wrong:** `JsonStorageAdapter` sets `this.loaded = true` after the first read. If a new key (e.g., `alerts:sent-keys`) is written before the file exists, it will be written correctly. But if the adapter is instantiated and then `get()` is called for the sent-keys before any `set()`, it will return `null` (correct). The risk is a race condition if multiple async operations call `ensureLoaded()` concurrently before `loaded` is true.
**Why it happens:** `ensureLoaded()` is async but `this.loaded` is set synchronously at the end — a second concurrent call to `ensureLoaded()` may start a second file read before the first completes.
**How to avoid:** Add a `loadingPromise` pattern: cache the in-flight promise and await it instead of checking `this.loaded`:
```typescript
private loadingPromise: Promise<void> | null = null;
private async ensureLoaded(): Promise<void> {
  if (this.loaded) return;
  if (!this.loadingPromise) {
    this.loadingPromise = this._load();
  }
  await this.loadingPromise;
}
```
This is a bug in the current `JsonStorageAdapter` that Phase 2 should fix.

### Pitfall 7: `disable_web_page_preview` Telegram API Deprecation

**What goes wrong:** The current `sendMessage` body uses `disable_web_page_preview: false` — this parameter was deprecated in Telegram Bot API layer 167 (February 2025). grammy v1.x may still send it (it's backward-compatible), but future versions may warn or drop it.
**Why it happens:** Telegram updated their API; the old parameter still works but is flagged.
**How to avoid:** When migrating to grammy's `bot.api.sendMessage()`, use `link_preview_options: { is_disabled: false }` instead.

---

## Code Examples

Verified patterns from official sources and codebase inspection:

### MSW 2.x Node.js + Vitest Setup
```typescript
// src/mocks/server.ts
import { setupServer } from 'msw/node';
export const server = setupServer();

// vitest.setup.ts
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './src/mocks/server';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// vitest.config.ts — add setupFiles
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
```
Source: [MSW Node.js Integration docs](https://mswjs.io/docs/integrations/node/)

### MSW HTTP Handler for PokemonPriceTracker
```typescript
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

server.use(
  http.post('https://www.pokemonpricetracker.com/api/v2/parse-title', () =>
    HttpResponse.json({
      data: {
        parsed: { confidence: 0.92, variant: '1st Edition' },
        matches: [
          {
            tcgPlayerId: '12345',
            name: 'Charizard',
            setName: 'Base Set',
            setId: 1,
            cardNumber: '4',
            rarity: 'Rare Holo',
            matchScore: 0.92,
            matchReasons: ['Name match', 'Set match'],
          },
        ],
      },
    })
  )
);
```

### grammY Throttler Setup
```typescript
// Source: https://grammy.dev/plugins/transformer-throttler (no fetch timeout, used npm page)
import { Bot } from 'grammy';
import { apiThrottler } from '@grammyjs/transformer-throttler';

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
const throttler = apiThrottler(); // default Telegram-safe limits
bot.api.config.use(throttler);

// Now bot.api.sendMessage() is automatically throttled
await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
```
Source: [grammY transformer-throttler npm](https://www.npmjs.com/package/@grammyjs/transformer-throttler)

### Two-Tier Confidence Gate
```typescript
// src/card-resolver/resolver.ts
const AUTO_PROCEED_THRESHOLD = 0.85;
const DISAMBIGUATE_THRESHOLD = 0.70;

// replaces single CONFIDENCE_THRESHOLD = 0.7
const confidence = candidates[0]?.confidence ?? 0;
const needsDisambiguation =
  confidence >= DISAMBIGUATE_THRESHOLD &&
  confidence < AUTO_PROCEED_THRESHOLD;
const autoProceeds = confidence >= AUTO_PROCEED_THRESHOLD;

return {
  success: autoProceeds,
  bestMatch: autoProceeds ? candidates[0]?.card : undefined,
  candidates,
  originalQuery: query,
  needsDisambiguation,
};
```

### Persistent Dedup in ScanScheduler
```typescript
// src/scheduler/scan-scheduler.ts
const SENT_ALERT_KEYS_STORAGE_KEY = 'scheduler:sent-alert-keys';

// Lazy-load dedup keys from storage on first access
private async getSentAlertKeys(): Promise<Set<string>> {
  if (this._sentAlertKeysLoaded) return this.sentAlertKeys;
  const stored = await this.watchlist['storage'].get<string[]>(SENT_ALERT_KEYS_STORAGE_KEY) ?? [];
  this.sentAlertKeys = new Set(stored);
  this._sentAlertKeysLoaded = true;
  return this.sentAlertKeys;
}

private async markAlertSent(key: string): Promise<void> {
  const keys = await this.getSentAlertKeys();
  keys.add(key);
  // storage access via watchlist's storage isn't directly exposed —
  // best to inject StorageAdapter directly into ScanScheduler constructor
}
```
**Implementation note:** `ScanScheduler` does not currently hold a direct reference to `StorageAdapter`. The cleanest fix is to inject `StorageAdapter` directly into `ScanScheduler`'s constructor alongside the existing dependencies. This is a constructor change but all callers are in `src/index.ts` and `src/cli.ts`.

### JsonStorageAdapter Race Condition Fix
```typescript
// src/watchlist/storage-json.ts — fix concurrent load race
private loadingPromise: Promise<void> | null = null;

private async ensureLoaded(): Promise<void> {
  if (this.loaded) return;
  if (!this.loadingPromise) {
    this.loadingPromise = this._doLoad();
  }
  return this.loadingPromise;
}

private async _doLoad(): Promise<void> {
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
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single confidence threshold (0.70) | Two-tier: 0.85 auto-proceed, 0.70 disambiguate | Phase 2 decision (prior decision log) | Fewer false positives; user prompted when confidence is borderline |
| In-memory `Set` for dedup | StorageAdapter-backed persistence | Phase 2 | Dedup survives process restart; ALERT-03 satisfied |
| Raw `fetch` in `TelegramAlerts` | grammy `Bot.api.sendMessage()` with throttler | Phase 2 | ALERT-04 satisfied; rate limits handled automatically |
| `metadata.grade` (untyped cast) | Explicit `grade?: number` on `WatchlistEntry` | Phase 2 | Type safety; WATCH-04 properly satisfied |
| `getFMV()` throws on API failure | Returns `null`; scheduler skips gracefully | Phase 2 | PRICE-01 "fails visibly" — still logs error; scheduler continues |
| `disable_web_page_preview` | `link_preview_options: { is_disabled: ... }` | Telegram API layer 167 (Feb 2025) | Old parameter deprecated; grammy v1 supports new field |

**Deprecated/outdated:**
- `disable_web_page_preview` in Telegram Bot API: deprecated in layer 167 (Feb 2025). Still works but use `link_preview_options` in new code.
- Single-threshold card confidence (0.70): replaced by two-tier gate per prior decisions.

---

## Open Questions

1. **eBay aspect filter exact values for category 183454**
   - What we know: Current code uses `Professional Grader:{PSA},Grade:{grade}` — this is plausible based on eBay Browse API docs
   - What's unclear: Whether the exact aspect names match what eBay returns for this specific category. Community reports suggest mixed results.
   - Recommendation: Add integration smoke-test task in Phase 6 (live API testing); for Phase 2 unit tests, just mock the eBay response and verify the query string is built correctly. Do not block Phase 2 on this.

2. **PokemonPriceTracker API response shape for edge cases**
   - What we know: The `v2/parse-title` endpoint returns either `data.parsed` + `data.matches` (v2) or `data` + `candidates` (legacy). Both paths are implemented in `resolver.ts`.
   - What's unclear: Exact behavior when there are zero matches (does `data.matches` return `[]` or is it absent?); exact error response format when rate-limited.
   - Recommendation: Implement MSW tests covering both v2 format and legacy format. The existing `isLegacyResponse()` check is the discriminator — test it.

3. **`ScanScheduler` daily counter persistence across midnight**
   - What we know: Counters are reset when `today !== this.lastResetDate` (UTC). In-memory counters are lost on restart.
   - What's unclear: Whether the success criterion requires counter persistence (a restarted process at 11:59 PM could re-use quota already consumed). The success criteria only mention watchlist and alert dedup persistence — NOT counter persistence.
   - Recommendation: Keep counters in-memory for Phase 2 (restart resets them, which is conservative — it underestimates usage, not overestimates). Add a TODO for Phase 3 if this becomes an issue.

4. **grammy `Bot` in non-polling mode for outgoing-only alerts**
   - What we know: grammy `Bot` can call `bot.api.sendMessage()` without calling `bot.start()` — this is documented and common for outgoing-only bots.
   - What's unclear: Whether the throttler plugin requires polling to be active.
   - Recommendation: The throttler is a transformer on `bot.api` — it works regardless of polling. No `bot.start()` call needed. Confidence: MEDIUM (from npm page description; full docs page timed out).

---

## Sources

### Primary (HIGH confidence)
- Codebase inspection — all source files in `src/` read directly; describes exact current state
- [MSW Node.js Integration docs](https://mswjs.io/docs/integrations/node/) — confirmed `setupServer` API and lifecycle hooks
- [grammY transformer-throttler npm](https://www.npmjs.com/package/@grammyjs/transformer-throttler) — confirmed install name and basic usage
- [eBay Browse API AspectFilter docs](https://developer.ebay.com/api-docs/buy/browse/types/gct:AspectFilter) — confirmed aspect filter format and case-sensitivity requirement
- `.planning/codebase/CONCERNS.md` — thorough analysis of existing bugs, fragile areas, test coverage gaps
- `.planning/codebase/INTEGRATIONS.md` — confirmed all API endpoints, auth patterns, env vars

### Secondary (MEDIUM confidence)
- [grammY Flood Limits page](https://grammy.dev/advanced/flood) — confirmed transformer-throttler is the recommended approach (page timed out; contents confirmed via search result snippets)
- [Telegram Bot API FAQ](https://core.telegram.org/bots/faq) — confirmed 1 message/sec per chat, ~30 messages/sec global limits
- [write-file-atomic npm](https://www.npmjs.com/package/write-file-atomic) — confirmed atomic write pattern (temp file + rename) for Node.js

### Tertiary (LOW confidence)
- eBay community posts re: aspect filter for PSA grades — suggest `Professional Grader:{PSA}` works but field name may vary; needs live validation
- PokemonPriceTracker API docs (page renders via JS only; content not extractable) — API shape inferred entirely from existing production code in `resolver.ts` and `engine.ts`

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed except throttler and MSW; both are well-documented
- Architecture: HIGH — all patterns derived from reading actual source files; changes are targeted
- Pitfalls: HIGH — derived from `CONCERNS.md` codebase audit and TypeScript type analysis
- eBay aspect filter values: LOW — unverified against live API; mocked in tests
- PokemonPriceTracker v2 response shape: MEDIUM — inferred from production code that is presumably working

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (stable libraries; Telegram API rate limits rarely change)
