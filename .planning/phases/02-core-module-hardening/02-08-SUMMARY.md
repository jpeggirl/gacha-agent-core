---
phase: 02-core-module-hardening
plan: "08"
subsystem: cli
tags: [cli, server, integration, disambiguation, grade, null-fmv, constructors]

dependency_graph:
  requires:
    - 02-02  # CardResolver disambiguationReason field
    - 02-03  # PriceEngine getFMV null-return
    - 02-06  # TelegramAlerts StorageAdapter constructor
    - 02-07  # ScanScheduler StorageAdapter constructor
  provides:
    - Zero-error integration of all Phase 2 module changes into cli.ts and server.ts
    - CLI shows disambiguationReason in resolve command
    - CLI passes explicit grade to watchlist entries
    - CLI and server handle null FMV from PriceEngine without crashing
    - TelegramAlerts and ScanScheduler receive StorageAdapter in CLI and server
  affects:
    - Phase 3 (all callers wired correctly — scheduler, alerts, CLI all integrated)

tech-stack:
  added: []
  patterns:
    - Null-check guard over try/catch for getFMV null-return (consistent across CLI and server)
    - Spread result then explicitly include disambiguationReason in server JSON response
    - Grade parsed from CLI args via regex before watchlist.add()

key-files:
  created: []
  modified:
    - src/cli.ts
    - src/server.ts
    - src/alerts/telegram.test.ts
    - src/scheduler/scan-scheduler.test.ts

key-decisions:
  - "Price command in CLI uses null-check guard (not try/catch) matching getFMV null semantics"
  - "Server scan endpoint: null FMV returns unscored listings rather than 502, preserving useful data"
  - "Server price endpoint: null FMV returns 502 since no data means the response has no value"
  - "Watch command grade parsed from args with /\\bpsa\\s*(\\d+)\\b/i regex — PSA N pattern"

patterns-established:
  - "Null-return pattern: if (!fmv) { handle } rather than try/catch for getFMV"
  - "Grade resolution chain: entry.grade ?? metadata?.grade ?? default"

requirements-completed: [CARD-01, CARD-02, CARD-03, WATCH-01, WATCH-02, WATCH-03, WATCH-04, WATCH-05]

duration: 2min
completed: "2026-02-19"
---

# Phase 2 Plan 08: Caller Integration Summary

**CLI and server wired to Phase 2 module changes: disambiguation reason surfaced, grade stored explicitly, null FMV handled gracefully, and both TelegramAlerts and ScanScheduler receive StorageAdapter.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-19T12:14:22Z
- **Completed:** 2026-02-19T12:16:31Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `src/cli.ts`: resolve shows `disambiguationReason`, watch parses PSA grade from args, scan uses null-check guard for FMV, run passes `storage` to both `TelegramAlerts` and `ScanScheduler`
- `src/server.ts`: resolve endpoint includes `disambiguationReason` in JSON, price endpoint returns 502 on null FMV, scan endpoint returns unscored listings on null FMV, watch endpoint passes grade field directly
- Two pre-existing lint errors in test files auto-fixed (unused import `beforeEach` and unused function `makeSendMessageHandler`)
- Zero typecheck errors, zero lint errors, 71/71 tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Update CLI for new constructor signatures, disambiguation, grade, and null FMV** - `3d326a8` (feat)
2. **Task 2: Update server and barrel exports for new signatures and fields** - `3175e21` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified

- `src/cli.ts` - Resolve shows disambiguationReason; price/scan handle null FMV; watch parses grade; run passes storage to TelegramAlerts and ScanScheduler
- `src/server.ts` - Resolve JSON includes disambiguationReason; price returns 502 on null FMV; scan uses null-check instead of try/catch; watch passes grade field
- `src/alerts/telegram.test.ts` - Removed unused `makeSendMessageHandler` function (lint fix)
- `src/scheduler/scan-scheduler.test.ts` - Removed unused `beforeEach` import (lint fix)

## Decisions Made

- Price endpoint in CLI uses early `break` (not `continue`) since it's a case block — equivalent semantics, matches existing code style
- Server scan endpoint returns unscored listings on null FMV (not 502) — gives caller raw data when pricing unavailable; server price endpoint returns 502 (no data = no value)
- `src/index.ts` required no changes — all types already exported, no new InMemoryStorage class in production code

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused `makeSendMessageHandler` function in telegram.test.ts**
- **Found during:** Task 2 (npm run lint)
- **Issue:** Function defined on line 95 but replaced by `telegramHandler` — caused lint error
- **Fix:** Removed the unused `makeSendMessageHandler` function block
- **Files modified:** `src/alerts/telegram.test.ts`
- **Verification:** `npm run lint` exits 0
- **Committed in:** `3175e21` (Task 2 commit)

**2. [Rule 1 - Bug] Removed unused `beforeEach` import in scan-scheduler.test.ts**
- **Found during:** Task 2 (npm run lint)
- **Issue:** `beforeEach` imported from vitest but never used in the file
- **Fix:** Removed `beforeEach` from the vitest import statement
- **Files modified:** `src/scheduler/scan-scheduler.test.ts`
- **Verification:** `npm run lint` exits 0
- **Committed in:** `3175e21` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — pre-existing lint bugs in test files)
**Impact on plan:** Necessary for `npm run lint` success criterion. No scope creep.

## Issues Encountered

None — typecheck errors were exactly as documented in Plan 07 SUMMARY (7 errors in cli.ts and server.ts). Fixed in the order they appeared.

## Next Phase Readiness

- Phase 2 complete: all 8 plans executed, zero type errors, 71 tests passing, zero lint errors
- All Phase 2 requirements (CARD-01..03, WATCH-01..05) delivered
- Ready for Phase 3: Bidirectional Telegram (bidirectional commands, watchlist management via Telegram)

---
*Phase: 02-core-module-hardening*
*Completed: 2026-02-19*
