---
phase: 02-core-module-hardening
plan: "06"
subsystem: alerts
tags: [grammy, telegram, throttler, dedup, storage, msw]

# Dependency graph
requires:
  - phase: 02-01
    provides: MSW test infrastructure, StorageAdapter type
  - phase: 02-04
    provides: JsonStorageAdapter with persistent storage patterns

provides:
  - Grammy-based TelegramAlerts with apiThrottler rate limiting
  - Persistent dedup via StorageAdapter (survives process restart)
  - Tests proving dedup persistence across instances
affects:
  - 02-07 (scan-scheduler uses TelegramAlerts — constructor signature changed)
  - 02-08 (cli.ts, server.ts callers must add storage argument)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "grammy Bot with apiThrottler transformer for outgoing-only Telegram sends"
    - "Lazy-load dedup keys from StorageAdapter on first use (ensureDedupLoaded pattern)"
    - "Persist dedup set to storage after each successful send"
    - "MSW regex pattern for wildcard bot token in Telegram API URL"

key-files:
  created:
    - src/alerts/telegram.test.ts
  modified:
    - src/alerts/telegram.ts

key-decisions:
  - "grammy Bot (not raw fetch) handles all Telegram HTTP — rate limiting via apiThrottler transformer"
  - "Dedup keys persisted to StorageAdapter as string[] under key 'alerts:sent-keys'"
  - "ensureDedupLoaded() lazy-loads on first sendDealAlert call — no async constructor needed"
  - "formatDealMessage() made public to enable direct test coverage"
  - "clearDedupeCache() is now async — clears both in-memory Set and StorageAdapter key"
  - "link_preview_options replaces deprecated disable_web_page_preview field"

patterns-established:
  - "Lazy dedup load: check dedupLoaded flag, load once, set flag — prevents repeated storage reads"
  - "MSW Telegram intercept: regex /https:\\/\\/api\\.telegram\\.org\\/bot.+\\/sendMessage/ handles dynamic bot tokens"

requirements-completed:
  - ALERT-01
  - ALERT-03
  - ALERT-04

# Metrics
duration: 4min
completed: 2026-02-18
---

# Phase 2 Plan 06: Telegram Alerts Hardening Summary

**Grammy Bot with apiThrottler replaces raw fetch for Telegram sends; dedup keys persisted to StorageAdapter so alerts survive process restarts**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-18T15:21:31Z
- **Completed:** 2026-02-18T15:25:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Replaced raw fetch Telegram calls with grammy `Bot.api.sendMessage()` — rate limiting via `apiThrottler` transformer (no more 429 errors)
- Dedup keys persisted to `StorageAdapter` under `alerts:sent-keys` — survive constructor restart (ALERT-03 fixed)
- 8 MSW-mocked tests proving dedup, cross-instance persistence, chatId isolation, message formatting, and error cases

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate TelegramAlerts to grammy Bot with throttler and persistent dedup** - `e2e455d` (feat)
2. **Task 2: Add tests for TelegramAlerts dedup persistence and formatting** - `8920049` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/alerts/telegram.ts` - Rewritten: grammy Bot, apiThrottler, StorageAdapter-backed dedup, async clearDedupeCache, public formatDealMessage
- `src/alerts/telegram.test.ts` - 8 tests: dedup, cross-instance persistence, chatId isolation, formatting, error cases

## Decisions Made

- **grammy Bot not raw fetch:** apiThrottler transformer handles Telegram rate limits transparently. Raw fetch had no rate limiting (ALERT-04).
- **Lazy-load dedup:** `ensureDedupLoaded()` loads keys from storage on first call — avoids async constructor, no overhead if never used.
- **formatDealMessage() made public:** Enables direct test coverage of formatting without coupling tests to full send flow.
- **clearDedupeCache() async:** Must delete storage key in addition to clearing in-memory Set — return type widened to `Promise<void>`.
- **link_preview_options over disable_web_page_preview:** `disable_web_page_preview` is deprecated in grammy's typed Telegram API.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- TelegramAlerts constructor now requires `(config, storage)` — callers in `cli.ts`, `server.ts`, and `scan-scheduler.ts` must be updated
- Plan 07 (scheduler) and Plan 08 (callers) will fix the expected typecheck errors flagged in `cli.ts` and `server.ts`
- Grammy Bot is outgoing-only (no `bot.start()`) — correct for alert-sending use case

## Self-Check: PASSED

- `src/alerts/telegram.ts` — FOUND
- `src/alerts/telegram.test.ts` — FOUND
- `.planning/phases/02-core-module-hardening/02-06-SUMMARY.md` — FOUND
- Commit `e2e455d` — FOUND
- Commit `8920049` — FOUND

---
*Phase: 02-core-module-hardening*
*Completed: 2026-02-18*
