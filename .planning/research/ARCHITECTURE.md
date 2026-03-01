# Architecture Research

**Domain:** Agentic marketplace scanner / trading card buying platform
**Researched:** 2026-02-18
**Confidence:** HIGH (based on direct codebase reading + verified OpenClaw docs)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ENTRY POINTS                                     │
├─────────────────────────┬───────────────────────┬───────────────────┤
│   OpenClaw Skill        │   HTTP Server          │   CLI             │
│   (SKILL.md + heartbeat │   (server.ts)          │   (cli.ts)        │
│    via curl to API)     │   Port 3577            │   run/scan cmds   │
└────────────┬────────────┴───────────┬────────────┴─────────┬────────┘
             │  HTTP calls            │ createServer          │ direct
             │  Bearer Auth           │ (node:http)           │ import
             └────────────────────────┼───────────────────────┘
                                      │
┌─────────────────────────────────────▼───────────────────────────────┐
│                       CORE LIBRARY (gacha-agent-core)               │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ CardResolver │  │ PriceEngine  │  │ WatchlistManager          │  │
│  │              │  │              │  │                            │  │
│  │ NL → card    │  │ card+grade   │  │ CRUD watchlist entries     │  │
│  │ identity via │  │ → FMV via    │  │ via StorageAdapter         │  │
│  │ parse-title  │  │ PSA pricing  │  │ interface                  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬──────────────┘  │
│         │                 │                       │                  │
│  ┌──────▼──────────────────▼────────────────────┐│                  │
│  │              EbayScanner                      ││                  │
│  │  card + grade → OAuth → Browse API → listings ││                  │
│  └──────────────────────┬────────────────────────┘│                  │
│                         │                         │                  │
│  ┌──────────────────────▼────────────┐            │                  │
│  │           DealScorer              │            │                  │
│  │  listings + FMV → scored deals   │            │                  │
│  │  (price vs FMV, seller, type,    │            │                  │
│  │   population rarity)             │            │                  │
│  └──────────────────────┬────────────┘            │                  │
│                         │                         │                  │
│  ┌──────────────────────▼────────────┐  ┌─────────▼──────────────┐ │
│  │         TelegramAlerts            │  │     ScanScheduler       │ │
│  │  ScoredDeal → formatted message   │  │  Orchestrates scan      │ │
│  │  → Telegram Bot API               │  │  cycle across all       │ │
│  └───────────────────────────────────┘  │  active watchlist       │ │
│                                         │  entries. Rate budget   │ │
│                                         │  management + dedup.    │ │
│                                         └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│                       STORAGE LAYER                                  │
│  StorageAdapter interface — same API, swappable backends             │
│  ┌───────────────────────────┐  ┌───────────────────────────────┐   │
│  │ JsonStorageAdapter        │  │ SupabaseStorageAdapter        │   │
│  │ (OpenClaw skill, CLI,     │  │ (hosted Gacha Agent Service   │   │
│  │  local dev)               │  │  future, Postgres-backed)     │   │
│  └───────────────────────────┘  └───────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│                    EXTERNAL APIS                                      │
│  ┌──────────────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ PokemonPriceTracker  │  │  eBay Browse │  │ Telegram Bot API  │  │
│  │ POST /api/v2/parse-  │  │  API v1      │  │ sendMessage       │  │
│  │ title (card resolve) │  │  (listings)  │  │ (deal alerts)     │  │
│  │ GET  /api/psa/       │  │  + OAuth2    │  │                   │  │
│  │ pricing/{id}/{grade} │  │  token       │  │                   │  │
│  └──────────────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| `CardResolver` | Translates natural language card descriptions to structured `ResolvedCard` via PokemonPriceTracker parse-title API. Returns confidence-scored candidates; flags ambiguous results. | PokemonPriceTracker API (outbound HTTP) |
| `PriceEngine` | Fetches fair market value (`FairMarketValue`) for a resolved card at a given PSA grade. Uses median of completed eBay sales. 30-min in-memory cache to guard rate limits. | PokemonPriceTracker PSA pricing API (outbound HTTP) |
| `EbayScanner` | Searches eBay Browse API for active graded card listings. Manages OAuth2 client credentials token lifecycle with 5-minute expiry buffer. Returns `ScanResult`. | eBay Browse API (outbound HTTP + OAuth) |
| `DealScorer` | Stateless pure function. Scores each `EbayListing` against `FairMarketValue` using weighted factors (price vs FMV 60%, seller reputation 15%, listing type 10%, population rarity 15%). Returns `ScoredDeal[]` sorted descending. | None (pure computation, no I/O) |
| `TelegramAlerts` | Formats `ScoredDeal` into a human-readable Telegram message and sends via Bot API. Used by both ScanScheduler (automated) and on-demand. | Telegram Bot API (outbound HTTP) |
| `WatchlistManager` | CRUD operations over watchlist entries (`WatchlistEntry`). Maintains a user-scoped index for fast lookups. Tracks `lastScannedAt` for scheduling. | StorageAdapter (injected) |
| `ScanScheduler` | Orchestrates the full scan pipeline across all active watchlist entries. Manages rate budget (eBay 5K/day, pricing 100/day), concurrent batch limits, and in-memory dedup of sent alerts via `sentAlertKeys`. | WatchlistManager, EbayScanner, PriceEngine, DealScorer, TelegramAlerts |
| `StorageAdapter` | Interface: `get`, `set`, `delete`, `list`. Two implementations: `JsonStorageAdapter` (file-per-key via `data/` directory) and future `SupabaseStorageAdapter`. | Filesystem (JSON) or Supabase (future) |
| HTTP Server (`server.ts`) | Entry point for OpenClaw skill and hosted service. Exposes REST API for all core operations. Handles agent registration, auth (Bearer token), heartbeat state. Serves skill markdown files as public unauthenticated routes. | All core modules (instantiates directly) |
| CLI (`cli.ts`) | Entry point for standalone use. Commands: `resolve`, `price`, `watch`, `list`, `scan`, `run`. Wires up modules with DI from env vars. | All core modules (instantiates directly) |
| OpenClaw Skill (`gacha-openclaw-skill/`) | Markdown-based skill definition. SKILL.md is injected into agent system prompt. Agent calls HTTP Server endpoints via `curl`/`web_fetch`. Heartbeat state stored in `$OPENCLAW_STATE_DIR/gacha/`. | HTTP Server (outbound HTTP) |

---

## Recommended Project Structure

```
gacha-agent-core/
├── src/
│   ├── types/
│   │   └── index.ts            # All domain types — single source of truth
│   ├── card-resolver/
│   │   └── resolver.ts         # CardResolver class (NL → ResolvedCard)
│   ├── pricing/
│   │   └── engine.ts           # PriceEngine class (ResolvedCard → FMV)
│   ├── scanner/
│   │   ├── ebay.ts             # EbayScanner class (ResolvedCard → listings)
│   │   └── deal-scorer.ts      # DealScorer class (listings + FMV → scored)
│   ├── alerts/
│   │   └── telegram.ts         # TelegramAlerts class
│   ├── watchlist/
│   │   ├── manager.ts          # WatchlistManager class
│   │   └── storage-json.ts     # JsonStorageAdapter implementation
│   ├── scheduler/
│   │   └── scan-scheduler.ts   # ScanScheduler class (full pipeline loop)
│   ├── server.ts               # HTTP entry point (OpenClaw + hosted)
│   ├── cli.ts                  # CLI entry point
│   └── index.ts                # Public library exports

gacha-openclaw-skill/
├── SKILL.md                    # Agent system prompt injection (API reference)
├── register.md                 # One-time registration walkthrough
├── heartbeat.md                # Periodic scan decision flowchart
└── install.sh                  # Skill bootstrap script

gacha-agent-service/            # Future: hosted backend (Track 2)
├── src/
│   ├── agent/
│   │   ├── session.ts          # Per-user agent session lifecycle
│   │   ├── brain.ts            # Claude API tool calling orchestration
│   │   └── memory.ts           # Postgres conversation history
│   ├── channels/
│   │   └── web-chat.ts         # WebSocket handler for Gacha app
│   └── storage.ts              # SupabaseStorageAdapter (implements StorageAdapter)
```

### Structure Rationale

- **types/index.ts:** All domain types in one file means the resolver, scanner, scorer, and watcher share a single contract. No circular imports, no drift between modules.
- **module-per-concern:** Each module owns exactly one domain capability. `scanner/` handles marketplace access; `pricing/` handles FMV; `watchlist/` handles persistence. Modules never reach into each other's internals.
- **Two entry points, one core:** `server.ts` and `cli.ts` both instantiate the same classes from `src/`. No logic lives in entry points — they wire config, inject dependencies, start processes.
- **OpenClaw skill as thin HTTP client:** `gacha-openclaw-skill/` contains no TypeScript. The agent reads SKILL.md instructions and makes `curl` calls to the HTTP server. The skill is documentation, not code.

---

## Architectural Patterns

### Pattern 1: Dependency Injection via Constructor

**What:** Every module takes its dependencies as constructor arguments rather than importing or instantiating them internally. Config is passed as a typed `GachaAgentConfig` struct.

**When to use:** Always, for every class in the core library.

**Trade-offs:** Slightly more wiring in entry points (`server.ts`, `cli.ts`). Pays off heavily in testability (mock injections), portability across OpenClaw and hosted service, and explicit dependency graphs.

**Example:**
```typescript
// ScanScheduler declares dependencies explicitly — nothing hidden
const scheduler = new ScanScheduler(
  config,           // GachaAgentConfig — rate limits, thresholds
  watchlist,        // WatchlistManager — source of entries
  scanner,          // EbayScanner — marketplace access
  priceEngine,      // PriceEngine — FMV lookup
  dealScorer,       // DealScorer — pure scoring function
  alerts,           // TelegramAlerts — push notifications
);
```

### Pattern 2: StorageAdapter Interface for Backend Portability

**What:** A minimal key-value interface (`get`, `set`, `delete`, `list`) that WatchlistManager uses without knowing the implementation. Current implementation: `JsonStorageAdapter` (files on disk). Future: `SupabaseStorageAdapter`.

**When to use:** Any persistence concern that needs to work in both OpenClaw (filesystem) and hosted service (Supabase/Postgres).

**Trade-offs:** The interface forces a key-value mental model. Relational queries (e.g., `listActive()`) require a full scan over the prefix list. Acceptable for watchlists with <1,000 entries; replace with proper DB queries in `SupabaseStorageAdapter`.

**Example:**
```typescript
export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}
// JsonStorageAdapter writes data/${key}.json to disk.
// SupabaseStorageAdapter (future) queries Supabase key-value table.
// WatchlistManager uses StorageAdapter — never cares which backend.
```

### Pattern 3: Poll-Based Scanning with In-Memory Rate Budget

**What:** `ScanScheduler` runs a polling loop (default every 15 minutes) rather than waiting for events. It manages daily API call budgets with in-process counters, resets at midnight, and stops scanning when limits are reached. Concurrent scans are limited via batch slicing (`maxConcurrentScans`, default 3).

**When to use:** When the marketplace API does not support webhooks or push notifications for new listings (eBay Browse API does not). Polling is the only viable strategy.

**Trade-offs:** 15-minute scan lag vs. real-time. Rate counters reset on process restart (tolerable; resets conservatively to zero). In-memory dedup (`sentAlertKeys`) is lost on restart, risking duplicate alerts after a crash. Production hardening requires persisting this set to storage.

**Example:**
```typescript
// ScanScheduler.runOnce() — the full scan pipeline per tick
this.resetDailyCountersIfNeeded();
const entries = await this.watchlist.listActive();
const prioritized = this.prioritize(entries); // oldest scan first
for (let i = 0; i < prioritized.length; i += this.config.maxConcurrentScans) {
  if (!this.canMakeEbayCall()) break;
  const batch = prioritized.slice(i, i + this.config.maxConcurrentScans);
  await Promise.all(batch.map((entry) => this.scanEntry(entry)));
}
```

### Pattern 4: OpenClaw Skill as Pure HTTP Client (Remote Backend Pattern)

**What:** The OpenClaw skill (`SKILL.md`) contains no business logic. It is a markdown document injected into the agent's system prompt that describes the API surface. The agent uses `curl`/`web_fetch` to call the HTTP server. All logic, rate limiting, storage, and external API calls live in the server, not in the skill.

**When to use:** Any case where the skill needs capabilities beyond what OpenClaw's built-in tools provide (marketplace scanning, pricing lookups, Telegram notifications).

**Trade-offs:** Requires a running HTTP server. OpenClaw users must configure `GACHA_API_URL` pointing to a hosted endpoint or locally-run server. The skill itself becomes very thin and easy to update by re-serving a new `SKILL.md` — no reinstallation required, just a `lastSkillUpdate` refresh cycle.

**Example skill registration flow:**
```
OpenClaw agent turn (heartbeat) reads heartbeat.md
  → Checks lastScan timestamp
  → If 15+ minutes elapsed: fetches /api/watchlist
  → For each entry: POST /api/scan
  → Filters deals score >= 60 AND totalPrice <= targetPrice
  → Reports deals to user via agent's Telegram channel
  → Updates heartbeat.json with new lastScan
```

### Pattern 5: Confidence-Gated Disambiguation

**What:** `CardResolver.resolve()` returns a `ResolveResult` with a `needsDisambiguation` flag. When confidence is below 0.7, it returns candidates instead of a definitive match. The server propagates this to callers (HTTP API clients, the OpenClaw agent) rather than silently picking a wrong card.

**When to use:** Any NL-to-structured-entity resolution step where false positives have financial consequences (buying the wrong card).

**Trade-offs:** Adds a conversational round-trip in ambiguous cases. Required for correctness — a wrong card identity cascades into wrong FMV, wrong scan results, and a purchase that doesn't match user intent.

---

## Data Flow

### Scan Pipeline (ScanScheduler — automated 24/7 loop)

```
ScanScheduler.runOnce()
    │
    ├─ WatchlistManager.listActive()
    │    └─ StorageAdapter.list("watchlist:")
    │         → WatchlistEntry[]
    │
    ├─ prioritize(entries)
    │    └─ Sort: never-scanned first, then oldest scan, then newest added
    │         → WatchlistEntry[] (priority order)
    │
    ├─ [for each batch of maxConcurrentScans entries]
    │    │
    │    ├─ EbayScanner.scan(entry.card, grade)
    │    │    └─ eBay OAuth token (cached, auto-refreshed)
    │    │    └─ Browse API item_summary/search
    │    │         → ScanResult { listings: EbayListing[] }
    │    │
    │    ├─ PriceEngine.getFMV(entry.card, grade)
    │    │    └─ In-memory cache check (30 min TTL)
    │    │    └─ PokemonPriceTracker PSA pricing API
    │    │         → FairMarketValue { fmv (median), prices[], population }
    │    │
    │    ├─ DealScorer.scoreMany(listings, card, fmv)
    │    │    └─ Pure function: weightedScore for each listing
    │    │         → ScoredDeal[] (sorted descending by score)
    │    │
    │    ├─ Filter: score >= minDealScore AND totalPrice <= entry.targetPrice
    │    │         → alertDeals: ScoredDeal[]
    │    │
    │    ├─ Dedup: sentAlertKeys.has(`${entry.id}:${itemId}`)
    │    │
    │    ├─ TelegramAlerts.sendDealAlert(deal, entry.id)
    │    │    └─ Telegram Bot API sendMessage
    │    │
    │    └─ WatchlistManager.markScanned(entry.id)
    │         └─ StorageAdapter.set(key, updatedEntry)
    │
    └─ scheduleNext(scanIntervalMs)   ← recursive setTimeout
```

### On-Demand API Flow (HTTP Server — OpenClaw agent or direct caller)

```
POST /api/scan { query, grade }
    │
    ├─ authenticate(req, storage)   → AuthResult { agent, isAdmin }
    │
    ├─ CardResolver.resolve(query)
    │    └─ PokemonPriceTracker parse-title API
    │         → ResolveResult { success, bestMatch, candidates, needsDisambiguation }
    │
    ├─ [if needsDisambiguation] → return 200 { resolved: false, candidates }
    │
    ├─ EbayScanner.scan(bestMatch, grade)
    │         → ScanResult { listings }
    │
    ├─ PriceEngine.getFMV(bestMatch, grade)
    │         → FairMarketValue
    │
    ├─ DealScorer.scoreMany(listings, bestMatch, fmv)
    │         → ScoredDeal[]
    │
    └─ return 200 { resolved: true, card, totalFound, deals }
```

### OpenClaw Heartbeat Flow (agent-side, runs every 15 min)

```
OpenClaw heartbeat tick
    │
    ├─ Read $OPENCLAW_STATE_DIR/gacha/heartbeat.json
    │
    ├─ POST /api/heartbeat/ping  (alive signal → server logs lastPing)
    │
    ├─ [if lastSkillUpdate > 24h ago]
    │    └─ Re-download SKILL.md, register.md, heartbeat.md (live updates)
    │
    ├─ [if lastScan > 15 min ago]
    │    ├─ GET /api/watchlist
    │    ├─ [for each entry] POST /api/scan
    │    ├─ Filter deals by score >= 60
    │    └─ Present deals to user via agent channel
    │
    ├─ [if lastPrune > 1h ago] → clean cached alerts
    │
    └─ Write updated heartbeat.json { lastScan, lastSkillUpdate, lastPrune }
```

### Key State Flows

1. **Rate budget state:** Held in `ScanScheduler` in-memory (`ebayCallsToday`, `pricingCallsToday`). Resets at midnight UTC. Lost on process restart — restart conservatively assumes full budget available. This is a known tradeoff documented in PITFALLS.md.

2. **Alert dedup state:** `sentAlertKeys: Set<string>` in `ScanScheduler`. Key format: `${watchlistEntryId}:${ebayItemId}`. Prevents re-alerting on the same listing within a process lifetime. Lost on restart. Production hardening: persist to storage with TTL.

3. **OAuth token state:** `EbayScanner.accessToken` + `tokenExpiresAt`. Cached in-process, auto-refreshed 5 minutes before expiry. Stateless — can re-acquire on any restart.

4. **FMV cache state:** `PriceEngine.cache: Map<string, {value, expiresAt}>`. 30-minute TTL. Reduces PokemonPriceTracker API calls. Stateless — cold restart simply re-fetches.

5. **Watchlist + agent state:** Persisted to `StorageAdapter`. Durable across restarts. Single source of truth.

6. **OpenClaw heartbeat state:** Persisted to `$OPENCLAW_STATE_DIR/gacha/heartbeat.json` by the agent itself. Independent of server — agent manages its own scheduling clock.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1–50 watchlist entries | Current architecture — polling loop with JSON storage is sufficient |
| 50–500 entries | Replace `JsonStorageAdapter` with Supabase/Postgres. Persist `sentAlertKeys` and rate counters to DB. Add Redis for FMV cache. |
| 500+ entries | Extract `ScanScheduler` to a worker process with a job queue (BullMQ/pg-boss). Fan out scan jobs across workers. Move rate budget tracking server-side (Redis atomic counters). |
| Multi-user hosted service | Agent-scoped sessions (already modeled via `agentId`). Per-agent rate budgets. Supabase Row Level Security for watchlist isolation. |

### Scaling Priorities

1. **First bottleneck:** JSON storage — `listActive()` scans all keys. Replace with indexed DB query at ~100 entries.
2. **Second bottleneck:** Single-process scheduler — can't distribute across machines. Extract to job queue at ~500 entries with meaningful scan latency.
3. **Third bottleneck:** eBay API rate limits (5,000/day across all users). At multi-user scale: shared rate budget pool with per-agent allocation.

---

## Anti-Patterns

### Anti-Pattern 1: Business Logic in Entry Points

**What people do:** Put card resolution, scoring logic, or database queries directly in `server.ts` route handlers or `cli.ts` command cases.

**Why it's wrong:** Logic can't be shared between the CLI and HTTP server. Tests can't reach it without starting a server or parsing argv. The OpenClaw skill has no access to it.

**Do this instead:** All domain logic lives in core module classes. Entry points only instantiate modules, wire dependencies, and route requests to the right method call. A route handler should be 5–10 lines maximum.

### Anti-Pattern 2: Duplicating Logic Between Tracks

**What people do:** Build deal scoring slightly differently in the OpenClaw skill versus the hosted service because "they have different needs."

**Why it's wrong:** Two scoring implementations will drift. A bug fix in one won't apply to the other. Users in different tracks get inconsistent results.

**Do this instead:** `DealScorer` is in `gacha-agent-core`. Both tracks call the same class with the same weights. If the hosted service needs different weights, inject them via config — don't fork the implementation.

### Anti-Pattern 3: Persisting Transient State Only In Memory

**What people do:** Track sent alerts, rate counters, and dedup state purely in-process without persistence.

**Why it's wrong:** Process restarts (deploys, crashes, scheduler restarts) lose all state. Users get duplicate Telegram alerts. Rate limits reset mid-day. Alert dedup breaks.

**Do this instead:** `sentAlertKeys` and daily rate counters should be persisted to `StorageAdapter` with TTL (sent alert keys: 24h; rate counters: until next midnight). This is the primary hardening task for production.

### Anti-Pattern 4: Tight Coupling to a Single Storage Backend

**What people do:** `WatchlistManager` directly `import`s and instantiates `JsonStorageAdapter`.

**Why it's wrong:** The OpenClaw skill uses file storage; the hosted service needs Postgres. If the implementation is hardcoded, switching backends requires rewriting or forking `WatchlistManager`.

**Do this instead:** `WatchlistManager` depends only on the `StorageAdapter` interface. The entry point (`server.ts` or `cli.ts`) decides which adapter to inject. The manager is backend-agnostic.

### Anti-Pattern 5: Putting Logic in the OpenClaw Skill Itself

**What people do:** Add JavaScript/TypeScript to the OpenClaw skill to perform deal scoring, price comparisons, or watchlist management locally without going through the HTTP server.

**Why it's wrong:** OpenClaw skills are markdown + bash/curl. There's no TypeScript runtime. Local logic can't be updated remotely. Users running old skill versions get old behavior. The skill re-download mechanism (every 24h) only updates markdown — not code.

**Do this instead:** The skill is a thin HTTP client. All intelligence lives in the HTTP server. Skill updates (new API endpoints, new fields) flow automatically via the `lastSkillUpdate` refresh cycle.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| PokemonPriceTracker API | REST over HTTPS, Bearer token in Authorization header. Two endpoints: `POST /api/v2/parse-title` (card resolve) and `GET /api/psa/pricing/{cardId}/{grade}` (FMV). | Free tier: 100 calls/day. Normalize base URL to `www.` subdomain — non-www redirects strip Authorization header. |
| eBay Browse API | REST over HTTPS. Client credentials OAuth2 flow — `POST /identity/v1/oauth2/token`, then `GET /buy/browse/v1/item_summary/search`. Token cached in-process with 5-min expiry buffer. | Free tier: 5,000 calls/day. Sandbox mode available via config flag. Category 183454 for graded cards. |
| Telegram Bot API | REST over HTTPS, no auth header — bot token embedded in URL path. `sendMessage` with `parse_mode: HTML`. | Async fire-and-forget. No retry or delivery guarantee in current implementation. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `CardResolver` ↔ `PriceEngine` | Domain type only — `ResolvedCard` output of resolver is input to engine. No direct module coupling. | Both depend on the same `GachaAgentConfig` for API keys. |
| `ScanScheduler` ↔ all core modules | Constructor injection — scheduler holds references to watchlist, scanner, priceEngine, dealScorer, alerts. Calls methods directly, not via HTTP. | All in-process; this is the tight coupling that makes the standalone scheduler fast. |
| HTTP Server ↔ core modules | Direct class instantiation in `server.ts`; method calls in route handlers. No message bus or inter-process communication. | Suitable for single-process deployment. For distributed worker model, extract scanner to a job queue and call via message. |
| OpenClaw Skill ↔ HTTP Server | HTTP over network (curl/web_fetch from agent). Authenticated via `gacha_`-prefixed Bearer token issued at agent registration. | The only inter-process boundary in the current architecture. The skill is the only component that communicates via network rather than in-process calls. |
| `WatchlistManager` ↔ `StorageAdapter` | Interface method calls only. No concrete type import from storage modules. | The DI boundary that enables backend portability (JSON → Supabase). |

---

## Build Order Implications

The following order is forced by compile-time and runtime dependencies:

```
1. types/index.ts
   └─ All domain types. Must exist before any module.

2. watchlist/storage-json.ts + watchlist/manager.ts
   └─ Depends only on types. WatchlistManager is needed by scheduler and server.
      Can be built in parallel with:

2. card-resolver/resolver.ts
   └─ Depends only on types + GachaAgentConfig. No module dependencies.

2. pricing/engine.ts
   └─ Depends only on types + GachaAgentConfig. No module dependencies.

3. scanner/ebay.ts
   └─ Depends on types. No internal module dependencies.

3. scanner/deal-scorer.ts
   └─ Pure function over types. No external dependencies.

4. alerts/telegram.ts
   └─ Depends only on types.

5. scheduler/scan-scheduler.ts
   └─ Depends on WatchlistManager, EbayScanner, PriceEngine, DealScorer, TelegramAlerts.
      Must come after all of the above.

6. server.ts / cli.ts (entry points)
   └─ Depend on all modules. Built last, never imported by other modules.

7. gacha-openclaw-skill/ (markdown only, no build step)
   └─ Depends on server.ts being deployed and accessible via HTTP.
      Can be authored in parallel — just needs the API contract stable.
```

**Key build insight:** Steps 2 (resolver, pricing engine, watchlist) are fully parallel. Step 5 (scheduler) gates on all Step 3-4 work being complete. The OpenClaw skill is always last — it's a client of the server, not a component of the core.

---

## Sources

- Direct codebase reading: `/gacha-agent-core/src/**` — HIGH confidence
- OpenClaw skills system architecture: [DeepWiki — OpenClaw Skills System](https://deepwiki.com/openclaw/openclaw/6.4-skills-system) — HIGH confidence (official source mirror)
- OpenClaw heartbeat pattern: [OpenClaw Agentic Framework: Heartbeat Monitoring](https://saulius.io/blog/openclaw-autonomous-ai-agent-framework-heartbeat-monitoring) — MEDIUM confidence (community verified against docs)
- OpenClaw cron system: [Cron Jobs — OpenClaw Docs](https://docs.openclaw.ai/automation/cron-jobs) — HIGH confidence (official docs)
- OpenClaw architecture overview: [OpenClaw System Architecture Overview](https://ppaolo.substack.com/p/openclaw-system-architecture-overview) — MEDIUM confidence (community analysis)
- MCP server / thin wrapper pattern: [Agentic AI Architecture Patterns — Speakeasy](https://www.speakeasy.com/mcp/using-mcp/ai-agents/architecture-patterns) — MEDIUM confidence (verified against known MCP patterns)
- Rate limit budget management patterns: [Scaling your API with rate limiters — Stripe](https://stripe.com/blog/rate-limiters) — HIGH confidence (canonical engineering reference)
- Polling vs webhooks for marketplace monitoring: [Polling vs Webhooks — Unified.to](https://unified.to/blog/polling_vs_webhooks_when_to_use_one_over_the_other) — MEDIUM confidence (matches eBay API constraints)
- Agentic commerce / approval gate patterns: [Production-Ready AI Agents — Towards AI](https://towardsai.net/p/machine-learning/production-ready-ai-agents-8-patterns-that-actually-work-with-real-examples-from-bank-of-america-coinbase-uipath) — LOW confidence (general patterns, not domain-specific)

---
*Architecture research for: Gacha Agent — agentic trading card buying platform*
*Researched: 2026-02-18*
