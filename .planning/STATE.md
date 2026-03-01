# Project State: Gacha Agent

**Last updated:** 2026-02-19
**Session:** Phase 7 plan 04 execution (final plan — Phase 7 complete)

---

## Project Reference

**Core value:** The agent eliminates the tedious work of manually searching, comparing, and sniping card deals — users set what they want and the agent handles the rest.

**Current focus:** Phase 2 — Core Module Hardening

**Repository:** gacha-agent-core (shared library powering OpenClaw skill and future Gacha App)

---

## Current Position

**Active phase:** Phase 3 — Bidirectional Telegram
**Active plan:** Plan 1 of N
**Status:** Milestone complete

**Progress:**
[██████████] 100%
[##########] Phase 1: Foundation and Tooling       — Complete (1/1 plans)
[##########] Phase 2: Core Module Hardening        — Complete (8/8 plans)
[          ] Phase 3: Bidirectional Telegram       — Not started
[          ] Phase 4: OpenClaw Skill Wrapper       — Not started
[          ] Phase 5: Purchase Execution           — Not started
[          ] Phase 6: Post-Launch Hardening        — Not started

Overall: 1/6 phases complete (Phase 2 in progress)
```

---

## Performance Metrics

- Phases complete: 1/6
- Requirements delivered: 0/31 (WATCH-04, PRICE-03 infrastructure laid in 02-01; full delivery in later plans)
- Plans complete: 2

---

## Accumulated Context

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| 6-phase structure derived from research | Forced by technical dependencies (types before modules, modules before scheduler, scheduler before skill) and risk sequencing |
| Phase 2 absorbs 23/31 requirements | Core modules (card, price, score, scan, watch, alert) are tightly coupled and must be hardened as a unit before wrapping |
| Phase 5 gated on eBay Order API approval | Limited Release API requires written eBay approval (10+ days) — apply in Phase 1 as parallel track |
| TEST-01 assigned to Phase 6, not Phase 1 | CLI test mode is useful for tuning post-hardening; the scaffolding is already in the existing CLI |
| Phase 4 flagged for research-phase | OpenClaw description trigger classification is not fully specified — needs hands-on testing before writing SKILL.md |
| Pin @eslint/js to ^9, not latest | @eslint/js@10+ requires ESLint 10, conflicts with ESLint 9 — pin to ^9 for compatible versions |
| Use eslint.config.mjs extension (not .js) | package.json has no "type: module"; .js would be treated as CJS and fail ESM import syntax |
| Configure argsIgnorePattern: ^_ in no-unused-vars | Allows _param convention for unused-but-required function parameters without disabling the rule |
| MSW onUnhandledRequest: 'error' over 'warn' | Financial domain requires explicit HTTP contracts in tests; silent live API calls are a reliability hazard |
| metadata preserved on WatchlistEntry | Removing it breaks backward compat with persisted data; grade field takes precedence when present, callers fall back to metadata?.grade |
| disambiguationReason added to ResolveResult | Surfaces two-tier gate rationale (0.85+ auto, 0.70-0.84 disambiguate) — implemented in Plan 02 |
| rawConfidence removed from CardCandidate (07-01) | Field was set but never read; gate uses adjusted confidence; removing restores lint cleanliness |
| ebay-api uninstalled (07-01) | EbayScanner uses native fetch with manual OAuth; library was never imported in any source file |
| PriceEngine getFMV null-return over throw | Propagated errors stop the scheduler loop; null lets callers skip FMV-dependent steps gracefully |
| fetchPsaPricing still throws HTTP errors | getFMV catches at the boundary, keeping network logic separate from business-level null semantics |
| Use loadingPromise in ensureLoaded() to share single Promise across concurrent callers | Prevents multiple parallel file reads and cache corruption in JsonStorageAdapter |
| Restart persistence test creates two separate JsonStorageAdapter instances on same temp directory | Proves real disk persistence, not just in-memory state |
| grammy Bot with apiThrottler replaces raw fetch for Telegram sends | Rate limiting via transformer prevents 429 errors (ALERT-04 fixed) |
| Dedup keys persisted to StorageAdapter as string[] under 'alerts:sent-keys' | Survive process restart — in-memory Set was lost on restart (ALERT-03 fixed) |
| clearDedupeCache() now async (Promise<void>) | Must delete both in-memory Set and StorageAdapter key; async signature required |
| StorageAdapter injected into ScanScheduler constructor | Mirrors TelegramAlerts pattern; enables testability with InMemoryStorage and persistent sentAlertKeys across restarts |
| Null FMV skips scoring AND marks entry scanned | Prevents infinite retry loop on cards with no price data; entry treated as "processed" when FMV unavailable |
| Server scan returns unscored listings on null FMV | Preserves useful raw listing data for caller; server price returns 502 (null FMV means no value to return) |
| CLI watch parses grade via /\bpsa\s*(\d+)\b/i regex | Allows "PSA 10" or "psa9" patterns in args; passes explicit grade field to watchlist.add() |
| Storage key 'scheduler:sent-alert-keys' | Namespaced separately from 'alerts:sent-keys' (TelegramAlerts) to avoid collision |
| CLI remove uses UUID identifier + exit(1) on not-found | Consistent with server DELETE /api/watchlist/:id; silent no-op would hide typos on UUID strings |
| Non-null assertion scanner! safe in ScanScheduler constructor | scanner is always set when config.ebay is truthy; outer conditional enforces this invariant |
| SIGINT/SIGTERM shutdown uses scheduler?.stop() optional chaining | Gracefully handles case where scheduler was not started (no eBay/Telegram credentials) |
| Phase 02-core-module-hardening P02 | 3 | 2 tasks | 3 files |
| Phase 02-core-module-hardening P06 | 4 | 2 tasks | 2 files |
| Phase 02-core-module-hardening P05 | 15 | 1 tasks | 2 files |
| Phase 02-core-module-hardening P07 | 2 | 2 tasks | 2 files |
| Phase 02-core-module-hardening P08 | 2 | 2 tasks | 4 files |
| Phase 07-phase2-completion P02 | 5 | 1 tasks | 1 files |
| Phase 07-phase2-completion P01 | 101 | 2 tasks | 5 files |
| Phase 07-phase2-completion P03 | 2 | 1 tasks | 1 files |
| Phase 07-phase2-completion P03 | 2 | 1 tasks | 1 files |
| Phase 07-phase2-completion P04 | 3 | 2 tasks | 3 files |

### Critical Constraints

- **eBay ToS (Feb 20, 2026):** LLM-driven automated purchasing banned. Human confirmation gate is architecturally mandatory — not optional.
- **eBay Order API:** Limited Release, requires written approval. Apply during Phase 1. Phase 5 is conditional on approval.
- **PokemonPriceTracker:** Single source for card resolution AND FMV. Free tier: 100 calls/day. This is tight for production.
- **eBay Browse API:** 5,000 calls/day. At 50 watchlist items + 15-min intervals = ~4,800 calls/day. Rate budget monitoring is required.

### Known Risks

- In-memory dedup state lost on restart (fix in Phase 2: persist `sentAlertKeys` via StorageAdapter)
- Card confidence threshold 0.70 too permissive for financial decisions (fix in Phase 2: two-tier gate — 0.85+ auto-proceed, 0.70-0.84 disambiguate)
- Thin FMV market (pop < 5) can produce wrong deal signals — FIXED in Plan 05: thin-market downgrade active, strong_buy->buy and buy->fair when prices.length < 5
- OpenClaw SKILL.md description phrasing must match user natural language or skill is silently skipped (mitigate in Phase 4: test 10 real phrasings)

### Blockers

- None currently. Phase 1 can begin immediately.
- Phase 5 is blocked pending eBay Order API Limited Release approval — apply during Phase 1.

### Todos

- [ ] Apply for eBay Order API Limited Release access (do this at Phase 1 start — 10+ day lead time)
- [ ] Verify PokemonPriceTracker rate limit tier and SLA before Phase 2 planning
- [ ] Run `/gsd:research-phase 4` before planning Phase 4 (OpenClaw skill trigger classification)
- [ ] Create machine-readable API spec endpoint and pin as integration contract for OpenClaw/CLI clients
- [ ] Standardize response/error envelope across server routes (`success/response`, `error.code/hint/docs/links`)
- [ ] Add request tracing (`X-Request-Id`) and rate-limit headers across all API responses
- [ ] Add heartbeat endpoint/check contract for autonomous clients (service reachability + auth validity + scanner readiness)
- [ ] Define and document API key lifecycle policy (rotation, recovery, revoked-key handling)
- [ ] Keep OpenClaw wrapper thin: no business logic duplication outside core modules and HTTP server
- [ ] Add split agent docs set (`intro`, `auth`, `skill`, `heartbeat`, `troubleshooting`) for prompt-friendly consumption
- [ ] Add minimal `gacha` CLI wrapper for operator and agent tool-use parity

---

## Session Continuity

### To resume this project

1. Read `/planning/PROJECT.md` for core context
2. Read `/planning/ROADMAP.md` for phase structure and success criteria
3. Read this STATE.md for current position and decisions
4. Run `/gsd:plan-phase [N]` for the current active phase

### What was done this session

- Project initialized via `/gsd:new-project`
- PROJECT.md and REQUIREMENTS.md written (31 v1 requirements)
- Research completed (SUMMARY.md, STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md)
- ROADMAP.md created with 6 phases, 31/31 requirements mapped
- STATE.md initialized (this file)
- REQUIREMENTS.md traceability table updated
- Phase 1 Plan 01 executed: ESLint 9 flat config, Vitest 4 upgrade, grammy/ebay-api installed, typecheck script added, zero lint errors
- Phase 2 Plan 01 executed: MSW 2.x test infrastructure (src/mocks/server.ts, vitest.setup.ts), vitest.config.ts updated with setupFiles, WatchlistEntry/CreateWatchlistInput types extended with grade field, ResolveResult extended with disambiguationReason
- Phase 2 Plan 02 executed: Two-tier confidence gate in CardResolver (AUTO_PROCEED_THRESHOLD=0.85, DISAMBIGUATE_THRESHOLD=0.70), rawConfidence field on CardCandidate, console.error logging in catch block, 8 MSW-mocked tests covering all tiers and boundaries
- Phase 2 Plan 03 executed: PriceEngine.getFMV() null-return error boundary, 7 MSW-backed tests (TDD RED/GREEN), return type widened to FairMarketValue | null
- Phase 2 Plan 04 executed: JsonStorageAdapter race condition fixed (loadingPromise pattern), restart persistence integration test, WatchlistManager grade field storage, grade-specific/atomicity/filter tests
- Phase 2 Plan 06 executed: TelegramAlerts migrated to grammy Bot with apiThrottler, dedup persisted to StorageAdapter, 8 MSW-mocked tests for dedup persistence across instances
- Phase 2 Plan 05 executed: DealScorer thin-market signal downgrade (strong_buy->buy, buy->fair when prices.length < 5), EbayScanner error boundary (try/catch in scan(), returns empty ScanResult), 25 tests passing
- Phase 2 Plan 07 executed: ScanScheduler hardened with StorageAdapter injection, persistent sentAlertKeys, null FMV guard, grade resolution fallback chain (entry.grade > metadata.grade > 9), 8 tests passing
- Phase 2 Plan 08 executed: CLI and server wired to Phase 2 module changes — disambiguationReason surfaced, grade stored explicitly, null FMV handled gracefully, TelegramAlerts and ScanScheduler receive StorageAdapter; zero typecheck errors, 71 tests passing, zero lint errors
- Phase 7 Plan 01 executed: ConditionPrice unused interface removed from engine.ts, rawConfidence dead field removed from CardCandidate and resolver.ts, ebay-api uninstalled; lint 0 errors, typecheck 0 errors, 74 tests passing
- Phase 7 Plan 02 executed: CLI remove subcommand added (case 'remove' in switch, UUID arg, not-found exits 1, help text updated); WATCH-04 closed; 74 tests passing, typecheck clean
- Phase 7 Plan 03 executed: ScanScheduler wired into server.ts boot — telegram config added to loadConfig(), scheduler.start() called when eBay + Telegram credentials present, SIGINT/SIGTERM graceful shutdown; SCAN-03/04/05 closed; 74 tests passing, typecheck clean
- Phase 7 Plan 04 executed: 02-07-SUMMARY.md requirements-completed frontmatter added (SCAN-03/04/05), REQUIREMENTS.md footnote updated, ROADMAP.md Phase 7 progress updated to 4/4 Complete; Phase 7 fully closed
- Stopped at: Completed 07-phase2-completion-04-PLAN.md (Phase 7 fully complete — 4/4 plans)

---
*State initialized: 2026-02-18*
