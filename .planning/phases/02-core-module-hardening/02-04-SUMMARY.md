---
phase: 02-core-module-hardening
plan: 04
subsystem: storage
tags: [json-storage, watchlist, persistence, race-condition, testing]

# Dependency graph
requires:
  - phase: 02-01
    provides: WatchlistEntry/CreateWatchlistInput types with grade field, StorageAdapter interface
provides:
  - Race-condition-safe JsonStorageAdapter using loadingPromise pattern
  - Restart persistence proven by integration test (two adapter instances on same file)
  - WatchlistManager storing grade field from CreateWatchlistInput
  - Grade-specific entry tests, remove atomicity test, listActive filter test
affects:
  - 02-core-module-hardening (all plans using JsonStorageAdapter)
  - 03-bidirectional-telegram (alert dedup persistence depends on StorageAdapter)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "loadingPromise pattern for concurrent-safe async initialization (prevents multiple parallel reads of the same file)"
    - "Integration test pattern: two adapter instances on same temp directory to prove restart persistence"
    - "mkdtemp + afterEach cleanup for isolated file system tests"

key-files:
  created:
    - src/watchlist/storage-json.test.ts
  modified:
    - src/watchlist/storage-json.ts
    - src/watchlist/manager.ts
    - src/watchlist/manager.test.ts

key-decisions:
  - "Use loadingPromise (not loaded flag) in ensureLoaded() — single Promise shared by all concurrent callers prevents duplicate file reads and cache corruption"
  - "Restart persistence test creates two separate JsonStorageAdapter instances on the same temp directory — proves real disk persistence, not just in-memory state"

patterns-established:
  - "loadingPromise pattern: set promise before awaiting, share it across concurrent callers, set loaded=true only in the single _doLoad() execution"
  - "Storage integration tests use node:os tmpdir + mkdtemp + afterEach rm for clean isolation"

requirements-completed:
  - WATCH-01
  - WATCH-02
  - WATCH-03
  - WATCH-05

# Metrics
duration: 10min
completed: 2026-02-18
---

# Phase 2 Plan 04: Watchlist Storage Hardening Summary

**Race-condition-safe JsonStorageAdapter using loadingPromise pattern, restart persistence proven by two-instance integration test, WatchlistManager grade field storage with grade-specific and atomicity tests**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-02-18T15:15:16Z
- **Completed:** 2026-02-18T15:25:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Fixed concurrent `ensureLoaded()` race condition — `loadingPromise` ensures only one file read executes; all concurrent callers await the same Promise
- Created `storage-json.test.ts` with restart persistence integration test (two `JsonStorageAdapter` instances on same temp directory), CRUD, prefix list, and concurrent load tests
- Updated `WatchlistManager.add()` to explicitly store `grade: input.grade` on the created `WatchlistEntry`
- Added 3 new test cases to `manager.test.ts`: grade-specific entries, remove atomicity (both entry store and user index cleaned), and listActive filtering

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix JsonStorageAdapter race condition and add restart persistence test** - `a8f2acc` (fix)
2. **Task 2: Extend WatchlistManager for grade field and edge cases** - `9cb0b4d` (feat)

## Files Created/Modified

- `src/watchlist/storage-json.ts` - Added `loadingPromise` field and `_doLoad()` method; `ensureLoaded()` now deduplicates concurrent calls
- `src/watchlist/storage-json.test.ts` - New file: restart persistence, CRUD, prefix list, concurrent load, and delete-missing-key tests (6 tests total)
- `src/watchlist/manager.ts` - `add()` now stores `grade: input.grade` in WatchlistEntry
- `src/watchlist/manager.test.ts` - Added grade-specific entry, remove atomicity, and listActive filter test cases (9 tests total, 3 new)

## Decisions Made

- Used `loadingPromise` pattern (not a simple `loaded` boolean flag) to share a single Promise across all concurrent callers to `ensureLoaded()`. This is the correct fix: the flag approach allows N concurrent callers to each start a file read; the promise approach collapses them to one.
- Restart persistence test creates two entirely separate `JsonStorageAdapter` instances on the same temp directory. This proves that data is actually written to disk and read back, not just held in a shared in-memory structure.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing test failures in `src/card-resolver/resolver.test.ts` (3 tests) are intentional RED-phase TDD tests from plan 02-02 — the two-tier confidence gate implementation is scheduled for a future plan. These failures are unrelated to this plan's scope and pre-date this execution.

Pre-existing typecheck errors in `src/cli.ts`, `src/scheduler/scan-scheduler.ts`, and `src/server.ts` (`FairMarketValue | null` not assignable to `FairMarketValue`) are out of scope — no changes were made to those files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `JsonStorageAdapter` is now safe for concurrent use — downstream plans (alert dedup persistence, scheduler) can use it without race condition risk
- `WatchlistManager` correctly stores and retrieves grade-specific entries — WATCH-04 grade targeting is ready
- Restart persistence is proven — WATCH-05 is fulfilled

## Self-Check: PASSED

- FOUND: src/watchlist/storage-json.ts
- FOUND: src/watchlist/storage-json.test.ts
- FOUND: src/watchlist/manager.ts
- FOUND: src/watchlist/manager.test.ts
- FOUND: .planning/phases/02-core-module-hardening/02-04-SUMMARY.md
- FOUND commit: a8f2acc (Task 1 - fix race condition + storage tests)
- FOUND commit: 9cb0b4d (Task 2 - grade field + manager tests)
- FOUND commit: 9a25955 (docs - summary and state updates)

---
*Phase: 02-core-module-hardening*
*Completed: 2026-02-18*
