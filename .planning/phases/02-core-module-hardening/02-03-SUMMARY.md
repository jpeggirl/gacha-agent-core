---
phase: 02-core-module-hardening
plan: 03
subsystem: pricing
tags: [msw, vitest, tdd, error-boundary, null-return, caching]

# Dependency graph
requires:
  - phase: 02-01
    provides: MSW 2.x test infrastructure (server.ts, vitest.setup.ts)

provides:
  - PriceEngine.getFMV() returns FairMarketValue | null (never throws)
  - MSW-backed tests for success, cache TTL, 503 failure, success:false failure, multi-grade partial failure
  - Null-return error boundary propagated into getMultiGradeFMV()

affects:
  - 02-07 (scan-scheduler: must handle null FMV from getFMV calls)
  - 02-08 (cli.ts, server.ts: callers must guard against null return)

# Tech tracking
tech-stack:
  added: []
  patterns: [null-return error boundary, MSW handler per test case, try/catch wrapping external fetch]

key-files:
  created:
    - src/pricing/engine.test.ts
  modified:
    - src/pricing/engine.ts

key-decisions:
  - "Null return over throw for API failures: propagated errors stop the scheduler loop; null lets callers skip FMV-dependent steps"
  - "fetchPsaPricing still throws HTTP errors — getFMV catches them at the boundary, keeping network logic separate from business logic"
  - "getMultiGradeFMV: removed inner try/catch, now checks for null return from getFMV (cleaner delegation)"

patterns-established:
  - "Error boundary pattern: external I/O methods throw, public API methods catch and return null"
  - "MSW handler-per-test: each test case registers its own handler via server.use() for explicit HTTP contracts"

requirements-completed:
  - PRICE-01
  - PRICE-02
  - PRICE-03

# Metrics
duration: 2min
completed: 2026-02-18
---

# Phase 2 Plan 03: Null-Return Error Boundary for PriceEngine Summary

**PriceEngine.getFMV() changed from throw-on-failure to null-return with console.error logging, with 7 MSW-backed TDD tests covering success, cache TTL, 503, success:false, and multi-grade partial failure**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-18T15:15:21Z
- **Completed:** 2026-02-18T15:16:50Z
- **Tasks:** 2 (RED + GREEN; no refactor needed)
- **Files modified:** 2

## Accomplishments

- getFMV() return type changed to `Promise<FairMarketValue | null>` — never throws
- try/catch wraps the entire fetch+process block; catches HTTP errors thrown by fetchPsaPricing
- No-data path (success:false or missing data) logs "[PriceEngine] No data for {name} PSA {grade}: {error}" and returns null
- Network/HTTP error path logs "[PriceEngine] API error for {name} PSA {grade}: {msg}" and returns null
- getMultiGradeFMV simplified: checks null return instead of try/catch (delegates to getFMV's boundary)
- 7 MSW-backed tests cover all 5 specified behaviors from the plan

## Task Commits

TDD commits (RED then GREEN):

1. **RED: Failing tests** - `befc83f` (test)
2. **GREEN: Implementation** - `177131c` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/pricing/engine.test.ts` - 7 tests: success, cache TTL, 503 null, 503 log, success:false null, success:false log, multi-grade partial failure
- `src/pricing/engine.ts` - getFMV() return type widened to `FairMarketValue | null`, try/catch error boundary added, getMultiGradeFMV simplified

## Decisions Made

- fetchPsaPricing still throws on non-ok HTTP status — this is intentional. getFMV catches at the boundary, keeping the two concerns separate (raw network vs business-level null semantics).
- getMultiGradeFMV no longer needs its own try/catch since getFMV is now the error boundary.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Typecheck reports 7 errors in cli.ts, scan-scheduler.ts, and server.ts — these are expected per the plan's verification notes ("Pitfall 2 from research. These caller fixes happen in Plan 07 and Plan 08").

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Price engine error boundary complete
- Plans 07 (scan-scheduler) and 08 (CLI/server) will fix the 7 typecheck errors in callers
- No blockers for remaining Phase 2 plans

## Self-Check: PASSED

- src/pricing/engine.test.ts: FOUND
- src/pricing/engine.ts: FOUND
- .planning/phases/02-core-module-hardening/02-03-SUMMARY.md: FOUND
- Commits befc83f, 177131c: verified in git log

---
*Phase: 02-core-module-hardening*
*Completed: 2026-02-18*
