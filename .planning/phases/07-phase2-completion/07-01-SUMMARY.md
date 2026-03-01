---
phase: 07-phase2-completion
plan: "01"
subsystem: testing
tags: [eslint, typescript, dead-code, npm]

# Dependency graph
requires:
  - phase: 02-core-module-hardening
    provides: CardCandidate type, ConditionPrice interface, rawConfidence field, ebay-api dependency
provides:
  - Zero lint errors (ConditionPrice unused interface removed)
  - Clean CardCandidate type (rawConfidence dead field removed)
  - Trimmed dependency tree (ebay-api uninstalled)
affects: [all future phases using CardCandidate, any code that imports from types/index.ts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Remove dead interfaces before they accumulate — unused types cause lint failures and mislead readers"

key-files:
  created: []
  modified:
    - src/pricing/engine.ts
    - src/types/index.ts
    - src/card-resolver/resolver.ts
    - package.json
    - package-lock.json

key-decisions:
  - "Remove rawConfidence field entirely rather than deprecating — it was set but never read, gate uses adjusted confidence"
  - "Uninstall ebay-api rather than leaving as unused dep — EbayScanner uses native fetch with manual OAuth"

patterns-established:
  - "Dead code audit: interfaces defined but never used trigger no-unused-vars, must be removed promptly"

requirements-completed: [SCAN-03, SCAN-04, SCAN-05, WATCH-04]

# Metrics
duration: 2min
completed: 2026-02-19
---

# Phase 7 Plan 01: Dead Code Removal Summary

**Lint restored to zero errors by removing ConditionPrice unused interface, rawConfidence dead field on CardCandidate, and uninstalling the ebay-api package never imported in source**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-19T10:18:56Z
- **Completed:** 2026-02-19T10:21:17Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Removed `ConditionPrice` unused interface from `engine.ts` — restores `npm run lint` to zero errors
- Removed `rawConfidence` optional field from `CardCandidate` interface and its single assignment in `buildV2Candidates()` — eliminates misleading dead field (gate logic uses adjusted `confidence`, not raw)
- Uninstalled `ebay-api` npm package (35 packages removed) — `EbayScanner` uses native `fetch` with manual OAuth, never imported the library

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove ConditionPrice interface and rawConfidence dead code** - `78d400f` (fix)
2. **Task 2: Uninstall ebay-api npm package** - `9b42bf9` (chore)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/pricing/engine.ts` - Deleted `ConditionPrice` interface (lines 37-42)
- `src/types/index.ts` - Removed `rawConfidence?: number` field from `CardCandidate`
- `src/card-resolver/resolver.ts` - Removed `rawConfidence: matchConfidence` assignment in `buildV2Candidates()`
- `package.json` - `ebay-api` absent from dependencies
- `package-lock.json` - Updated after `npm uninstall ebay-api` (35 packages removed)

## Decisions Made

- Remove `rawConfidence` entirely rather than deprecating it. The field comment said "used by two-tier gate" but the gate code in `resolver.ts` uses adjusted `confidence`, not `rawConfidence`. Field was set once and never read anywhere.
- Uninstall `ebay-api` rather than leaving as transitive noise. `EbayScanner` implements OAuth and HTTP calls manually via native `fetch`; the library was never imported.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Lint gate is clean again (zero errors) — Phase 7 Plan 02 can proceed
- `CardCandidate` type is leaner; any future plans building on card resolution see the cleaned interface
- 74 tests pass, zero lint errors, zero typecheck errors

---
*Phase: 07-phase2-completion*
*Completed: 2026-02-19*
