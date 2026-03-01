# Stack Research

**Domain:** Agentic marketplace scanner — Pokémon card deal detection, eBay Browse/Order APIs, Telegram alerts, OpenClaw skill wrapper
**Researched:** 2026-02-18
**Confidence:** MEDIUM-HIGH (core TypeScript/Node.js choices HIGH; OpenClaw skill format MEDIUM; eBay Order API LOW due to restricted access)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | 5.3+ (already in use) | Primary language | Already in codebase; Zod v4 now requires TS 5.5+; no reason to change |
| Node.js | 18+ LTS (already in use) | Runtime | Native `fetch` available (no node-fetch needed); file system APIs stable |
| tsx | ^4.7.0 (already in use) | Dev runner / hot-reload | Zero-config TS execution for `serve:dev`; already works |
| Vitest | ^3.x (upgrade from 1.2) | Test runner | v4.0 released Dec 2025 with stable Browser Mode; keep Vitest rather than migrating to Jest — better ESM + TS support out of the box. Upgrade from 1.2 (current) to 3.x to avoid deprecated workspace config |

### External API Clients

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ebay-api` | ^9.4.2 | eBay Browse API typed client | Replace the hand-rolled `fetch` calls in `scanner/ebay.ts`. The `hendt/ebay-api` library (renamed from `@hendt/ebay-api`) supports Browse API v1.10.0 with full TypeScript types. Actively maintained, last publish ~Feb 2026. |
| `grammy` | ^1.40.0 | Telegram Bot SDK | Replace the hand-rolled Telegram `fetch` calls in `alerts/telegram.ts`. grammY has cleaner TypeScript types than Telegraf and tracks Bot API updates faster. Critically: enables inline keyboard "Buy Now" buttons needed for one-tap purchase UX. Current version 1.40.0 (published ~Feb 2026). |
| `pokemon-tcg-sdk-typescript` | ^1.3.4 (already in use) | Pokemon TCG card data | Existing dependency. Official SDK is stagnating (v1 deprecated, v2 never fully released). Keep for now but treat as stable-enough for v1 scope. |

### Validation & Schema

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | ^3.x (hold on v4) | Runtime input validation | Validate API request bodies coming into the HTTP server, validate OpenClaw skill payloads. **Use v3 for now** — Zod v4 (released Aug 2025) requires TypeScript 5.5+; current tsconfig targets TS 5.3.3. Upgrade Zod and TS together in a hardening pass. |

### Storage

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| JSON flat-file (current) | — | Watchlist + agent persistence | Keep for OpenClaw skill MVP. Single-file JSON is fine for 1-100 users. The existing `JsonStorageAdapter` with `StorageAdapter` interface means swapping to SQLite or Supabase later is a 1-file change. |
| `better-sqlite3` | ^9.x | SQLite persistence for hosted Gacha app | Introduce when watchlist grows beyond a few hundred entries or when multi-user concurrency is needed. Synchronous API is fast; works well with the existing key-value `StorageAdapter` interface. Do NOT use Node.js built-in `node:sqlite` yet — still experimental (flag-gated as of early 2026). |

### Scheduling

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Native `setTimeout` loop (current) | — | Polling scheduler | Keep for single-process deployments. The existing `ScanScheduler` using recursive `setTimeout` is correct — avoids setInterval's drift and queued-call problem. Add `node-cron` only if you need wall-clock time scheduling (e.g., "scan every day at 8am"). |
| `node-cron` | ^3.x | Cron-syntax scheduling | Add only if the hosted Gacha app needs calendar-aware scheduling. Not needed for OpenClaw skill MVP. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `typescript-eslint` (flat config) | Linting | Current: `eslint src/` script exists but no config file found. Add `eslint.config.mjs` using flat config format (the old `.eslintrc` format is deprecated in ESLint 9). Use `tseslint.configs.recommended`. |
| `prettier` | Code formatting | Standard for TS projects. Not currently in codebase — add alongside ESLint |
| `dotenv` | Env config | Already in use (`^17.3.1`). Keep. |

### OpenClaw Skill Layer

| Artifact | Format | Purpose | Notes |
|----------|--------|---------|-------|
| `SKILL.md` | Markdown + YAML frontmatter | Agent prompt injection | The core OpenClaw skill file. OpenClaw reads frontmatter for env var declarations (`requires.env`) and markdown body for instructions. **No TypeScript SDK is needed for the skill layer itself.** Skills are documentation-driven, not code-driven. |
| `package.json` (skill) | JSON with `openclaw` field | Skill metadata | Declares `openclaw.skills.dependencies` — env vars, binaries, install spec. Used by ClawHub registry. |
| HTTP server (`server.ts`) | Node.js `node:http` (current) | Skill API backend | The existing raw HTTP server is fine for the skill backend. The skill's `SKILL.md` instructs the OpenClaw agent to call `POST /api/resolve`, `POST /api/watch`, `POST /api/scan`, etc. No additional framework needed. |

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `grammy` | `telegraf` | Telegraf is acceptable if the team has existing Telegraf experience; grammY is preferred for new greenfield because types are cleaner and Bot API coverage is more current |
| `grammy` | Raw `fetch` to Telegram API (current) | Never: grammY adds inline keyboards, conversation flows, and webhook support that hand-rolled fetch cannot easily replicate |
| `ebay-api` | Raw `fetch` to eBay Browse API (current) | Only if the library adds too much overhead for the scan hot path — unlikely since Browse API calls are already I/O-bound |
| `better-sqlite3` | Supabase (already in config types) | Supabase when you need multi-region, real-time subscriptions, or Auth out of the box for the full hosted Gacha app. Over-engineered for the 4-week MVP. |
| `better-sqlite3` | `node:sqlite` (built-in) | When Node.js 23+ `node:sqlite` reaches stable status (not yet as of early 2026) |
| Recursive `setTimeout` (current) | `bullmq` | BullMQ if you need job persistence, retry queues, and Redis-backed concurrency across multiple workers. Out of scope for a 4-week TypeScript/single-process build. |
| Zod v3 | Zod v4 | Zod v4 when TypeScript is upgraded to 5.5+ (they should be upgraded together; v4 offers 14x faster string parsing) |
| JSON flat-file | PostgreSQL | PostgreSQL when multi-user hosted app launches and concurrent writes become a problem |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| eBay Buy Order API (programmatic purchase execution) | **Limited Release — requires eBay contract approval and signed agreements.** Cannot be used by new developers without explicit eBay business unit approval. The Order API v2 only supports guest checkout via the eBay widget anyway. | Build "one-tap purchase" as a deep-link to the eBay listing URL. Let the user complete checkout on eBay's own UI. Revisit Order API access after product traction. |
| `Telegraf` (new code) | Telegraf v4 TypeScript types are complex and harder to use than Telegraf v3 without types; frequently lags behind Bot API by several versions | `grammy` |
| `node:sqlite` (experimental) | Requires `--experimental-sqlite` Node.js flag as of early 2026; not stable | `better-sqlite3` |
| `setInterval` for scan loop | Will drift and queue calls if scan takes longer than the interval | Recursive `setTimeout` (already in use correctly) |
| `@hendt/ebay-api` | Old package name — renamed to `ebay-api` on npm | `ebay-api` |
| `ebay-node-api` | Last published 2022; unmaintained | `ebay-api` |
| `pokemon-tcg-sdk-typescript` v1 for new card features | Official v1 is deprecated; v2 was never fully released | Use the existing dependency as-is for MVP; for new card data features, call `pokemontcg.io` REST API directly |
| Express / Fastify | The existing `node:http` server is 450 lines and already handles all needed routes; adding a framework adds dependency weight with no current benefit | Native `node:http` (already in use) |
| Jest | Slower startup for ESM + TypeScript projects; requires babel transform | Vitest (already in use) |

---

## Stack Patterns by Variant

**For OpenClaw skill MVP (4-week timeline):**
- Keep native HTTP server (`node:http`) — no new framework
- Add `grammy` for Telegram inline keyboards ("Buy Now" button)
- Add `ebay-api` for type-safe Browse API calls
- Keep JSON flat-file storage
- Deliver `SKILL.md` + `package.json` openclaw metadata as the skill artifact
- One-tap purchase = deep link to eBay listing, not Order API

**For hosted Gacha app (post-MVP):**
- Migrate storage to `better-sqlite3` (single file, fast, no server)
- Upgrade Zod to v4 together with TypeScript to 5.5+
- Evaluate Supabase if real-time watchlist sync across devices is needed
- Revisit eBay Order API access (requires business agreement)

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `zod@3.x` | `typescript@5.3.x` | Compatible. Zod v4 requires TS 5.5+ — do not upgrade independently |
| `zod@4.x` | `typescript@5.5+` | Must upgrade TS and Zod together |
| `grammy@1.40.x` | `node@18+` | Confirmed. Uses native fetch available in Node 18+ |
| `ebay-api@9.4.x` | `node@18+`, TypeScript | Confirmed. TypeScript-native library |
| `vitest@3.x` | `typescript@5.3+`, ESM | Upgrade from current `^1.2.0`; v3 deprecates workspace config in favor of `projects` |
| `better-sqlite3@9.x` | `node@18+` | Requires native compilation; pre-built binaries available via npm |
| `pokemon-tcg-sdk-typescript@1.3.4` | Node 18+ | Keep current; no upgrade path to v2 |

---

## Installation

```bash
# Core additions (replace hand-rolled fetch calls)
npm install grammy ebay-api

# Validation
npm install zod

# Dev tooling
npm install -D eslint typescript-eslint prettier @types/node

# Later (post-MVP storage upgrade)
npm install better-sqlite3
npm install -D @types/better-sqlite3

# Vitest upgrade (from 1.2 to 3.x)
npm install -D vitest@^3
```

---

## Sources

- [grammy npm (v1.40.0, published ~Feb 2026)](https://www.npmjs.com/package/grammy) — HIGH confidence, verified by npm search
- [grammY comparison vs Telegraf](https://grammy.dev/resources/comparison) — HIGH confidence, official docs
- [ebay-api npm (v9.4.2)](https://www.npmjs.com/package/ebay-api) — HIGH confidence, verified by npm search
- [eBay Buy Order API overview — Limited Release](https://developer.ebay.com/api-docs/buy/order/static/overview.html) — HIGH confidence, official eBay developer docs
- [Zod v4 announcement (Aug 2025)](https://www.infoq.com/news/2025/08/zod-v4-available/) — HIGH confidence, InfoQ + GitHub releases
- [Vitest 4.0 release (Dec 2025)](https://www.infoq.com/news/2025/12/vitest-4-browser-mode/) — HIGH confidence, official release
- [OpenClaw Skills docs](https://docs.openclaw.ai/tools/skills) — MEDIUM confidence, official docs but new/evolving platform
- [ClawHub skill format](https://github.com/openclaw/clawhub) — MEDIUM confidence, community registry
- [typescript-eslint flat config (2025)](https://typescript-eslint.io/getting-started/) — HIGH confidence, official docs
- [Node.js built-in SQLite experimental status](https://betterstack.com/community/guides/scaling-nodejs/nodejs-sqlite/) — MEDIUM confidence, verified by community guide
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) — HIGH confidence, official repo
- [BullMQ vs node-cron comparison](https://betterstack.com/community/guides/scaling-nodejs/best-nodejs-schedulers/) — MEDIUM confidence, community guide

---

*Stack research for: Gacha Agent — agentic Pokémon card marketplace scanner*
*Researched: 2026-02-18*
