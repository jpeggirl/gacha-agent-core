---
phase: 02-core-module-hardening
verified: 2026-02-19T12:25:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 2: Core Module Hardening Verification Report

**Phase Goal:** All core modules are production-reliable — errors are handled, state is persisted, and financial-critical logic gates are enforced
**Verified:** 2026-02-19T12:25:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can resolve "Charizard Base Set holo PSA 10" to canonical identity; ambiguous queries (0.70-0.84 confidence) surface ranked candidates and a disambiguation reason instead of auto-proceeding | VERIFIED | `AUTO_PROCEED_THRESHOLD = 0.85`, `DISAMBIGUATE_THRESHOLD = 0.70` in `resolver.ts`; `disambiguationReason` set and returned; `resolver.test.ts` 8 passing tests cover all confidence tiers |
| 2 | FMV lookup returns price + population count, is cached 30 min, fails visibly (not silently) when API unavailable | VERIFIED | `getFMV()` returns `FairMarketValue | null`; cache keyed by `card.id:grade` with 30-min TTL; `console.error` on failure; `engine.test.ts` 7 passing tests cover cache, 503, success-false, multi-grade partial |
| 3 | eBay scan returns scored listings with 0-100 score, signal classification, and human-readable reasoning; sellers below 95% feedback never receive positive signals | VERIFIED | `deriveSignal()` hard-filters `sellerFeedbackPercent < 95` to `'avoid'`; thin-market downgrade `< 5 prices` implemented; `deal-scorer.test.ts` 9 passing; scanner returns empty `ScanResult` on error (not throws) |
| 4 | Watchlist survives process restart; grade-specific entries (PSA 9 at $200 AND PSA 10 at $500 for same card) stored and retrieved correctly | VERIFIED | `JsonStorageAdapter` uses `loadingPromise` race-safe pattern; `storage-json.test.ts` restart test uses two adapter instances on same file; `manager.test.ts` grade-specific entry test at lines 128-150; `WatchlistManager.add()` stores `grade` from input |
| 5 | Deal alert sent before restart is not re-sent after restart; Telegram alerts respect rate limits and do not trigger 429 errors during burst sends | VERIFIED | `TelegramAlerts` uses grammy `Bot` with `apiThrottler()`; dedup keys stored in `StorageAdapter` under `alerts:sent-keys`; `ScanScheduler` persists `sentAlertKeys` under `scheduler:sent-alert-keys`; `telegram.test.ts` dedup-across-instances test passing; `scan-scheduler.test.ts` persistence test passing |

**Score: 5/5 truths verified**

---

### Required Artifacts

| Artifact | Status | Evidence |
|----------|--------|---------|
| `vitest.setup.ts` | VERIFIED | Exists; imports `server` from `./src/mocks/server.js`; calls `server.listen({ onUnhandledRequest: 'error' })`, `resetHandlers`, `close` |
| `src/mocks/server.ts` | VERIFIED | Exists; `import { setupServer } from 'msw/node'; export const server = setupServer();` |
| `vitest.config.ts` | VERIFIED | Contains `setupFiles: ['./vitest.setup.ts']` |
| `src/types/index.ts` | VERIFIED | `WatchlistEntry.grade?: number` present; `CreateWatchlistInput.grade?: number` present; `ResolveResult.disambiguationReason?: string` present; `FairMarketValue.prices: PricePoint[]` present |
| `src/card-resolver/resolver.ts` | VERIFIED | `AUTO_PROCEED_THRESHOLD = 0.85`; `DISAMBIGUATE_THRESHOLD = 0.70`; two-tier gate logic; catch block with `console.error`; calls `api/v2/parse-title` |
| `src/card-resolver/resolver.test.ts` | VERIFIED | 190 lines; 8 tests passing; covers high-confidence auto-proceed, disambiguation range, below threshold, API failure, empty results |
| `src/pricing/engine.ts` | VERIFIED | Return type `Promise<FairMarketValue | null>`; null returned on `!response.success`; try/catch wraps fetch; `console.error` with card name + grade; cache with 30-min TTL |
| `src/pricing/engine.test.ts` | VERIFIED | 210 lines; 7 tests passing; covers success, cache hit, API 503, success-false, multi-grade partial |
| `src/watchlist/storage-json.ts` | VERIFIED | `loadingPromise: Promise<void> | null = null` race-condition fix; `_doLoad()` separation |
| `src/watchlist/storage-json.test.ts` | VERIFIED | 96 lines; 6 tests passing; includes restart persistence test using two adapter instances |
| `src/watchlist/manager.ts` | VERIFIED | `grade: input.grade` stored in `WatchlistEntry`; `remove()` cleans user index atomically; `listActive()` filters active entries |
| `src/watchlist/manager.test.ts` | VERIFIED | 190 lines; grade-specific entry test (PSA 9 + PSA 10 for same card, verified at lines 128-150); remove atomicity test; listActive filter test |
| `src/scanner/deal-scorer.ts` | VERIFIED | `prices.length < 5` thin-market downgrade in `deriveSignal()`; `sellerFeedbackPercent < 95` hard filter; thin-market warning in `buildReasoning()` |
| `src/scanner/deal-scorer.test.ts` | VERIFIED | 239 lines; 9 tests passing |
| `src/scanner/ebay.ts` | VERIFIED | `scan()` wrapped in try/catch; returns empty `ScanResult` on error; `buildSearchQuery` uses name, setName, variant, number, grade |
| `src/scanner/ebay.test.ts` | VERIFIED | 248 lines; 9 tests passing |
| `src/alerts/telegram.ts` | VERIFIED | Uses grammy `Bot`; `apiThrottler()` attached; `StorageAdapter` constructor param; dedup loaded lazily from storage; `storage.set` after each send; no raw fetch to Telegram |
| `src/alerts/telegram.test.ts` | VERIFIED | 211 lines; 8 tests passing; dedup-across-instances test |
| `src/scheduler/scan-scheduler.ts` | VERIFIED | `StorageAdapter` constructor param; `ensureSentAlertKeysLoaded()` / `markAlertSent()`; null FMV guard with `markScanned`; grade chain `entry.grade ?? metadata?.grade ?? 9`; eBay + pricing daily limit enforcement; prioritizes never-scanned first |
| `src/scheduler/scan-scheduler.test.ts` | VERIFIED | 368 lines (exceeds 100 min); 8 tests passing; covers null FMV, persistence, prioritization, rate limits, grade resolution |
| `src/cli.ts` | VERIFIED | `disambiguationReason` surfaced in resolve command; grade parsed from args via `/\bpsa\s*(\d+)\b/i`; null FMV handled with guard; `new TelegramAlerts(config, storage)` and `new ScanScheduler(..., storage)` in run command |
| `src/server.ts` | VERIFIED | `disambiguationReason: result.disambiguationReason` in resolve response; 502 on null FMV for price endpoint; grade passed to watchlist.add; note: server has no scheduler/alerts, so no TelegramAlerts constructor call (by design — server is API-only) |

---

### Key Link Verification

| From | To | Via | Status | Detail |
|------|----|-----|--------|--------|
| `vitest.setup.ts` | `src/mocks/server.ts` | `import { server }` | WIRED | Line 2: `import { server } from './src/mocks/server.js'` |
| `vitest.config.ts` | `vitest.setup.ts` | `setupFiles` | WIRED | `setupFiles: ['./vitest.setup.ts']` |
| `src/card-resolver/resolver.ts` | `api/v2/parse-title` | fetch POST | WIRED | Line 146: `const url = \`\${this.baseUrl}/api/v2/parse-title\`` |
| `src/pricing/engine.ts` | `api/psa/pricing` | fetch GET | WIRED | Line 111: `/api/psa/pricing/\${encodeURIComponent(cardId)}/\${grade}` |
| `src/scanner/deal-scorer.ts` | `FairMarketValue.prices.length` | thin-market check | WIRED | Line 148: `if (fmv.prices.length < 5)` |
| `src/scanner/ebay.ts` | `item_summary/search` | fetch GET | WIRED | Line 111: `\${baseUrl}/item_summary/search?${params}` |
| `src/alerts/telegram.ts` | `@grammyjs/transformer-throttler` | `bot.api.config.use(apiThrottler())` | WIRED | Line 20: `this.bot.api.config.use(apiThrottler())` |
| `src/alerts/telegram.ts` | `StorageAdapter` (dedup) | `storage.get/set` | WIRED | Lines 27, 53: `storage.get(SENT_ALERTS_STORAGE_KEY)`, `storage.set(...)` |
| `src/scheduler/scan-scheduler.ts` | `StorageAdapter` (sentAlertKeys) | `storage.get/set` | WIRED | Lines 97, 104: `storage.get(SENT_ALERT_KEYS_STORAGE_KEY)`, `storage.set(...)` |
| `src/scheduler/scan-scheduler.ts` | `PriceEngine.getFMV()` null check | `if (!fmv)` guard | WIRED | Lines 132-141: `const fmv = await this.priceEngine.getFMV(...); if (!fmv) { ... markScanned ... return; }` |
| `src/cli.ts` | `TelegramAlerts` | `new TelegramAlerts(config, storage)` | WIRED | Line 245: `const alerts = new TelegramAlerts(config, storage)` |
| `src/cli.ts` | `ScanScheduler` | `new ScanScheduler(..., storage)` | WIRED | Lines 246-254 |
| `src/cli.ts` | `resolver.ts` | `result.needsDisambiguation` | WIRED | Line 88: `else if (result.needsDisambiguation)` |
| `src/server.ts` | `result.disambiguationReason` | spread + explicit field | WIRED | Line 303-305: `{ ...result, disambiguationReason: result.disambiguationReason }` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| CARD-01 | 02-02, 02-08 | Resolve card from natural language to canonical identity | SATISFIED | `CardResolver.resolve()` with auto-proceed at >=0.85 confidence; `success: true` with `bestMatch` |
| CARD-02 | 02-02, 02-08 | Ambiguous queries return ranked candidates with confidence scores | SATISFIED | Candidates array sorted by confidence; returned when `needsDisambiguation: true` |
| CARD-03 | 02-02, 02-08 | Disambiguation when confidence 0.70-0.84 | SATISFIED | `needsDisambiguation: true` + `disambiguationReason` string in 0.70-0.84 range |
| PRICE-01 | 02-03 | FMV for any graded card from PokemonPriceTracker | SATISFIED | `getFMV()` calls `/api/psa/pricing`; returns `FairMarketValue`; null on failure (visible error via console.error) |
| PRICE-02 | 02-03 | FMV cached 30-min TTL | SATISFIED | Cache Map with `expiresAt = Date.now() + 30*60*1000`; tested in engine.test.ts |
| PRICE-03 | 02-01, 02-03 | FMV returns population count alongside price | SATISFIED | `FairMarketValue.prices: PricePoint[]` (array); `populationCount?: number`; `FairMarketValue` type has both |
| SCORE-01 | 02-05 | eBay listing scored 0-100 against FMV | SATISFIED | `DealScorer.score()` produces 0-100 weighted score (priceVsFmv, sellerRep, listingType, popRarity) |
| SCORE-02 | 02-05 | Signal classification (strong_buy/buy/fair/overpriced/avoid) | SATISFIED | `deriveSignal()` maps score ranges to `DealSignal` type |
| SCORE-03 | 02-05 | Seller feedback <95% excluded from positive signals | SATISFIED | Hard filter: `if (listing.sellerFeedbackPercent < 95) return 'avoid'` |
| SCORE-04 | 02-05 | Deal score includes human-readable reasoning | SATISFIED | `buildReasoning()` returns multi-part string; stored in `ScoredDeal.reasoning` |
| SCAN-01 | 02-05 | Scans eBay Browse API for listings matching resolved card | SATISFIED | `EbayScanner.scan()` calls eBay Browse API `/item_summary/search` |
| SCAN-02 | 02-05 | Scanner builds optimized query from name, set, variant, number, grade | SATISFIED | `buildSearchQuery()` assembles parts: name, setName, variant, `#number`, `PSA {grade}` |
| SCAN-03 | 02-07 | Scan scheduler processes active watchlist entries on configurable interval | SATISFIED | `ScanScheduler.start()` schedules via `setTimeout`; interval from `config.scheduler.scanIntervalMs` |
| SCAN-04 | 02-07 | Scheduler prioritizes oldest-scanned entries first, batch concurrency limit | SATISFIED | `prioritize()` sorts never-scanned first then by `lastScannedAt`; batch loop uses `maxConcurrentScans` |
| SCAN-05 | 02-07 | Scheduler respects daily API rate limits (eBay 5000/day, pricing 100/day) | SATISFIED | `canMakeEbayCall()` / `canMakePricingCall()` checked before each scan; counters reset daily |
| WATCH-01 | 02-04, 02-08 | User can add card to watchlist with target price and grade | SATISFIED | `WatchlistManager.add()` stores grade; CLI `watch` command passes grade from args |
| WATCH-02 | 02-04, 02-08 | User can remove cards from watchlist | SATISFIED | `WatchlistManager.remove()` deletes entry and cleans user index |
| WATCH-03 | 02-04, 02-08 | User can list all active watchlist entries | SATISFIED | `WatchlistManager.listActive()` and `listByUser()`; CLI `list` command |
| WATCH-04 | 02-01, 02-04 | Grade-specific targeting per entry | SATISFIED | `grade?: number` field on `WatchlistEntry` and `CreateWatchlistInput`; manager.test.ts proves PSA 9 and PSA 10 entries for same card stored independently |
| WATCH-05 | 02-04 | Watchlist persists across process restarts via StorageAdapter | SATISFIED | `JsonStorageAdapter` writes to disk on every `set()`; restart test in storage-json.test.ts proves two adapter instances read same data |
| ALERT-01 | 02-06 | Formatted deal alerts to Telegram with card info, price vs FMV, score, reasoning | SATISFIED | `formatDealMessage()` produces HTML with card name, set, price, FMV, savings%, signal, reasoning, eBay link |
| ALERT-03 | 02-06, 02-07 | Alert deduplication persists across restarts | SATISFIED | `TelegramAlerts` stores dedup keys in `StorageAdapter`; `ScanScheduler` stores `sentAlertKeys` in `StorageAdapter`; both tested with two-instance persistence tests |
| ALERT-04 | 02-06 | Alerts respect Telegram rate limits | SATISFIED | `apiThrottler()` transformer attached to `bot.api.config`; prevents 429 on burst sends |

**All 23 Phase 2 requirements: SATISFIED**

Note: ALERT-02 (inline keyboard BUY button) is Phase 3, not Phase 2 — correctly excluded.

---

### Anti-Patterns Found

No blockers or significant warnings found.

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| `src/server.ts` | Does not instantiate `TelegramAlerts` | INFO | By design — server is API-only; `TelegramAlerts` is only needed in the scheduler (`run` CLI command). Plan 08 requirement was to pass `storage` to TelegramAlerts "where used" — it is correctly wired in `cli.ts`. |
| `src/watchlist/manager.ts` | `update()` does not accept `grade` in partial updates | INFO | `grade` is set at creation only; no requirement for post-creation grade update |

---

### Human Verification Required

None. All success criteria are verifiable programmatically. The 71 passing tests, zero TypeScript errors, and zero lint errors provide full automated confidence.

---

### Gaps Summary

No gaps. All 5 observable truths are verified, all 22 artifacts are substantive and wired, all 14 key links are confirmed present in the actual code, and all 23 Phase 2 requirements are satisfied.

The full test suite (`npm test`) exits with 71 passing tests across 8 test files. TypeScript (`npm run typecheck`) and ESLint (`npm run lint`) both exit clean.

---

_Verified: 2026-02-19T12:25:00Z_
_Verifier: Claude (gsd-verifier)_
