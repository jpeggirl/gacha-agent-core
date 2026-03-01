---
phase: 02-core-module-hardening
plan: "07"
subsystem: scheduler
tags: [scheduler, storage, dedup, persistence, null-safety, grade]
dependency_graph:
  requires:
    - 02-03  # PriceEngine null-return (getFMV returns null)
    - 02-04  # StorageAdapter / JsonStorageAdapter
    - 02-05  # DealScorer thin-market
    - 02-06  # TelegramAlerts with StorageAdapter
  provides:
    - Hardened ScanScheduler with persistent sentAlertKeys
    - Null FMV guard in scanEntry()
    - Grade resolution: entry.grade > metadata.grade > 9
  affects:
    - src/cli.ts (new constructor param — fixed in Plan 08)
    - src/server.ts (new constructor param — fixed in Plan 08)
tech_stack:
  added: []
  patterns:
    - Lazy-load pattern for persistent dedup (ensureSentAlertKeysLoaded)
    - Null-guard early return before scoring
    - Optional chaining with nullish coalescing for grade fallback
key_files:
  created:
    - src/scheduler/scan-scheduler.test.ts
  modified:
    - src/scheduler/scan-scheduler.ts
decisions:
  - StorageAdapter injected into ScanScheduler constructor (not constructed internally) — mirrors Plan 06 TelegramAlerts pattern, enables testability with InMemoryStorage
  - Storage key 'scheduler:sent-alert-keys' (namespaced to avoid collision with 'alerts:sent-keys')
  - Lazy-load (not eager-load) on first alert check — avoids async constructor, consistent with TelegramAlerts pattern
  - Null FMV skips scoring AND marks entry as scanned — prevents infinite retry loop on cards with no price data
metrics:
  duration_seconds: 133
  completed_date: "2026-02-19"
  tasks_completed: 2
  files_changed: 2
requirements-completed:
  - SCAN-03
  - SCAN-04
  - SCAN-05
---

# Phase 2 Plan 07: Hardened ScanScheduler Summary

**One-liner:** ScanScheduler gains StorageAdapter injection for persistent alert dedup, null FMV guard that skips scoring gracefully, and grade fallback chain (entry.grade > metadata.grade > 9).

## What Was Built

### StorageAdapter Dependency Injection

`ScanScheduler` constructor now accepts `StorageAdapter` as its 7th parameter. This follows the same pattern as `TelegramAlerts` (Plan 06):

```typescript
constructor(
  config: GachaAgentConfig,
  watchlist: WatchlistManager,
  scanner: EbayScanner,
  priceEngine: PriceEngine,
  dealScorer: DealScorer,
  alerts: TelegramAlerts,
  storage: StorageAdapter,   // NEW
)
```

### Persistent sentAlertKeys

Three mechanisms work together:

1. **Lazy load:** `ensureSentAlertKeysLoaded()` reads `'scheduler:sent-alert-keys'` from storage on the first alert check. Subsequent calls skip the read (idempotent guard flag).

2. **Persistent write:** `markAlertSent(key)` adds to the in-memory Set AND writes the full array back to storage atomically.

3. **Cross-instance dedup:** A second `ScanScheduler` created with the same `StorageAdapter` instance loads the same persisted keys — proven by the restart persistence test.

### Null FMV Guard

When `PriceEngine.getFMV()` returns `null`, the scheduler:
- Logs a warning: `[Scheduler] Could not get FMV for {card} PSA {grade} — skipping scoring`
- Calls `watchlist.markScanned(entry.id)` to prevent re-queuing
- Returns early — `dealScorer.scoreMany()` is never called

This prevents crashes and infinite retry on cards with no price data.

### Grade Resolution

```typescript
const grade = entry.grade ?? (entry.metadata?.grade as number | undefined) ?? 9;
```

Priority: `entry.grade` (explicit) > `entry.metadata?.grade` (legacy) > `9` (default).

## Tests (8 passing)

| # | Test | Covers |
|---|------|--------|
| 1 | No active entries — logs and skips | Empty watchlist path |
| 2 | Never-scanned before recently-scanned | Prioritization sort |
| 3 | Null FMV skips scoring, marks scanned | Null FMV guard |
| 4 | In-memory dedup — alert not re-sent | sentAlertKeys Set check |
| 5 | Persistence across restart — two instances, same storage | StorageAdapter dedup |
| 6 | Grade resolution: entry.grade > metadata.grade > 9 | Fallback chain |
| 7 | Stops after ebayDailyLimit reached | Rate limit enforcement |
| 8 | No alert when price > targetPrice | Price threshold filter |

All 71 tests pass across 8 test files (no regressions).

## Known Type Errors (Expected)

`src/cli.ts` and `src/server.ts` fail typecheck with:
- `Expected 7 arguments, but got 6` — constructor now requires `StorageAdapter`
- FMV null handling not yet addressed in those files

These are intentional — fixed in Plan 08 (constructor call sites update).

## Deviations from Plan

None — plan executed exactly as written.

---

## Self-Check: PASSED

- [x] `src/scheduler/scan-scheduler.ts` exists and contains StorageAdapter
- [x] `src/scheduler/scan-scheduler.test.ts` exists with 8 tests (>100 lines)
- [x] Commit `31137e1` (test RED) exists
- [x] Commit `371e198` (feat GREEN) exists
- [x] All 71 tests pass
- [x] `storage.get` / `storage.set` pattern present in scan-scheduler.ts
- [x] `if (!fmv)` guard present in scanEntry()
