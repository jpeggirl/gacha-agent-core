# Gacha Agent

Pokemon card deal-finding agent. Resolves cards from natural language, fetches fair market value pricing, scans eBay for deals, and sends alerts via Telegram.

Built as an OpenClaw skill — any OpenClaw bot can install it and start finding deals for users.

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url>
cd gacha-agent-core
npm install
```

### 2. Get your API keys

You need credentials from three services:

| Service | What it does | Get a key |
|---------|-------------|-----------|
| **PokemonPriceTracker** | Resolves card names from natural language | [pokemonpricetracker.com](https://www.pokemonpricetracker.com) |
| **PriceCharting** | Fair market value pricing | [pricecharting.com/api](https://www.pricecharting.com/api) |
| **eBay Developer** | Searches live listings | [developer.ebay.com](https://developer.ebay.com) |

Optional (for Telegram alerts):

| Service | What it does | How to get |
|---------|-------------|------------|
| **Telegram Bot** | Sends deal alerts to your chat | Message [@BotFather](https://t.me/BotFather), send `/newbot` |

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your keys:

```env
# Required
POKEMON_PRICE_TRACKER_API_KEY=your_key
POKEMON_PRICE_TRACKER_URL=https://www.pokemonpricetracker.com
PRICECHARTING_API_KEY=your_key

# Required for deal scanning
EBAY_APP_ID=your_app_id
EBAY_CERT_ID=your_cert_id
EBAY_SANDBOX=false

# Optional — Telegram alerts
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

**Getting your Telegram chat ID:** After creating a bot with BotFather, send any message to your bot, then visit:
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
```
Look for `"chat":{"id":123456789}` in the response.

### 4. Start the server

```bash
npm run serve
```

Output:
```
Gacha Agent API running on http://0.0.0.0:3577
Chat UI: http://localhost:3577/
```

## Connecting Your OpenClaw Bot

This is the main way other people use Gacha Agent. Your OpenClaw bot connects to a running Gacha Agent server and gets card-finding superpowers.

### Step 1: Register your bot

Your bot calls the registration endpoint once to get an API key:

```bash
curl -s -X POST http://localhost:3577/api/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name":"my-openclaw-bot","description":"Pokemon deal finder"}'
```

Response:
```json
{
  "agent_id": "abc-123",
  "name": "my-openclaw-bot",
  "api_key": "gacha_a1b2c3...",
  "created_at": "2026-02-25T00:00:00.000Z"
}
```

Save the `api_key` — you'll use it for all API calls.

### Step 2: Verify it works

```bash
export GACHA_API_KEY="gacha_a1b2c3..."

curl -s http://localhost:3577/api/agents/me \
  -H "Authorization: Bearer $GACHA_API_KEY"
```

### Step 3: Try a card lookup

```bash
# Resolve a card from natural language
curl -s -X POST http://localhost:3577/api/resolve \
  -H "Authorization: Bearer $GACHA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "base set charizard PSA 9"}'

# Get fair market value
curl -s -X POST http://localhost:3577/api/price \
  -H "Authorization: Bearer $GACHA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "base set charizard", "grade": 9}'

# Scan eBay for deals
curl -s -X POST http://localhost:3577/api/scan \
  -H "Authorization: Bearer $GACHA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "base set charizard PSA 9", "grade": 9}'
```

### Step 4: Set up the heartbeat (automated scanning)

Your bot should run a scan loop every 15 minutes. The full decision flowchart is at `http://localhost:3577/heartbeat.md`.

The short version:

1. **Ping the server** — `POST /api/heartbeat/ping`
2. **Fetch your watchlist** — `GET /api/watchlist`
3. **Scan each card** — `POST /api/scan` for each entry
4. **Filter by score** — only show deals with `score >= 60`
5. **Present deals** to the user with price, FMV, savings %, and eBay link

### Step 5: OpenClaw skill files

Your bot can download the full skill definition from the server:

| File | URL | What it is |
|------|-----|------------|
| Skill definition | `/skill.md` | Full API reference and conversation patterns |
| Registration guide | `/register.md` | Step-by-step registration walkthrough |
| Heartbeat flowchart | `/heartbeat.md` | Automated scan decision tree |

These files tell the bot how to use every endpoint, handle disambiguation, format deal alerts, and manage errors.

## API Reference

All authenticated endpoints require `Authorization: Bearer <your_api_key>`.

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/skill.md` | Skill definition |
| `GET` | `/register.md` | Registration guide |
| `GET` | `/heartbeat.md` | Heartbeat flowchart |
| `POST` | `/api/agents/register` | Register a new agent |

### Authenticated

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/me` | Your agent profile |
| `POST` | `/api/resolve` | Resolve card from natural language |
| `POST` | `/api/price` | Get fair market value |
| `POST` | `/api/scan` | Scan eBay for deals |
| `POST` | `/api/watch` | Add card to watchlist |
| `GET` | `/api/watchlist` | List your watchlist |
| `DELETE` | `/api/watchlist/:id` | Remove from watchlist |
| `POST` | `/api/heartbeat/ping` | Heartbeat ping |
| `GET` | `/api/heartbeat/state` | Heartbeat state |
| `POST` | `/api/feedback` | Report bad results |
| `GET` | `/api/interactions` | View interaction logs |

### Deal Scores

When scanning, each deal gets a score from 0-100:

| Score | Signal | Meaning |
|-------|--------|---------|
| 80-100 | Strong Buy | Significantly below market — act fast |
| 65-79 | Buy | Good deal, worth buying |
| 45-64 | Fair | Market price, no rush |
| 25-44 | Overpriced | Above market, wait |
| 0-24 | Avoid | Way overpriced or sketchy seller |

## Running with Docker

```bash
# From the repo root (not gacha-agent-core/)
docker build -t gacha-agent .
docker run -p 3577:3577 \
  --env-file gacha-agent-core/.env \
  -v gacha-data:/app/data \
  gacha-agent
```

## Development

```bash
npm run serve:dev   # Server with hot reload
npm run chat        # Interactive REPL (dev tool)
npm test            # Run tests (vitest)
npm run typecheck   # TypeScript checks
npm run lint        # ESLint
```

## Architecture

```
src/
  server.ts              HTTP API + Telegram polling + background scheduler
  card-resolver/         Natural language -> exact card identity
  pricing/               Fair market value from PriceCharting
  scanner/               eBay Browse API search + deal scoring
  watchlist/             CRUD with JSON file persistence
  alerts/                Telegram bot API (send deals, receive /feedback)
  scheduler/             Automated scan loop (every 15 min)
  logging/               Per-agent interaction logging
  feedback/              Bad result reporting
```
