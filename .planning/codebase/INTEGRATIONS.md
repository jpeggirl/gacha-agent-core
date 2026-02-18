# External Integrations

**Analysis Date:** 2026-02-18

## APIs & External Services

**Pokemon Card Resolution & Pricing:**
- Pokemon Price Tracker API - Card parsing, disambiguation, and fair market value (FMV) estimation
  - SDK/Client: Custom HTTP client using native `fetch`
  - Auth: Bearer token in `Authorization` header
  - Env var: `POKEMON_PRICE_TRACKER_API_KEY`
  - Base URL env var: `POKEMON_PRICE_TRACKER_URL` (defaults to https://www.pokemonpricetracker.com)
  - Endpoints:
    - `POST /api/v2/parse-title` - Parse eBay listing titles to extract card metadata (used in `src/card-resolver/resolver.ts`)
    - `GET /api/psa/pricing/{cardId}/{grade}` - Fetch PSA grading price data (used in `src/pricing/engine.ts`)

**Marketplace Scanning:**
- eBay Browse API - Search and monitor graded Pokemon card listings
  - SDK/Client: Custom HTTP client using native `fetch`
  - Auth: OAuth 2.0 Client Credentials flow with Bearer token
  - Credentials: `EBAY_APP_ID` and `EBAY_CERT_ID` env vars
  - Implementation: `src/scanner/ebay.ts` class `EbayScanner`
  - Token refresh: 5 minutes before expiry
  - Endpoints:
    - `POST /identity/v1/oauth2/token` - Obtain access token (sandbox: https://api.sandbox.ebay.com, production: https://api.ebay.com)
    - `GET /buy/browse/v1/item_summary/search` - Search listings with filters by category, grade, and query
  - Features:
    - Category filtering: Graded cards category ID `183454`
    - Aspect filters for PSA grades
    - Returns up to 50 results sorted by price
    - Sandbox mode support via `EBAY_SANDBOX` env var

**Alerts & Notifications:**
- Telegram Bot API - Send deal alerts to users
  - SDK/Client: Custom HTTP client using native `fetch`
  - Auth: Bot token in URL path
  - Token env var: `TELEGRAM_BOT_TOKEN`
  - Default chat ID env var: `TELEGRAM_CHAT_ID`
  - Implementation: `src/alerts/telegram.ts` class `TelegramAlerts`
  - Endpoint: `POST /bot{botToken}/sendMessage`
  - Features:
    - HTML message formatting for rich alerts
    - Deduplication cache to prevent duplicate notifications
    - Configurable chat ID per alert

## Data Storage

**Databases:**
- None - No traditional database used

**File Storage:**
- Local filesystem (JSON file adapter)
  - Implementation: `src/watchlist/storage-json.ts` class `JsonStorageAdapter`
  - Storage location: Configurable via `DATA_PATH` env var (default: `./data`)
  - Adapter pattern: Implements `StorageAdapter` interface from `src/types/index.ts`
  - Operations: Get, set, delete, list by prefix
  - No built-in transactions or locking

**Caching:**
- In-memory Map-based caching
  - Price cache: `src/pricing/engine.ts` - 30 minute TTL for FMV data
  - Alert deduplication: `src/alerts/telegram.ts` - In-memory Set for sent alert tracking (cleared on demand)

## Authentication & Identity

**Auth Providers:**
- Custom implementations, no centralized auth service
  - eBay OAuth 2.0 Client Credentials
  - Telegram Bot Token authentication
  - Pokemon Price Tracker API Bearer Token

**Implementation:**
- `src/scanner/ebay.ts` - eBay OAuth token management with automatic refresh
- `src/alerts/telegram.ts` - Telegram bot token in URL
- `src/pricing/engine.ts` - Bearer token in Authorization header
- `src/card-resolver/resolver.ts` - Bearer token in Authorization header

## Monitoring & Observability

**Error Tracking:**
- None detected - Errors thrown as exceptions, no external error tracking service

**Logs:**
- Console output (`console.log`, `console.error`)
- Structured logging: Not implemented
- Log persistence: Not implemented (logs go to stdout/stderr)

**Metrics/Analytics:**
- None detected

## CI/CD & Deployment

**Hosting:**
- Not specified - Can run on any Node.js 18+ environment (local machine, VPS, container)

**CI Pipeline:**
- None detected in repository
- Build command: `npm run build`
- Test command: `npm test`
- Lint command: `npm run lint`

## Environment Configuration

**Required Environment Variables:**

Core:
- `POKEMON_PRICE_TRACKER_API_KEY` - API key for Pokemon pricing service (no default)
- `POKEMON_PRICE_TRACKER_URL` - Base URL (default: https://www.pokemonpricetracker.com)

eBay Integration:
- `EBAY_APP_ID` - eBay Developer app ID (required for scanning)
- `EBAY_CERT_ID` - eBay Developer cert ID (required for scanning)
- `EBAY_SANDBOX` - Use sandbox environment (default: false, optional)

Telegram Integration:
- `TELEGRAM_BOT_TOKEN` - Telegram bot token (required for alerts)
- `TELEGRAM_CHAT_ID` - Default chat to send alerts to (optional)

Optional:
- `DATA_PATH` - Watchlist/data storage directory (default: ./data)
- `USER_ID` - User identifier for operations (default: default)
- `SCAN_INTERVAL_MS` - Scan frequency in milliseconds (default: 900000 = 15 min)
- `MIN_DEAL_SCORE` - Minimum deal quality score 0-100 (default: 60)

**Secrets Location:**
- `.env` file in project root (git-ignored)
- Environment variables passed at runtime
- **IMPORTANT:** Never commit actual API keys/tokens to version control

## Webhooks & Callbacks

**Incoming Webhooks:**
- None implemented currently

**Outgoing Webhooks:**
- None implemented currently
- Storage adapter supports `webhook` as AlertChannel type in type definitions but not implemented

## API Rate Limits

**eBay Browse API:**
- Daily limit: 5000 calls (configured in `DEFAULT_SCHEDULER_CONFIG`, `src/types/index.ts`)

**Pokemon Price Tracker API:**
- Daily limit: 100 calls (configured in `DEFAULT_SCHEDULER_CONFIG`, `src/types/index.ts`)

**Scheduler Configuration:**
- Default scan interval: 15 minutes
- Max concurrent scans: 3 (default)
- Minimum deal score threshold: 60/100

---

*Integration audit: 2026-02-18*
