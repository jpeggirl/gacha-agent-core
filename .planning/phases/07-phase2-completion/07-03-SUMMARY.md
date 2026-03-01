---
phase: 07-phase2-completion
plan: "03"
subsystem: scheduler
tags: [scan-scheduler, telegram, server, lifecycle, background-scanning]

# Dependency graph
requires:
  - phase: 07-phase2-completion
    provides: "ScanScheduler (P07-07), TelegramAlerts (P07-06), all Phase 2 modules hardened"
provides:
  - "server.ts boots with ScanScheduler running continuously when eBay + Telegram credentials present"
  - "SIGINT/SIGTERM graceful shutdown (scheduler.stop() before process.exit)"
  - "telegram config block in server loadConfig()"
affects: [phase3-bidirectional-telegram, phase4-openclaw-skill-wrapper]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional scheduler instantiation gated on dual-credential check (ebay && telegram)"
    - "Process signal handlers for graceful shutdown using optional chaining scheduler?.stop()"

key-files:
  created: []
  modified:
    - src/server.ts

key-decisions:
  - "Scheduler not started is logged (not silently skipped) so operators know when it is inactive"
  - "Non-null assertion scanner! is safe because scanner is always set when config.ebay is truthy"
  - "shutdown handler placed after server.listen() so port is always cleaned up"

patterns-established:
  - "Server process lifecycle: boot -> start background workers -> listen -> signal handlers"
  - "Dual-credential guard (ebay && telegram) before instantiating scan/alert stack"

requirements-completed: [SCAN-03, SCAN-04, SCAN-05]

# Metrics
duration: 2min
completed: 2026-02-19
---

# Phase 7 Plan 03: Server Scheduler Wiring Summary

**ScanScheduler wired into server.ts boot with telegram config, conditional start, and SIGINT/SIGTERM graceful shutdown**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-19T10:23:28Z
- **Completed:** 2026-02-19T10:24:40Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `TelegramAlerts` and `ScanScheduler` imports to server.ts
- Added `telegram` config block to `loadConfig()` reading `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
- Instantiates `ScanScheduler` in `main()` when both eBay and Telegram credentials present, calls `scheduler.start()`
- Added `shutdown` function with `scheduler?.stop()` + `server.close()`, registered on SIGINT and SIGTERM
- POST `/api/scan` contract unchanged — one-shot on-demand scanning still works independently

## Task Commits

Each task was committed atomically:

1. **Task 1: Add TelegramAlerts and ScanScheduler to server.ts** - `726b3eb` (feat)

**Plan metadata:** `58c2534` (docs: complete server scheduler wiring plan)

## Files Created/Modified
- `src/server.ts` - Added TelegramAlerts/ScanScheduler imports, telegram config block, scheduler instantiation, graceful shutdown handlers

## Decisions Made
- Scheduler not started path logs a message so server operators see why background scanning is inactive
- Non-null assertion `scanner!` used in ScanScheduler constructor because scanner is always non-null when `config.ebay` is set (enforced by the outer conditional)
- Shutdown handler placed after `server.listen()` call, consistent with Node HTTP server patterns

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Typecheck exited 0, all 74 tests passed on first run.

## User Setup Required

To enable background scanning, operators must set both:
- `EBAY_APP_ID` + `EBAY_CERT_ID` (existing)
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (newly required by this plan)

Without both, the server still starts and all HTTP endpoints work; the scheduler simply does not run (logged at boot).

## Next Phase Readiness
- SCAN-03, SCAN-04, SCAN-05 requirements closed
- Phase 7 (gap closure) complete: dead code removed, CLI remove command added, server scheduler wired
- Ready to proceed to Phase 3 (Bidirectional Telegram)

## Self-Check: PASSED

- `src/server.ts` — FOUND
- `07-03-SUMMARY.md` — FOUND
- Commit `726b3eb` (feat: ScanScheduler wired) — FOUND
- Commit `58c2534` (docs: plan complete) — FOUND

---
*Phase: 07-phase2-completion*
*Completed: 2026-02-19*
