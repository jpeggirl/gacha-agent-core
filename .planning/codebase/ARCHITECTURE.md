# Architecture

**Analysis Date:** 2026-02-18

## Pattern Overview

**Overall:** Modular layered architecture with clean separation of concerns between card resolution, pricing, marketplace scanning, storage, scheduling, and alerting.

**Key Characteristics:**
- **Service-oriented modules** — Each feature area (card resolution, pricing, scanning, watchlist) is encapsulated as an independent class with dependency injection
- **Asynchronous I/O throughout** — All external API calls and storage operations are async
- **Dependency injection** — Modules accept their dependencies via constructor, enabling testing and swapping implementations
- **Domain-driven types** — Core types (`ResolvedCard`, `FairMarketValue`, `EbayListing`, `ScoredDeal`) define clear data contracts
- **Dual entry points** — CLI for one-off commands, HTTP server for agent-based automated operations

## Layers

**Type Layer:**
- Purpose: Define and export the domain model and interfaces used across all modules
- Location: `src/types/index.ts`
- Contains: All interfaces for cards, listings, watchlist entries, pricing, alerts, scheduling, and configuration
- Depends on: Node.js built-in types only
- Used by: Every other module in the codebase

**Card Resolution Layer:**
- Purpose: Convert natural language card descriptions into resolved Pokemon cards with high confidence matching
- Location: `src/card-resolver/resolver.ts`
- Contains: CardResolver class that calls PokemonPriceTracker API for parsing and matching
- Depends on: `GachaAgentConfig`, `ResolvedCard`, `ResolveResult` types
- Used by: CLI, server, scheduler

**Pricing Layer:**
- Purpose: Fetch and cache fair market value (FMV) estimates for graded cards from PokemonPriceTracker
- Location: `src/pricing/engine.ts`
- Contains: PriceEngine class with 30-minute in-memory caching of FMV data
- Depends on: `ResolvedCard`, `FairMarketValue` types, `GachaAgentConfig`
- Used by: CLI, server, scheduler (for deal scoring)

**Scanner Layer:**
- Purpose: Scan eBay for listings matching a card, and score those listings against FMV
- Location: `src/scanner/ebay.ts`, `src/scanner/deal-scorer.ts`
- Contains:
  - `EbayScanner`: Authenticates with eBay API, builds search queries, fetches listings
  - `DealScorer`: Scores individual listings using weighted algorithm (price vs FMV, seller reputation, listing type, population rarity)
- Depends on: `ResolvedCard`, `EbayListing`, `ScoredDeal`, `FairMarketValue` types, `GachaAgentConfig`
- Used by: CLI, server, scheduler

**Watchlist & Storage Layer:**
- Purpose: Manage user watchlist entries and abstract storage backend
- Location: `src/watchlist/manager.ts`, `src/watchlist/storage-json.ts`
- Contains:
  - `WatchlistManager`: CRUD operations on watchlist entries, user-indexed lookups
  - `JsonStorageAdapter`: In-memory cache with JSON file persistence
  - `StorageAdapter` interface: Allows swapping implementations (supabase, etc.)
- Depends on: `WatchlistEntry`, `CreateWatchlistInput`, `StorageAdapter` types
- Used by: CLI, server, scheduler

**Scheduler Layer:**
- Purpose: Continuously scan watchlist entries on interval, score deals, and send alerts when conditions met
- Location: `src/scheduler/scan-scheduler.ts`
- Contains: ScanScheduler class orchestrating watchlist iteration, scanning, deal scoring, and alert sending with rate limiting
- Depends on: All service layers (watchlist, scanner, pricing, alerts)
- Used by: CLI `run` command and future server scheduling endpoints

**Alert Layer:**
- Purpose: Send formatted alerts to external channels (Telegram) with deduplication
- Location: `src/alerts/telegram.ts`
- Contains: TelegramAlerts class formatting deals as rich HTML messages and posting to Telegram Bot API
- Depends on: `ScoredDeal`, `DealAlert` types, `GachaAgentConfig`
- Used by: Scheduler, server endpoints

**Entry Point Layer:**
- Purpose: Wire all services together and expose as CLI or HTTP API
- Location: `src/cli.ts`, `src/server.ts`
- Contains:
  - CLI: Command handler (resolve, price, watch, list, scan, run)
  - Server: HTTP routes for card resolution, pricing, watchlist, scanning, agent management
- Depends on: All service modules, configuration
- Used by: End users (CLI) or AI agents (HTTP)

## Data Flow

**Resolve Command / POST /api/resolve:**

1. User provides card description (e.g., "charizard base set 1st edition")
2. `CardResolver.resolve()` sends query to PokemonPriceTracker parse-title API
3. API returns best match + candidate list with confidence scores
4. CLI prints results or server returns JSON with candidates for disambiguation

**Price Lookup / POST /api/price:**

1. User provides card description + grade (PSA 9)
2. `CardResolver.resolve()` finds best match card
3. `PriceEngine.getFMV()` fetches pricing from PokemonPriceTracker PSA pricing endpoint
4. Engine caches result for 30 minutes
5. CLI displays FMV, population count, recent sales; server returns JSON with full FMV object

**Watchlist Add / POST /api/watch:**

1. User provides card description + target price
2. Card resolver finds best match
3. `WatchlistManager.add()` creates entry with UUID, stores via `StorageAdapter`
4. Manager updates user index for fast lookups
5. Entry marked active by default
6. CLI/server confirms entry ID

**Scan (One-shot) / POST /api/scan:**

1. User provides card description + grade
2. Card resolver finds best match
3. `EbayScanner.scan()` authenticates with eBay, builds search query (card name + set + variant + grade)
4. Scanner fetches listings from eBay Browse API, extracts item ID, title, price, seller info, etc.
5. `DealScorer.scoreMany()` scores each listing against FMV using weighted algorithm
6. Listings sorted by score (descending)
7. CLI/server returns top deals with signal (strong_buy, buy, fair, overpriced, avoid)

**Scheduler Run (Automated) / `cli run` or background job:**

1. `ScanScheduler.start()` begins monitoring active watchlist entries
2. On interval (default 15 min):
   - Reset daily eBay/pricing counters if date changed
   - Fetch all active entries
   - Prioritize by last scan time (scan oldest first)
   - Process in batches (default 3 concurrent)
   - Skip if daily rate limits reached
3. For each entry:
   - Call `EbayScanner.scan()` to get listings
   - Call `PriceEngine.getFMV()` to get current FMV
   - Call `DealScorer.scoreMany()` to score listings
   - Filter to deals scoring >= minDealScore (default 60)
   - Call `TelegramAlerts.sendDealAlert()` for each deal (deduplicated by item ID)
   - Mark entry as scanned with timestamp
4. Continue until all entries scanned or rate limits hit
5. Sleep until next interval

**State Management:**

- **Watchlist state**: Persisted to `./data/gacha-agent-data.json` via `JsonStorageAdapter`
  - Keys: `watchlist:{entryId}` for entries, `watchlist:user:{userId}` for user index
  - Loaded on first access, cached in memory, written on each change

- **Scheduler state**: In-memory only
  - `ebayCallsToday`, `pricingCallsToday`: Counters reset at midnight
  - `sentAlertKeys`: Set of `{itemId}:{chatId}` strings to prevent duplicate alerts
  - `running`, `timer`: Control scheduler lifecycle

- **Price cache**: In-memory with TTL
  - Key: `{cardId}:{grade}`
  - TTL: 30 minutes
  - Avoids redundant pricing API calls

- **Server session state**: Per-agent via `JsonStorageAdapter` with prefix `agents` and `heartbeat:{agentId}`
  - Agent records: ID, name, API key, creation/last-seen timestamps
  - Heartbeat state: Last ping, last scan, active alert count, error count

## Key Abstractions

**ResolvedCard:**
- Purpose: Unambiguous identifier for a Pokemon card after disambiguation
- Examples: `src/types/index.ts` lines 3-14
- Pattern: Immutable value object with id, name, set info, year, variant, rarity, confidence score

**StorageAdapter:**
- Purpose: Abstract storage backend for watchlist and agent data
- Examples: `src/watchlist/storage-json.ts` (JSON file), interface in `src/types/index.ts` lines 151-156
- Pattern: Interface with async get/set/delete/list methods; implementations provide persistence

**ScoredDeal:**
- Purpose: Represent a single eBay listing with deal analysis and recommendation
- Examples: `src/types/index.ts` lines 111-120
- Pattern: Combination of raw listing data, card info, FMV, computed score (0-100), signal (strong_buy to avoid), reasoning

**SchedulerConfig:**
- Purpose: Configure scan interval, rate limits, deal thresholds
- Examples: `src/types/index.ts` lines 141-147, default in line 205-211
- Pattern: Configuration object with sensible defaults (15 min interval, 5000 eBay/100 pricing daily limits, 60 min deal score)

## Entry Points

**CLI `src/cli.ts`:**
- Location: `src/cli.ts`
- Triggers: User runs `npm start` or `tsx src/cli.ts <command>`
- Responsibilities:
  - Parse command from argv
  - Load config from environment
  - Instantiate all services
  - Dispatch to command handlers (resolve, price, watch, list, scan, run)
  - Print formatted output
  - Handle errors and exit codes

**Server `src/server.ts`:**
- Location: `src/server.ts`
- Triggers: User runs `npm run serve` or `tsx src/server.ts`
- Responsibilities:
  - Create HTTP server listening on PORT (default 3577)
  - Load config and instantiate all services
  - Serve public skill files (/skill.md, /register.md, /heartbeat.md)
  - Handle agent registration (public endpoint)
  - Authenticate requests via Bearer token (admin key or agent API key)
  - Route to API handlers for resolve, price, watch, watchlist, scan
  - Track agent heartbeat state (last ping, last scan)
  - Return JSON responses
  - Handle errors gracefully

## Error Handling

**Strategy:** Thrown errors propagate to entry point with try-catch at request/command level

**Patterns:**
- API errors from external services (PokemonPriceTracker, eBay, Telegram) throw with descriptive message including original error
- Configuration validation happens at startup — missing required env vars cause process exit(1)
- Scheduler catches errors per-entry and logs, allowing scheduler to continue with remaining entries
- HTTP API endpoints catch errors and return 500 with error message in JSON
- CLI commands catch errors, log, and call process.exit(1) when critical

Example from `src/pricing/engine.ts` line 49-51:
```typescript
throw new Error(
  `Failed to fetch pricing for ${card.name} PSA ${grade}: ${response.error ?? 'Unknown error'}`
);
```

## Cross-Cutting Concerns

**Logging:**
- Approach: Console.log with context prefixes ([Scheduler], [API], [AGENT])
- No structured logging framework; relies on prefix format
- Log at process start, per-command completion, per-scan result, errors

**Validation:**
- Card resolution: Confidence threshold 0.7 determines if disambiguation needed
- Seller reputation: Feedback percent >= 95 required for non-avoid signal
- Deal scoring: Weighted calculation with 60-point minimum for alerts
- Price vs FMV: Savings percent calculated as (FMV - listing) / FMV * 100

**Authentication:**
- CLI: Environment variable USER_ID (defaults to "default") for watchlist scoping
- Server: Bearer token in Authorization header
  - Admin key (`GACHA_ADMIN_KEY` or `GACHA_API_KEY`) for full access
  - Agent API keys for scoped access (watchlist per agent_id)
- No persistent session; stateless token validation

**Rate Limiting:**
- eBay: 5000 calls/day (counter in scheduler)
- Pricing: 100 calls/day (counter in scheduler)
- Telegram: Deduplicated by item ID to avoid repeat alerts
- Daily counters reset at midnight (date check via `resetDailyCountersIfNeeded()`)

---

*Architecture analysis: 2026-02-18*
