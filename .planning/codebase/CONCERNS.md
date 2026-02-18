# Codebase Concerns

**Analysis Date:** 2026-02-18

## Security Considerations

**Exposed API credentials in `.env.example`:**
- Risk: Sample `.env.example` file contains actual valid Telegram bot token and chat ID
- Files: `.env.example`
- Current mitigation: None — tokens are visible in repository
- Recommendations: Remove all valid credentials from `.env.example`. Replace with placeholder values like `TELEGRAM_BOT_TOKEN=your_telegram_bot_token`. Document that example values must be replaced before use.

**Insufficient authorization checks on API registration endpoint:**
- Risk: `/api/agents/register` endpoint allows unauthenticated registration with no rate limiting or validation
- Files: `src/server.ts` (lines 194-235)
- Impact: Malicious actors can spam agent registrations and exhaust storage
- Recommendations: Add rate limiting per IP, add CAPTCHA validation, or require an invite token. Consider moving registration behind admin-only endpoint.

**Bearer token extraction without validation:**
- Risk: Token extraction in `authenticate()` uses simple string replacement without checking Bearer prefix format
- Files: `src/server.ts` (line 103)
- Current code: `const token = auth.replace('Bearer ', '');` — no error handling if format is incorrect
- Impact: Could silently treat malformed tokens as valid empty strings
- Recommendations: Validate Bearer format before extraction; return 400 if malformed

**API key generation uses insufficient entropy:**
- Risk: Keys generated with 24 bytes of random hex, but if `randomBytes` is not cryptographically strong, keys could be predictable
- Files: `src/server.ts` (line 52)
- Current mitigation: Node.js `randomBytes` is cryptographically secure
- Recommendations: Document the cryptographic guarantee; consider adding key rotation policy

**No HTTPS enforcement in server:**
- Risk: Server accepts HTTP requests on public endpoints including auth
- Files: `src/server.ts`
- Impact: API keys and agent tokens transmitted in plaintext over HTTP
- Recommendations: Document requirement for reverse proxy with HTTPS; add warning in startup logs if running on HTTP

**Unvalidated external API responses:**
- Risk: PokemonPriceTracker and eBay API responses are parsed without strict schema validation
- Files: `src/card-resolver/resolver.ts` (line 154), `src/scanner/ebay.ts` (line 124), `src/pricing/engine.ts` (line 121)
- Impact: Malformed responses could crash the application or expose internal details
- Recommendations: Use zod or typebox to validate all external API responses before parsing

## Tech Debt

**Monolithic storage implementation:**
- Issue: `JsonStorageAdapter` stores all data in a single JSON file; no separation by user/key prefix
- Files: `src/watchlist/storage-json.ts`
- Impact: Performance degrades linearly with data size; entire file rewritten on every mutation
- Fix approach: Implement file-per-user or file-per-prefix strategy; add indexing for faster lookups

**Hardcoded heartbeat key prefixes:**
- Issue: Heartbeat storage uses string prefix `heartbeat:` hardcoded in server; no namespace isolation
- Files: `src/server.ts` (lines 49, 72, 86)
- Impact: If multiple agent instances run, heartbeats could collide or overwrite
- Fix approach: Include agent ID in heartbeat key; use distributed storage for multi-instance deployment

**No request validation middleware:**
- Issue: Request bodies parsed with JSON.parse() directly without schema validation
- Files: `src/server.ts` (lines 196, 297, 307, 343, 394)
- Impact: Invalid requests can cause type errors; no clear error messages to clients
- Fix approach: Create validation middleware or use a schema validation library; return 400 with details on validation failure

**Incomplete metadata support in watchlist:**
- Issue: Grade information stored in generic `metadata` field with `as number` casting
- Files: `src/cli.ts` (line 193), `src/scheduler/scan-scheduler.ts` (line 94)
- Impact: No type safety; metadata could contain wrong types; defaults silently to grade 9
- Fix approach: Add explicit `grade` field to `WatchlistEntry` type; migrate existing metadata

**No database schema or migration support:**
- Issue: JSON storage has no versioning; schema changes require manual data migration
- Files: `src/watchlist/storage-json.ts`, `src/types/index.ts`
- Impact: Breaking changes to data types risk data loss
- Fix approach: Implement schema versioning; add migration runner for new deployments

**Duplicate configuration code:**
- Issue: Config loading logic duplicated between `server.ts` and `cli.ts`
- Files: `src/server.ts` (lines 24-43), `src/cli.ts` (lines 15-50)
- Impact: Changes to config parsing must be made in two places; risk of inconsistency
- Fix approach: Extract `loadConfig()` to shared module; import from both

**Limited error context in catch blocks:**
- Issue: Many catch blocks silently convert errors to strings without preserving stack traces
- Files: `src/server.ts` (lines 231, 437), `src/card-resolver/resolver.ts` (line 104), `src/scheduler/scan-scheduler.ts` (line 147)
- Impact: Difficult to debug; no structured logging
- Fix approach: Use structured logging with error metadata; preserve error chains

## Performance Bottlenecks

**Linear JSON file loading on every operation:**
- Problem: `ensureLoaded()` reads entire JSON file from disk every time storage is accessed
- Files: `src/watchlist/storage-json.ts` (lines 16-28)
- Cause: No caching of file read; `loaded` flag only prevents multiple reads per process instance
- Improvement path: Cache file content in memory; implement write-through cache; add optional Redis backend

**Synchronous file persistence after every mutation:**
- Problem: Each `storage.set()` writes entire data object to disk synchronously
- Files: `src/watchlist/storage-json.ts` (lines 30-37, 45-49)
- Cause: No batching; no async queue
- Impact: Watchlist add/update operations block until disk I/O completes (~10-100ms per operation)
- Improvement path: Implement write buffer with batching; flush async in background every 1-5 seconds

**Full watchlist scan for each user query:**
- Problem: `listByUser()` loads entire watchlist index into memory, then fetches each entry individually
- Files: `src/watchlist/manager.ts` (lines 74-82)
- Cause: No database indexing; sequential fetches
- Impact: Scales O(n) per user; 100 entries = 100+ storage reads
- Improvement path: Index by userId in storage layer; use range queries if backend supports

**Deal scorer iterations without early exit:**
- Problem: `scoreMany()` scores all listings even if only top N are needed
- Files: `src/scanner/deal-scorer.ts` (lines 76-84)
- Cause: Always scores all listings before sorting
- Impact: With 50 listings, all 50 are scored even if only top 3 shown
- Improvement path: Sort by likely score first (price/FMV); score top N only; lazy evaluate

**Missing pricing cache invalidation:**
- Problem: Price cache TTL is 30 minutes; no invalidation when data stales during scan
- Files: `src/pricing/engine.ts` (lines 30-32, 74-77)
- Impact: Users may see stale FMV while scanner uses same stale price; inconsistent scoring
- Improvement path: Implement versioned caching; track cache age per card-grade pair

**HTTP request overhead without connection pooling:**
- Problem: Each `fetch()` call to external APIs creates new TCP connection
- Files: `src/pricing/engine.ts` (line 109), `src/scanner/ebay.ts` (lines 112, 172), `src/card-resolver/resolver.ts` (line 139), `src/alerts/telegram.ts` (line 105)
- Cause: Default fetch behavior; no agent configuration
- Impact: Slow API calls (200-500ms) due to connection setup
- Improvement path: Create global fetch agent with connection pooling; reuse connections

## Fragile Areas

**eBay OAuth token refresh race condition:**
- Files: `src/scanner/ebay.ts` (lines 161-192)
- Why fragile: If two concurrent requests both see expired token, both will try to refresh; one may fail
- Safe modification: Add mutex lock around `ensureToken()`; cache refresh promise
- Test coverage: No tests for concurrent token refresh

**Confidence score calculation in resolver:**
- Files: `src/card-resolver/resolver.ts` (lines 228-288)
- Why fragile: Complex relevance adjustment logic with hardcoded weights (0.2, 0.25, 0.05, etc.)
- Impact: Small changes to query parsing can drastically change match scores
- Safe modification: Add unit tests for each weight adjustment; parameterize weights for testing
- Test coverage: No tests for resolver; confidence calculation untested

**Deal signal derivation hard filters:**
- Files: `src/scanner/deal-scorer.ts` (lines 131-145)
- Why fragile: Hard filters for seller feedback (< 95%) override all scoring logic
- Impact: Good deals from newer sellers are always marked "avoid"
- Safe modification: Make feedback thresholds configurable; document rationale for hardcoded values
- Test coverage: Limited — only basic scoring tests

**Watchlist user index synchronization:**
- Files: `src/watchlist/manager.ts` (lines 32-35, 66-69)
- Why fragile: User index maintained separately from entries; delete operations must update both
- Impact: If delete fails partway, index and entries become inconsistent
- Safe modification: Use transactional storage or implement index reconstruction; add periodic validation
- Test coverage: Tests exist but don't cover failure scenarios

**Price engine no-data fallback:**
- Files: `src/pricing/engine.ts` (lines 46-52)
- Why fragile: If PokemonPriceTracker is down, getFMV() throws and stops scan
- Impact: One API failure blocks entire scheduler loop
- Safe modification: Return null instead of throwing; handle null FMV in scorer with fallback logic
- Test coverage: No tests for API failure scenarios

## Scaling Limits

**Daily API rate limits not enforced accurately:**
- Current capacity: 5000 eBay calls/day, 100 pricing calls/day
- Limit: Counters reset on UTC midnight; no distributed counter across instances
- Scaling path: Move rate limit tracking to Redis; implement token bucket algorithm for smooth rate limiting

**Single-file JSON storage cannot scale beyond ~MB:**
- Current capacity: 10K watchlist entries feasible (≈ 10-50MB depending on card data)
- Limit: File size grows unbounded; entire file rewritten on each mutation
- Scaling path: Move to SQLite (file-based) or Supabase (networked); add pagination for list operations

**No connection pooling causes API latency:**
- Current capacity: ~6-10 concurrent requests (TCP connection setup takes 50-100ms)
- Limit: Each scan operation serializes API calls; with 10-minute scan interval and 5000 daily limit, max ~8 scans/agent
- Scaling path: Implement HTTP/2 connection pooling; batch card resolves into single API call

**Heartbeat state stored per agent instance:**
- Current capacity: Scales to ~100 agents before heartbeat table is unwieldy
- Limit: No cluster-wide view of agent health; heartbeats not queryable
- Scaling path: Move heartbeats to time-series database; implement distributed health checks

**Telegram API rate limits not tracked:**
- Current capacity: Telegram allows ~30 messages/second per bot
- Limit: No queue or rate limiting; burst of deals could exceed limit
- Scaling path: Implement message queue; batch alerts by user; implement exponential backoff

## Missing Critical Features

**No persistent alert history:**
- Problem: Once alerts sent, no record kept
- Blocks: Can't replay alerts, can't audit what was sent
- Workaround: Add logging to stdout; store alert records in JSON storage

**No watchlist update endpoint via API:**
- Problem: Only `/api/watch` (POST) and DELETE; no PATCH for updating target price or grade
- Blocks: Agents must delete and re-add to change targets
- Workaround: CLI supports updates; implement via direct storage manipulation

**No bulk operations API:**
- Problem: Adding 100 cards requires 100 POST requests
- Blocks: Batch operations very slow
- Workaround: Use CLI for bulk operations; implement via loop in client

**No way to export watchlist:**
- Problem: No CSV/JSON export endpoint
- Blocks: Data portability; switching agents difficult
- Workaround: Manually read data files

## Test Coverage Gaps

**Card resolver untested:**
- What's not tested: All resolver logic — normalization, variant detection, confidence calculation
- Files: `src/card-resolver/resolver.ts`
- Risk: Breaking changes to API parsing logic go undetected
- Priority: High

**Server API endpoints untested:**
- What's not tested: All HTTP endpoint logic — routing, auth, error handling
- Files: `src/server.ts`
- Risk: Bugs in API responses, missing fields, wrong status codes
- Priority: High

**Telegram alerts untested:**
- What's not tested: Message formatting, API integration, error handling
- Files: `src/alerts/telegram.ts`
- Risk: Messages fail to send or are malformed
- Priority: Medium

**eBay scanner untested:**
- What's not tested: Search query building, listing parsing, OAuth token refresh
- Files: `src/scanner/ebay.ts`
- Risk: Parsing changes break listing extraction
- Priority: Medium

**Pricing engine API integration untested:**
- What's not tested: Cache behavior, fallback on API error, multi-grade fetching
- Files: `src/pricing/engine.ts`
- Risk: Cache corruption, stale prices, API failures cause crashes
- Priority: Medium

**Scheduler concurrency untested:**
- What's not tested: Rate limit enforcement, batch processing, error recovery
- Files: `src/scheduler/scan-scheduler.ts`
- Risk: Race conditions, exceeding API limits, stuck jobs
- Priority: High

---

*Concerns audit: 2026-02-18*
