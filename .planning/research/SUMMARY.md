# Project Research Summary

**Project:** Gacha Agent — agentic Pokémon card marketplace scanner
**Domain:** Agentic trading card buying platform / OpenClaw skill
**Researched:** 2026-02-18
**Confidence:** MEDIUM-HIGH

## Executive Summary

Gacha Agent is a TypeScript-based agentic commerce product that monitors eBay for underpriced PSA-graded Pokémon cards, scores deals against fair market value, and delivers Telegram alerts that let a human confirm a purchase with one tap. The codebase already contains all core modules (CardResolver, PriceEngine, EbayScanner, DealScorer, TelegramAlerts, WatchlistManager, ScanScheduler, HTTP server, CLI) but they are prototype-quality: in-memory state is not persisted, the Telegram bot is outbound-only, and the eBay integration uses hand-rolled fetch calls with no typed SDK. The OpenClaw skill wrapper — the viral distribution vehicle targeting 145k+ community users — does not yet exist. The recommended approach is to harden the existing core modules first, then build the OpenClaw skill as a thin HTTP client over the server, and defer purchase execution until eBay Order API approval is in hand.

The competitive landscape has a genuine gap: no tool combines FMV-aware deal scoring, watchlist-driven scanning, Telegram reply-to-buy UX, and AI natural language card resolution. Gacha Agent is uniquely positioned to fill this gap, and the OpenClaw skill distribution channel is the fastest path to early validation without app store launches or paid marketing. The critical constraint is eBay's User Agreement update (effective February 20, 2026) that explicitly bans LLM-driven automated purchasing — any purchase flow must include a mandatory human confirmation step. This is not optional and is already the stated design intent ("agent alerts, human confirms"), but it must be enforced architecturally, not just documented.

The highest-risk areas are: (1) eBay's new ToS on automated purchasing must gate any BUY command execution; (2) in-memory deduplication state must be persisted before the first production deploy to prevent duplicate Telegram alert floods on restart; (3) card confidence thresholds need a second disambiguation tier (0.70-0.84 = ask user, not auto-proceed) because a wrong card resolution cascades into a financial mistake; and (4) the eBay Order API is a "Limited Release" API requiring written eBay approval — apply immediately as it is on the critical path for purchase execution.

---

## Key Findings

### Recommended Stack

The existing TypeScript / Node.js 18+ / tsx / Vitest / dotenv foundation is correct and should not change. Two library additions are needed to replace hand-rolled fetch calls: `grammy` (v1.40.0) replaces the raw Telegram fetch calls and adds inline keyboard support needed for the "BUY" button; `ebay-api` (v9.4.2) replaces the hand-rolled eBay Browse API calls with a typed, maintained client. Zod v3 is sufficient for the MVP — upgrade to v4 only when TypeScript is simultaneously upgraded to 5.5+. Storage stays as JSON flat-file for the OpenClaw skill MVP; `better-sqlite3` becomes relevant at 100+ watchlist entries or multi-user load.

**Core technologies:**
- TypeScript 5.3+ / Node.js 18+: Primary language and runtime — already in place, no change
- `grammy` v1.40.0: Replace hand-rolled Telegram fetch — adds inline keyboards for "BUY" button UX
- `ebay-api` v9.4.2: Replace hand-rolled eBay Browse API fetch — typed client, actively maintained
- Zod v3: Runtime validation at API ingress — hold on v4 until TS is upgraded to 5.5+
- `tsx` + Vitest 3.x: Dev runner and test framework — upgrade Vitest from current 1.2 to avoid deprecated workspace config
- JSON flat-file + `StorageAdapter` interface: Persistence for MVP — interface means SQLite/Supabase swap is a 1-file change

**Critical constraint:** eBay Buy Order API is "Limited Release" — requires eBay business unit written approval. Apply immediately. Without it, "BUY" must deep-link to eBay's own checkout UI.

See [STACK.md](.planning/research/STACK.md) for full alternatives analysis and version compatibility matrix.

### Expected Features

The market has no competitor combining deal scoring, natural language card resolution, and Telegram reply-to-buy in one tool. All core capabilities exist in prototype form; the gaps are purchase execution (eBay Order API approval required) and bidirectional Telegram (currently outbound-only).

**Must have for OpenClaw skill launch (table stakes):**
- Watchlist CRUD via OpenClaw tool calls — users add cards by name and target price
- Card resolution (hardened) — natural language to canonical card; wrong resolution = financial mistake
- FMV pricing (hardened) — single-source acceptable; must not fail silently
- eBay scan and deal scoring (hardened) — end-to-end pipeline must handle errors gracefully
- Telegram deal alerts (hardened) — rich formatted message with dedup working and "View on eBay" link
- BUY command receiver — Telegram receives reply, gets human confirmation, triggers purchase (or deep-link fallback while Order API approval is pending)
- OpenClaw SKILL.md — the skill file with correct description trigger phrasing

**Should have post-launch (differentiators):**
- Grade-specific watchlist targeting — "PSA 9 under $200 AND PSA 10 under $500 for same card"
- Purchase history / audit log — essential for user trust after first real purchase
- Multiple FMV sources — reduces false positives; adds trust signal for power users
- Auction snipe execution — Collector Crypt's core feature, significant differentiator if Order API approved
- Watchlist management via Telegram commands — lowers friction for non-OpenClaw users

**Defer to v2+ (post product-market fit):**
- Portfolio P&L tracking — relevant for hosted Gacha App (Track 2), not OpenClaw skill
- SNKRDUNK / Japanese market scanning — high complexity, high reward, valid only for sophisticated users
- TCGPlayer scanning — increases inventory coverage but adds card identity mapping complexity
- AI price prediction — requires price history time series; interesting but not core
- Budget caps and auto-buy thresholds — only safe after proven track record

**Anti-features to avoid:** Fully autonomous buying (no confirmation), sub-minute scan intervals (5,000 eBay call/day limit), bulk auto-buying, image-based card recognition, mobile app (Telegram is the mobile interface).

See [FEATURES.md](.planning/research/FEATURES.md) for full competitive landscape and feature dependency graph.

### Architecture Approach

The architecture is a well-structured single-process Node.js application with clear module boundaries and a dependency injection pattern throughout. All domain logic lives in the core library (`gacha-agent-core/src/`); two entry points (`server.ts` for HTTP/OpenClaw, `cli.ts` for standalone) instantiate the same classes. The `StorageAdapter` interface decouples persistence from modules — `JsonStorageAdapter` for MVP, `SupabaseStorageAdapter` for the future hosted service. The OpenClaw skill is a pure HTTP client (markdown only, no TypeScript) that calls the HTTP server.

**Major components:**
1. `CardResolver` — natural language query to canonical `ResolvedCard` via PokemonPriceTracker parse-title API; confidence-gated to prevent wrong-card financial mistakes
2. `PriceEngine` — fetches FMV for a resolved card at a given PSA grade; 30-minute in-memory cache guards rate limits
3. `EbayScanner` — searches eBay Browse API for active graded card listings; manages OAuth2 client credentials token lifecycle
4. `DealScorer` — stateless pure function scoring listings against FMV (60% price vs FMV, 15% seller reputation, 10% listing type, 15% population rarity)
5. `TelegramAlerts` — formats `ScoredDeal` into human-readable Telegram message; currently outbound-only, needs bidirectional receiver for BUY command
6. `WatchlistManager` — CRUD over `WatchlistEntry` records via `StorageAdapter`; tracks `lastScannedAt` for scheduling
7. `ScanScheduler` — orchestrates full scan pipeline every 15 minutes; manages eBay 5K/day and pricing 100/day rate budgets; in-memory dedup (needs persistence hardening)
8. HTTP Server (`server.ts`) — REST API entry point for OpenClaw skill and hosted service; Bearer token auth per agent
9. OpenClaw Skill (`gacha-openclaw-skill/`) — markdown `SKILL.md` + `heartbeat.md` + `register.md`; agent reads and calls HTTP server via curl; no TypeScript

**Key patterns:** Dependency injection via constructor throughout; `StorageAdapter` interface for backend portability; poll-based scanning with in-memory rate budget; OpenClaw skill as pure HTTP client with remote backend; confidence-gated disambiguation before watchlist add.

See [ARCHITECTURE.md](.planning/research/ARCHITECTURE.md) for full data flow diagrams and scaling considerations.

### Critical Pitfalls

1. **eBay bans LLM-driven automated purchasing (effective Feb 20, 2026)** — Any purchase execution without a mandatory human confirmation step violates eBay's User Agreement and risks permanent account suspension. Architecture must enforce: agent alerts → user reviews → user explicitly triggers purchase. No automated Order API calls from scheduled jobs, ever.

2. **In-memory dedup state lost on restart causes duplicate alert floods** — `sentAlertKeys` and `TelegramAlerts.sentAlerts` are both in-memory Sets that reset on process restart. Every previously-seen deal re-alerts. Fix: persist sent-alert keys to `StorageAdapter` with a 7-day TTL before production deploy.

3. **Thin-market FMV data causes wrong deal signal** — For low-population PSA cards (pop < 50), FMV may be backed by 1-3 sales. A single outlier shifts the median 30-50%. Fix: surface `prices.length` in alerts; downgrade signal one level when fewer than 5 price points.

4. **Card disambiguation failure — wrong card purchased** — Confidence threshold 0.70 is too permissive for financial decisions. At 0.71 the system auto-proceeds; a wrong card match means alerts (and potential purchases) for the wrong card. Fix: add second tier — 0.85+ auto-proceeds, 0.70-0.84 sends Telegram disambiguation prompt before watchlist add.

5. **OpenClaw skill never invoked due to description mismatch** — OpenClaw uses the SKILL.md `description` frontmatter as a trigger classifier. A description that reads as documentation rather than action-oriented phrasing means the skill is silently skipped. Fix: write description to mirror user natural language; test with 10 real user phrasings before shipping.

6. **eBay Browse API rate limit exhausted silently** — 5,000 calls/day. 50 watchlist items at 15-min intervals = 4,800 calls/day, near the limit. No operator alert when limit is hit. Fix: send operator Telegram notification when 80% of daily budget consumed; priority-sort watchlist by scan urgency.

See [PITFALLS.md](.planning/research/PITFALLS.md) for full pitfall details, integration gotchas, security mistakes, and recovery strategies.

---

## Implications for Roadmap

Based on research, the build order is forced by both technical dependencies (types before modules, modules before scheduler, scheduler before skill) and risk sequencing (harden before extending, get eBay approval before purchase, persist state before deploying). Suggested phase structure:

### Phase 1: Foundation and Tooling
**Rationale:** Development velocity requires correct tooling before any module work. Missing ESLint config and outdated Vitest version are known gaps that will compound cost if deferred.
**Delivers:** Clean development environment with linting, formatting, type checking, and test infrastructure working correctly.
**Implements:** Upgrade Vitest 1.2 to 3.x, add `eslint.config.mjs` with flat config, add Prettier, install `grammy` and `ebay-api` to replace hand-rolled fetch calls.
**Avoids:** Accumulating linting debt across module hardening work.

### Phase 2: Core Module Hardening
**Rationale:** The OpenClaw skill is explicitly blocked on "all core modules stable." This phase is the prerequisite for everything downstream. Prototype code with known correctness gaps (in-memory dedup, thin FMV data, low confidence threshold) must be hardened before wrapping in a skill.
**Delivers:** Production-reliable implementations of CardResolver, PriceEngine, EbayScanner, DealScorer, TelegramAlerts, WatchlistManager, ScanScheduler with persisted dedup state, FMV data quality warnings, and the two-tier confidence disambiguation gate.
**Addresses:** Table stakes features (watchlist CRUD, real-time deal alerts, FMV comparison, eBay scan, deal scoring, card identity resolution, alert deduplication).
**Avoids:** Duplicate alert floods on restart (persist sentAlertKeys), wrong card purchases (confidence tier 0.70-0.84 = disambiguate), stale FMV signals (surface prices.length), silent rate limit exhaustion (operator alert at 80% budget).

### Phase 3: Bidirectional Telegram and BUY Command
**Rationale:** The BUY command is the defining feature that generates the shareable moment and is the product's primary differentiator. It requires converting TelegramAlerts from outbound-only to bidirectional (webhook/polling receiver). This must implement the human confirmation gate as a hard architectural requirement, not optional.
**Delivers:** Telegram receiver for BUY replies and watchlist commands; human confirmation flow before any purchase action; inline keyboard "Buy Now" button (via grammy) that deep-links to eBay listing while Order API approval is pending.
**Uses:** `grammy` inline keyboards, Telegram webhook or polling mode.
**Avoids:** eBay ToS violation (no automated purchase without explicit human trigger), Telegram 429 rate limiting (retry_after-aware retry queue with jitter), HTML parse errors from unescaped card names.

### Phase 4: OpenClaw Skill Wrapper
**Rationale:** The skill is a thin HTTP client over the now-hardened server. It must come after Phase 2-3 because the skill cannot ship if core modules are unreliable or if the BUY command is not yet implemented. The skill's description phrasing is a separate challenge from code — it requires user-language testing.
**Delivers:** `gacha-openclaw-skill/SKILL.md`, `register.md`, `heartbeat.md`, `install.sh`, and `package.json` openclaw metadata. Skill distribution via ClawHub registry targeting 145k+ OpenClaw community users.
**Avoids:** Skill never invoked due to description mismatch (test 10 natural phrasings); credentials in SKILL.md (reference env vars only); YAML frontmatter multi-line metadata parse failures.
**Research flag:** Needs `/gsd:research-phase` — OpenClaw skill format and description trigger classification behavior is documented but evolving.

### Phase 5: Purchase Execution (eBay Order API)
**Rationale:** This phase is gated on eBay Order API production access approval, which is a process (10+ business days) not a code task. Apply for approval in parallel with Phase 1. This phase converts the Phase 3 deep-link BUY button into a real Order API call, guarded by the human confirmation flow already built.
**Delivers:** End-to-end purchase execution: agent alerts → human confirms → agent places buy-it-now order → confirmation sent to Telegram.
**Uses:** eBay Order API v2 (user OAuth, authorization code grant with `buy.order` scope — not client credentials).
**Avoids:** Using client_credentials token for order placement (wrong OAuth scope, will fail); automated purchase from scheduled jobs (ToS violation); missing spend limit per session.

### Phase 6: Post-Launch Hardening and v1.x Features
**Rationale:** Post-launch signal from OpenClaw users determines which v1.x features have real demand. This phase addresses the features users ask for immediately after first use and the trust features needed after first real purchase.
**Delivers:** Purchase history / audit log; grade-specific watchlist targeting; multiple FMV sources (reduces false positives); auction snipe logic (if Order API approved and demand validated); watchlist management via Telegram commands.
**Avoids:** JSON storage corruption under concurrent writes (migrate to better-sqlite3 or Supabase if multi-user load materializes).

### Phase Ordering Rationale

- Foundation first because tooling debt compounds across every subsequent phase.
- Module hardening before skill wrapper because the OpenClaw skill is explicitly stated as requiring all core modules stable.
- Bidirectional Telegram before skill wrapper because the BUY command is the defining product feature and the skill's value proposition depends on it.
- eBay Order API access must be applied for during Phase 1 (parallel process) so approval arrives in time for Phase 5.
- v1.x features deferred to after OpenClaw skill ships and real user signal validates which features matter.
- v2+ features (portfolio P&L, international market scanning, TCGPlayer) explicitly excluded from this roadmap — they require separate product-market fit validation.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4 (OpenClaw Skill Wrapper):** OpenClaw's description-based trigger classification is documented but the exact matching behavior is not well-specified. Needs hands-on testing with real user phrasings and verification of YAML frontmatter constraints. Recommend `/gsd:research-phase` before planning this phase.
- **Phase 5 (Purchase Execution):** eBay Order API authorization code grant flow and guest checkout widget integration have limited public documentation. Official eBay developer docs are authoritative but sparse on implementation details. Recommend `/gsd:research-phase` once Limited Release access is granted.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation and Tooling):** ESLint flat config, Vitest upgrade, grammy installation — all well-documented, standard patterns.
- **Phase 2 (Core Module Hardening):** Persistence patterns, confidence gating, rate budget alerting — all standard engineering problems with well-known solutions.
- **Phase 3 (Bidirectional Telegram):** grammy webhook/polling is well-documented; inline keyboards are a standard grammy feature.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Core TypeScript/Node.js choices verified against existing codebase; grammy and ebay-api verified via npm; eBay Order API "Limited Release" restriction verified via official eBay developer docs |
| Features | MEDIUM | Competitive landscape verified via live product inspection; eBay Order API requirements HIGH confidence (official docs); OpenClaw ecosystem scale MEDIUM (community sources) |
| Architecture | HIGH | Based on direct codebase reading of all source files; OpenClaw skill pattern verified against official OpenClaw docs and DeepWiki |
| Pitfalls | HIGH | Critical pitfalls (eBay ToS, in-memory dedup, card confidence) verified against official sources and codebase inspection; eBay ban on automated purchasing verified via official policy announcement |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **eBay Order API approval timeline and integration complexity:** Cannot be fully validated until Limited Release access is granted. Apply immediately (Phase 1) and plan Phase 5 as a conditional phase that can be unblocked when approval arrives.
- **OpenClaw skill description trigger classification:** The exact algorithm OpenClaw uses to select skills from descriptions is not fully documented. Hands-on testing is required during Phase 4 to determine optimal description phrasing.
- **PokemonPriceTracker API stability and rate limits:** Currently the single source of both card resolution and FMV pricing. The 100 calls/day free tier is tight for a live product. Upgrade tiers and SLA are not publicly documented — need to verify directly.
- **OpenClaw ClawHub registry submission process:** Skill distribution at scale requires ClawHub listing. The submission/approval process is mentioned in docs but not detailed. Validate during Phase 4 planning.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase reading: `/gacha-agent-core/src/**` — all module implementations, types, entry points
- eBay Buy Order API overview (Limited Release): https://developer.ebay.com/api-docs/buy/order/static/overview.html
- eBay User Agreement update (Feb 20, 2026 LLM ban): https://www.valueaddedresource.net/ebay-bans-ai-agents-updates-arbitration-user-agreement-feb-2026/
- eBay developer API call limits: https://developer.ebay.com/develop/get-started/api-call-limits
- grammY official comparison vs Telegraf: https://grammy.dev/resources/comparison
- ebay-api npm package (v9.4.2): https://www.npmjs.com/package/ebay-api
- grammy npm package (v1.40.0): https://www.npmjs.com/package/grammy
- OpenClaw skills documentation: https://docs.openclaw.ai/tools/skills
- typescript-eslint flat config: https://typescript-eslint.io/getting-started/
- better-sqlite3 GitHub: https://github.com/WiseLibs/better-sqlite3

### Secondary (MEDIUM confidence)
- OpenClaw ecosystem scale (145k community): https://github.com/VoltAgent/awesome-openclaw-skills
- TCGSniper feature analysis: https://tcgsniper.com/ (live product)
- Agentic commerce 2026 landscape: Modern Retail, CNBC coverage
- OpenClaw heartbeat pattern: https://saulius.io/blog/openclaw-autonomous-ai-agent-framework-heartbeat-monitoring
- Zod v4 announcement (Aug 2025): https://www.infoq.com/news/2025/08/zod-v4-available/
- Vitest 4.0 release (Dec 2025): https://www.infoq.com/news/2025/12/vitest-4-browser-mode/
- Collector Crypt product documentation: CoinGecko, Blockworks analytics
- PokemonPriceTracker capabilities: https://www.pokemonpricetracker.com/

### Tertiary (LOW confidence)
- Agentic AI approval gate patterns: Towards AI blog — general patterns, not domain-specific
- OpenClaw security model: Cisco blog — general security analysis

---
*Research completed: 2026-02-18*
*Ready for roadmap: yes*
