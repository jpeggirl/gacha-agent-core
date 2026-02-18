# Technology Stack

**Analysis Date:** 2026-02-18

## Languages

**Primary:**
- TypeScript 5.3.3 - All source code in `src/`
- JavaScript - Package scripts and Node.js runtime

**Secondary:**
- JSON - Configuration and data storage

## Runtime

**Environment:**
- Node.js 18.0.0 or higher (engines constraint in `package.json`)

**Package Manager:**
- npm (lockfile: `package-lock.json` present)

## Frameworks

**Core:**
- Node.js native HTTP (`node:http` module) - HTTP server in `src/server.ts`
- No web framework - uses native Node.js modules

**Build/Dev Tools:**
- TypeScript 5.3.3 - Compilation with strict mode enabled
- tsc - TypeScript compiler (build script)
- tsx 4.7.0 - TypeScript execution and file watching for CLI/server

**Testing:**
- Vitest 1.2.0 - Test runner and framework for unit/integration tests
- Config: `vitest.config.ts`

## Key Dependencies

**Critical:**
- `pokemon-tcg-sdk-typescript` 1.3.4 - Pokemon TCG database integration (though not directly used in current source, listed in dependencies)
- `dotenv` 17.3.1 - Environment variable loading

**Type Support:**
- `@types/node` 20.11.0 - TypeScript definitions for Node.js APIs

## Configuration

**Environment:**
- `.env` and `.env.example` - Environment variable configuration
- `dotenv` package loads configuration at runtime in `src/cli.ts` and `src/server.ts`

**Key Configurations Required:**
- `POKEMON_PRICE_TRACKER_API_KEY` - API key for price tracking service
- `POKEMON_PRICE_TRACKER_URL` - Base URL for price tracking API (defaults to https://www.pokemonpricetracker.com)
- `EBAY_APP_ID` - eBay Developer API credentials (required for scanning)
- `EBAY_CERT_ID` - eBay Developer API certification ID
- `EBAY_SANDBOX` - Boolean flag to use eBay sandbox environment (default: false)
- `TELEGRAM_BOT_TOKEN` - Telegram bot token for alerts
- `TELEGRAM_CHAT_ID` - Default Telegram chat ID for alerts
- `DATA_PATH` - Path to local data storage directory (default: ./data)
- `USER_ID` - User identifier for watchlist/scan operations (default: default)
- `SCAN_INTERVAL_MS` - Interval for marketplace scans in milliseconds (default: 900000 = 15 minutes)
- `MIN_DEAL_SCORE` - Minimum deal quality score to trigger alerts (default: 60, range 0-100)

**Build Configuration:**
- `tsconfig.json` - TypeScript compiler options with ES2022 target, NodeNext module resolution, strict mode, source maps and declaration files

## Platform Requirements

**Development:**
- Node.js 18+
- npm for package management
- TypeScript knowledge for development
- Git for version control

**Production:**
- Node.js 18+ runtime
- Environment variables configured (especially API keys)
- Network access to:
  - Pokemon Price Tracker API (https://www.pokemonpricetracker.com)
  - eBay Browse API (https://api.ebay.com)
  - Telegram Bot API (https://api.telegram.org)
- Local filesystem for JSON data storage (by default in `./data` directory)

## Scripts

**Available Commands:**
- `npm run build` - Compile TypeScript to JavaScript in `dist/` directory
- `npm run dev` - Watch mode CLI development (rebuilds on changes)
- `npm start` - Run CLI from compiled source
- `npm run serve` - Run HTTP server from compiled source
- `npm run serve:dev` - Watch mode HTTP server development
- `npm test` - Run all test suites once
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Run ESLint on `src/` directory

## No External Frameworks

- No web framework (Express, Fastx, Hono) - uses Node.js native `http` module
- No database ORM/abstraction - uses JSON file-based storage with adapter pattern
- No authentication library - custom OAuth implementation for eBay and Telegram

---

*Stack analysis: 2026-02-18*
