---
phase: 02-core-module-hardening
plan: 01
subsystem: testing
tags: [msw, vitest, typescript, types, watchlist, card-resolver]

# Dependency graph
requires:
  - phase: 01-foundation-and-tooling
    provides: Vitest 4 test runner, TypeScript config, base type definitions
provides:
  - MSW 2.x setupServer instance shared across all tests
  - Global MSW lifecycle hooks (beforeAll/afterEach/afterAll) in vitest.setup.ts
  - WatchlistEntry.grade optional number field
  - CreateWatchlistInput.grade optional number field
  - ResolveResult.disambiguationReason optional string field
affects:
  - 02-02 (card resolver TDD - needs MSW for HTTP mocking)
  - 02-03 (price module TDD - needs MSW for HTTP mocking)
  - 02-04 (deal scorer TDD - needs MSW for HTTP mocking)
  - 02-05 (scan module TDD - needs MSW for HTTP mocking)
  - 02-06 (alert module TDD - needs MSW for HTTP mocking)
  - 02-07 (watchlist manager TDD - needs grade field in types)
  - 02-08 (scheduler TDD)

# Tech tracking
tech-stack:
  added:
    - msw@2.12.10 (HTTP mocking for Node.js tests via msw/node setupServer)
    - "@grammyjs/transformer-throttler@1.2.1 (Telegram rate limiting, used in Plan 06)"
  patterns:
    - MSW server singleton pattern: single setupServer() exported from src/mocks/server.ts, imported by vitest.setup.ts
    - Global test lifecycle hooks via vitest setupFiles (not per-file beforeAll)
    - onUnhandledRequest: 'error' enforces explicit HTTP mocking - no silent live API calls in tests

key-files:
  created:
    - src/mocks/server.ts
    - vitest.setup.ts
  modified:
    - vitest.config.ts
    - src/types/index.ts

key-decisions:
  - "MSW onUnhandledRequest: 'error' — fail loudly on unhandled requests rather than silently hitting live APIs in tests"
  - "metadata preserved on WatchlistEntry — grade field supplements (not replaces) metadata for backward compat with persisted data"
  - "disambiguationReason added to ResolveResult to explain two-tier gate (0.85+ auto, 0.70-0.84 disambiguate)"

patterns-established:
  - "MSW singleton: export server from src/mocks/server.ts, register handlers per-test with server.use()"
  - "Global hooks via vitest setupFiles, not per-file imports"

requirements-completed:
  - WATCH-04
  - PRICE-03

# Metrics
duration: 8min
completed: 2026-02-18
---

# Phase 2 Plan 01: MSW Test Infrastructure and Core Type Updates Summary

**MSW 2.x test infrastructure wired globally via vitest setupFiles with onUnhandledRequest: 'error', and WatchlistEntry/ResolveResult types extended with grade and disambiguationReason fields**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-02-18T23:10:49Z
- **Completed:** 2026-02-18T23:12:07Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Installed msw@2.12.10 and @grammyjs/transformer-throttler@1.2.1 (the only two new packages for the entire Phase 2)
- Created shared MSW server singleton at `src/mocks/server.ts` and wired global lifecycle hooks in `vitest.setup.ts`
- Updated `WatchlistEntry`, `CreateWatchlistInput`, and `ResolveResult` types — all backward-compatible, 13 existing tests continue passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Install MSW and transformer-throttler dependencies** - `f3c14eb` (chore)
2. **Task 2: Create MSW test infrastructure and update vitest config** - `da11848` (feat)
3. **Task 3: Add explicit grade field to WatchlistEntry and CreateWatchlistInput types** - `aa527da` (feat)

## Files Created/Modified

- `src/mocks/server.ts` - Shared MSW setupServer() instance, exported as `server`
- `vitest.setup.ts` - Global beforeAll/afterEach/afterAll MSW lifecycle hooks for all test files
- `vitest.config.ts` - Added `setupFiles: ['./vitest.setup.ts']` entry
- `src/types/index.ts` - Added `grade?: number` to WatchlistEntry and CreateWatchlistInput; added `disambiguationReason?: string` to ResolveResult; updated needsDisambiguation comment

## Decisions Made

- `onUnhandledRequest: 'error'` chosen over `'warn'` — financial domain requires explicit HTTP contracts in tests; silent live API calls are a reliability hazard
- `metadata` preserved on WatchlistEntry — removing it would break backward compatibility with persisted data; `grade` takes precedence when present, callers fall back to `metadata?.grade`
- `disambiguationReason` comment updated to reflect the two-tier gate (0.85+ auto-proceed, 0.70-0.84 requires disambiguation) that Plan 02 will implement

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All Phase 2 TDD plans (02-03 through 02-08) can now use MSW for HTTP mocking by importing `server` from `src/mocks/server.ts` and registering handlers via `server.use()`
- Type updates are in place for Plan 02 (card resolver two-tier disambiguation gate) and Plan 07 (watchlist manager grade-specific FMV lookups)
- No blockers for Phase 2 continuation

---
*Phase: 02-core-module-hardening*
*Completed: 2026-02-18*
