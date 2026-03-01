# Roadmap: Gacha Agent

**Project:** Gacha Agent — Agentic Trading Card Platform
**Target:** OpenClaw skill MVP (gacha-agent-core shared library)
**Depth:** Standard (7 phases)
**Created:** 2026-02-18
**Coverage:** 31/31 v1 requirements mapped

---

## Phases

- [x] **Phase 1: Foundation and Tooling** - Clean dev environment with linting, testing, and library upgrades in place
- [x] **Phase 2: Core Module Hardening** - Production-reliable card resolution, pricing, scanning, scoring, watchlist, and alert deduplication
- [ ] **Phase 3: Bidirectional Telegram and BUY Command** - Telegram receives BUY replies with mandatory human confirmation gate before any purchase action
- [ ] **Phase 4: OpenClaw Skill Wrapper** - Skill published to ClawHub registry and invocable by OpenClaw agents via natural language
- [ ] **Phase 5: Purchase Execution (eBay Order API)** - End-to-end purchase flow from alert to confirmed eBay order placement
- [ ] **Phase 6: Post-Launch Hardening** - Testing infrastructure, simulation mode, and v1.x quality improvements
- [x] **Phase 7: Phase 2 Completion & Code Quality** - Integration gaps closed, lint clean, tracking corrected (gap closure from v1.0 audit) (completed 2026-02-19)

---

## Phase Details

### Phase 1: Foundation and Tooling
**Goal**: Development environment is clean and fast so all subsequent module work accumulates quality instead of debt
**Depends on**: Nothing (first phase)
**Requirements**: None (toolchain-only phase — no v1 requirement deliverables)
**Note**: eBay Order API Limited Release access application should be submitted in parallel during this phase. Apply immediately — 10+ business day approval timeline gates Phase 5.
**Success Criteria** (what must be TRUE):
  1. `npm run lint` passes with zero errors across all source files
  2. `npm test` runs with Vitest and all existing tests pass without warnings
  3. `grammy` and `ebay-api` are installed and importable (replacing hand-rolled fetch calls)
  4. `npm run typecheck` exits with zero TypeScript errors
**Plans:** 1 plan
Plans:
- [x] 01-01-PLAN.md — Install toolchain (ESLint, Vitest 4, grammy, ebay-api), configure linting, fix all lint errors

### Phase 2: Core Module Hardening
**Goal**: All core modules are production-reliable — errors are handled, state is persisted, and financial-critical logic gates are enforced
**Depends on**: Phase 1
**Requirements**: CARD-01, CARD-02, CARD-03, PRICE-01, PRICE-02, PRICE-03, SCORE-01, SCORE-02, SCORE-03, SCORE-04, SCAN-01, SCAN-02, SCAN-03, SCAN-04, SCAN-05, WATCH-01, WATCH-02, WATCH-03, WATCH-04, WATCH-05, ALERT-01, ALERT-03, ALERT-04
**Success Criteria** (what must be TRUE):
  1. User can resolve "Charizard Base Set holo PSA 10" to a canonical card identity; ambiguous queries surface ranked candidates with confidence scores; queries scoring 0.70-0.84 confidence prompt a disambiguation message instead of auto-proceeding
  2. FMV lookup for any resolved card returns price and population count, is cached for 30 minutes, and fails visibly (not silently) when the API is unavailable
  3. An eBay scan for a watchlist card returns scored listings with 0-100 score, signal classification, and human-readable reasoning; listings with seller feedback below 95% do not receive positive signals
  4. Watchlist survives process restart — entries added before a restart are present after restart; grade-specific entries (PSA 9 at $200 AND PSA 10 at $500 for the same card) are stored and retrieved correctly
  5. A deal alert sent before a process restart is not re-sent after restart; Telegram alerts respect rate limits and do not trigger 429 errors during burst sends
**Plans:** 8/8 plans complete
Plans:
- [x] 02-01-PLAN.md — Test infrastructure (MSW + vitest setup) and core type updates (grade field, disambiguationReason)
- [x] 02-02-PLAN.md — Card resolver two-tier confidence gate (TDD)
- [x] 02-03-PLAN.md — Price engine null-return error boundary (TDD)
- [x] 02-04-PLAN.md — Watchlist persistence, storage race fix, grade field support
- [x] 02-05-PLAN.md — Deal scorer thin-market downgrade and eBay scanner error boundary (TDD)
- [x] 02-06-PLAN.md — Telegram alerts migration to grammy + throttler + persistent dedup
- [x] 02-07-PLAN.md — Scheduler hardening: persistent sentAlertKeys, null FMV, grade fallback (TDD)
- [x] 02-08-PLAN.md — Integration wiring: update CLI and server callers for all Phase 2 changes

### Phase 3: Bidirectional Telegram and BUY Command
**Goal**: Telegram is a two-way channel — users receive deal alerts and can act on them, with a mandatory human confirmation step enforced architecturally
**Depends on**: Phase 2
**Requirements**: ALERT-02
**Success Criteria** (what must be TRUE):
  1. A deal alert message contains an inline "View on eBay" button that deep-links directly to the eBay listing
  2. When a user replies to a deal alert, the bot acknowledges the reply and presents a human confirmation step before any purchase action is taken
  3. The bot does not place any order without an explicit human confirmation — automated scheduled jobs cannot trigger order placement
  4. Telegram webhook or polling mode is running and receives messages reliably; retry behavior handles Telegram 429 rate limit responses without crashing
**Plans:** 3 plans
Plans:
- [ ] 03-01-PLAN.md — Inline keyboard on deal alerts + startPolling/stopPolling methods on TelegramAlerts
- [ ] 03-02-PLAN.md — Signal filter in ScanScheduler (strong_buy/buy only trigger alerts)
- [ ] 03-03-PLAN.md — Wire polling lifecycle into server.ts boot and shutdown

### Phase 4: OpenClaw Skill Wrapper
**Goal**: The Gacha Agent is discoverable and invocable in the OpenClaw ecosystem — users can trigger watchlist and scanning actions through natural language
**Depends on**: Phase 2, Phase 3
**Requirements**: SKILL-01, SKILL-02, SKILL-03, SKILL-04
**Research flag**: Needs `/gsd:research-phase` before planning — OpenClaw description trigger classification behavior is not fully specified and requires hands-on testing with real user phrasings before writing SKILL.md.
**Success Criteria** (what must be TRUE):
  1. SKILL.md manifest exists with description phrasing that matches how users naturally ask to track card deals (validated against 10+ real user phrasings)
  2. HTTP endpoints for watchlist management, scanning, and price checking are callable from the OpenClaw skill via curl and return correct responses
  3. Heartbeat and registration endpoints respond correctly, allowing OpenClaw agent lifecycle management to function
  4. Skill is listed in ClawHub registry and installable by OpenClaw community users
**Plans**: TBD

### Phase 5: Purchase Execution (eBay Order API)
**Goal**: Users can execute a confirmed Buy It Now purchase through the agent — from alert to eBay order placed — without leaving Telegram
**Depends on**: Phase 3, Phase 4, eBay Order API Limited Release approval
**Requirements**: (no new v1 requirements — this activates the BUY command built in Phase 3 with real Order API calls)
**Note**: This phase is gated on eBay Order API Limited Release written approval. If approval is not received by the time Phase 4 ships, the Phase 3 "View on eBay" deep-link remains the purchase path. Apply for access during Phase 1.
**Success Criteria** (what must be TRUE):
  1. After a user explicitly confirms a BUY in Telegram, the agent places a Buy It Now order via eBay Order API and sends a purchase confirmation message
  2. The agent never places an order without an explicit human confirmation message in the current session — scheduled scan jobs cannot trigger order placement
  3. A per-session spend limit is enforced — the agent declines to proceed if the order total exceeds the configured limit
  4. Failed order attempts (API error, insufficient funds, listing ended) result in a clear error message to the user, not a silent failure
**Plans**: TBD

### Phase 6: Post-Launch Hardening
**Goal**: The testing and simulation infrastructure is in place for ongoing tuning, and the system is resilient enough for continuous production operation
**Depends on**: Phase 2
**Requirements**: TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. Running `npm run test:live` from the CLI executes a full scan and scoring cycle against real APIs and outputs results to terminal
  2. Real eBay and pricing API responses can be saved to disk for later replay
  3. Saved API responses can be replayed without hitting live APIs, allowing deal scoring threshold tuning in isolation
**Plans**: TBD

### Phase 7: Phase 2 Completion & Code Quality
**Goal**: All Phase 2 integration gaps are closed and code quality is clean — lint passes, unused dependencies removed, stale tracking corrected
**Depends on**: Phase 2
**Requirements**: SCAN-03, SCAN-04, SCAN-05, WATCH-04
**Gap Closure:** Closes gaps from v1.0 audit (2026-02-19)
**Success Criteria** (what must be TRUE):
  1. `npm run lint` passes with zero errors (ConditionPrice unused interface removed)
  2. Server `/api/scan` runs via `ScanScheduler` for continuous scanning, not just one-shot (closes SCAN-03 server path gap)
  3. CLI has a `remove`/`unwatch` subcommand that removes watchlist entries (closes CLI integration gap)
  4. REQUIREMENTS.md checkboxes for SCAN-03, SCAN-04, SCAN-05, WATCH-04 are checked `[x]` and coverage count is accurate
  5. 02-07-SUMMARY.md `requirements-completed` frontmatter includes SCAN-03, SCAN-04, SCAN-05
  6. `ebay-api` npm package uninstalled (never imported — uses native fetch)
  7. Dead `rawConfidence` field removed from `CardCandidate` and all usages updated
**Plans:** 4/4 plans complete
Plans:
- [x] 07-01-PLAN.md — Remove ConditionPrice, rawConfidence dead code, uninstall ebay-api
- [x] 07-02-PLAN.md — Add CLI remove subcommand for watchlist entry removal
- [x] 07-03-PLAN.md — Wire ScanScheduler into server.ts for continuous background scanning
- [x] 07-04-PLAN.md — Update 02-07-SUMMARY frontmatter and REQUIREMENTS.md traceability

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and Tooling | 1/1 | Complete | 2026-02-18 |
| 2. Core Module Hardening | 8/8 | Complete    | 2026-02-19 |
| 3. Bidirectional Telegram and BUY Command | 0/3 | Not started | - |
| 4. OpenClaw Skill Wrapper | 0/? | Not started | - |
| 5. Purchase Execution (eBay Order API) | 0/? | Not started | - |
| 6. Post-Launch Hardening | 0/? | Not started | - |
| 7. Phase 2 Completion & Code Quality | 4/4 | Complete   | 2026-02-19 |

---

## Cross-Phase Backlog (Fomolt Learnings)

These items span multiple phases and should be planned as explicit tasks, not absorbed implicitly:

- [ ] Add a machine-readable API manifest endpoint (OpenAPI JSON or equivalent) for agent/tool interoperability.
- [ ] Standardize all API responses with one envelope and structured errors (`code`, `hint`, `docs`, optional recovery `links`).
- [ ] Add observability headers (`X-Request-Id`) and consistent rate-limit headers for bot-safe retries.
- [ ] Define API key lifecycle hardening (rotation, recovery, and revoked-key behavior) and document runbook.
- [ ] Add heartbeat contract for autonomous runtimes: service health + auth validity + scanner readiness checks.
- [ ] Preserve architecture rule: OpenClaw skill remains a thin client over HTTP/core modules; no duplicated scoring/pricing logic in wrappers.
- [ ] Publish split docs set (`intro`, `auth`, `skill`, `heartbeat`, `troubleshooting`) optimized for agent consumption.
- [ ] Add lightweight CLI surface (`gacha` command) that wraps existing endpoints for operator and agent workflows.

---

## Coverage Map

| Requirement | Phase |
|-------------|-------|
| CARD-01 | Phase 2 |
| CARD-02 | Phase 2 |
| CARD-03 | Phase 2 |
| PRICE-01 | Phase 2 |
| PRICE-02 | Phase 2 |
| PRICE-03 | Phase 2 |
| SCORE-01 | Phase 2 |
| SCORE-02 | Phase 2 |
| SCORE-03 | Phase 2 |
| SCORE-04 | Phase 2 |
| SCAN-01 | Phase 2 |
| SCAN-02 | Phase 2 |
| SCAN-03 | Phase 7 |
| SCAN-04 | Phase 7 |
| SCAN-05 | Phase 7 |
| WATCH-01 | Phase 2 |
| WATCH-02 | Phase 2 |
| WATCH-03 | Phase 2 |
| WATCH-04 | Phase 7 |
| WATCH-05 | Phase 2 |
| ALERT-01 | Phase 2 |
| ALERT-02 | Phase 3 |
| ALERT-03 | Phase 2 |
| ALERT-04 | Phase 2 |
| TEST-01 | Phase 6 |
| TEST-02 | Phase 6 |
| TEST-03 | Phase 6 |
| SKILL-01 | Phase 4 |
| SKILL-02 | Phase 4 |
| SKILL-03 | Phase 4 |
| SKILL-04 | Phase 4 |

**Coverage: 31/31 v1 requirements mapped. No orphans.**

---
*Roadmap created: 2026-02-18*
*Next: `/gsd:plan-phase 1`*
