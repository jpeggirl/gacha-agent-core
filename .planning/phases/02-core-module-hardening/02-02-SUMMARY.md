---
phase: 02-core-module-hardening
plan: 02
subsystem: card-resolver
tags: [msw, vitest, tdd, confidence-gate, card-resolution, pokemonpricetracker]

# Dependency graph
requires:
  - phase: 02-01
    provides: MSW test infrastructure (server.ts, vitest.setup.ts) and ResolveResult type with disambiguationReason
provides:
  - Two-tier confidence gate in CardResolver (AUTO_PROCEED_THRESHOLD=0.85, DISAMBIGUATE_THRESHOLD=0.70)
  - 8 MSW-mocked tests covering all confidence tiers and boundary conditions
  - rawConfidence field on CardCandidate for accurate gate decisions
  - console.error logging in catch block for API failure observability
affects: [02-03, 02-04, cli.ts, server.ts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD with MSW: Write failing tests mocking external API, implement minimal code to pass"
    - "rawConfidence separation: Store unmodified API matchScore separately from relevance-adjusted confidence to prevent ordering heuristics from polluting gate logic"

key-files:
  created:
    - src/card-resolver/resolver.test.ts
  modified:
    - src/card-resolver/resolver.ts
    - src/types/index.ts

key-decisions:
  - "rawConfidence field added to CardCandidate: relevance adjustments in buildV2Candidates inflate confidence scores for ordering, but the gate must use unmodified API matchScore to honor the 0.85/0.70 thresholds precisely"
  - "Gate reads bestCandidate?.rawConfidence ?? bestCandidate?.confidence: rawConfidence set on V2 candidates; legacy candidates fall back to confidence"

patterns-established:
  - "Gate on rawConfidence not adjusted confidence: relevance adjustments are for ranking only, never for binary gate decisions"
  - "console.error with [ClassName] prefix: error surfacing pattern for catch blocks in service classes"

requirements-completed:
  - CARD-01
  - CARD-02
  - CARD-03

# Metrics
duration: 3min
completed: 2026-02-18
---

# Phase 2 Plan 02: Two-Tier Confidence Gate Summary

**Two-tier card resolution gate using rawConfidence: 0.85+ auto-proceeds, 0.70-0.84 triggers disambiguation, below 0.70 fails cleanly**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-18T15:15:22Z
- **Completed:** 2026-02-18T15:18:18Z
- **Tasks:** 2 (RED + GREEN TDD cycle)
- **Files modified:** 3

## Accomplishments

- Replaced single `CONFIDENCE_THRESHOLD = 0.7` with `AUTO_PROCEED_THRESHOLD = 0.85` and `DISAMBIGUATE_THRESHOLD = 0.70`
- Added `rawConfidence` to `CardCandidate` — separates API matchScore from relevance-adjusted ordering score
- Gate in `resolve()` uses `rawConfidence` to ensure relevance boosts don't cause low-confidence cards to auto-proceed
- Improved catch block: `console.error('[CardResolver] Failed to resolve ...')` surfaces API failures instead of silently swallowing them
- 8 tests pass covering: high confidence (0.92), mid range (0.78), low (0.40), API 503 failure, empty matches, boundary at 0.85, boundary at 0.70, just below 0.70 (0.69)

## Task Commits

Each task was committed atomically:

1. **RED: Failing tests for two-tier confidence gate** - `b8d6fa9` (test)
2. **GREEN: Implement two-tier confidence gate** - `cacbf79` (feat)

_Note: TDD plan — RED commit for failing tests, GREEN commit for implementation_

## Files Created/Modified

- `src/card-resolver/resolver.ts` - Two-tier gate logic with rawConfidence, improved error logging
- `src/card-resolver/resolver.test.ts` - 8 MSW-mocked test cases covering all tiers and boundaries
- `src/types/index.ts` - `rawConfidence?: number` added to `CardCandidate` (optional, backward-compat)

## Decisions Made

- **rawConfidence separation:** The `computeRelevanceAdjustment` in `buildV2Candidates` inflates candidate confidence scores by up to +0.30 for ordering purposes. If the gate used the adjusted confidence, a card with API matchScore 0.78 could resolve as `success: true` (adjusted to ~1.0 for an exact name match). Adding `rawConfidence` to `CardCandidate` stores the unmodified API `matchScore` so the gate can enforce the thresholds precisely.
- **Fallback `?? confidence` in gate:** For legacy (v1 API) candidates, `rawConfidence` is not set. The gate falls back to `confidence`, which is correct since legacy responses don't have the same relevance adjustment inflation issue.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] rawConfidence field added to preserve unmodified API matchScore for gate decisions**
- **Found during:** GREEN phase — first test run after implementing gate
- **Issue:** `computeRelevanceAdjustment` adds up to +0.30 to candidate confidence for ordering. When query="Charizard" and candidate name="Charizard", the name-match (+0.12) and token-overlap (+0.18) boosts pushed a 0.78 matchScore to ~1.0, causing the gate to see 1.0 and auto-proceed instead of triggering disambiguation.
- **Fix:** Added `rawConfidence?: number` to `CardCandidate`, set to `matchConfidence` (clamped API matchScore) in `buildV2Candidates`. Updated `resolve()` gate to read `bestCandidate?.rawConfidence ?? bestCandidate?.confidence`.
- **Files modified:** `src/types/index.ts`, `src/card-resolver/resolver.ts`
- **Verification:** All 8 tests pass including boundary cases at 0.85, 0.70, and 0.69
- **Committed in:** `cacbf79` (GREEN implementation commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential fix — without it the gate logic would silently fail for any query where the card name appears in the search query (nearly all production usage). No scope creep.

## Issues Encountered

Pre-existing TypeScript errors in `src/cli.ts`, `src/server.ts`, and `src/scheduler/scan-scheduler.ts` related to `FairMarketValue | null` null safety — confirmed pre-existing before this plan. Logged to `deferred-items.md`. No new errors introduced by this plan's changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Two-tier confidence gate ready for use by CLI, server, and scheduler callers
- `needsDisambiguation: true` + `candidates[]` provides everything needed for disambiguation UX (Plan 03+)
- `disambiguationReason` string is human-readable and suitable for Telegram message formatting
- Pre-existing null safety issues in FMV callers should be resolved before production use (deferred)

---
*Phase: 02-core-module-hardening*
*Completed: 2026-02-18*
