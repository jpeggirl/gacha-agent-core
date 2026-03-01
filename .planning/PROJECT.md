# Gacha Agent — Agentic Trading Card Platform

## What This Is

An AI agent that finds and buys Pokémon trading cards for collectors. Users add cards to a watchlist with target prices, the agent scans eBay 24/7, compares listings to fair market value from multiple sources, and alerts users on Telegram when it finds deals — with one-tap purchase execution. The shared core library (`gacha-agent-core`) powers both an OpenClaw skill (viral MVP) and eventually a hosted Gacha app.

## Core Value

The agent eliminates the tedious work of manually searching, comparing, and sniping card deals — users set what they want and the agent handles the rest.

## Requirements

### Validated

<!-- Existing capabilities from current codebase (experimental, needs hardening) -->

- ✓ Card resolution via PokemonPriceTracker API (natural language → resolved card) — existing
- ✓ FMV pricing from PokemonPriceTracker with 30-min cache — existing
- ✓ eBay listing scanner via Browse API with search query building — existing
- ✓ Deal scoring with weighted algorithm (price vs FMV, seller rep, listing type, population) — existing
- ✓ Watchlist CRUD with JSON file storage adapter — existing
- ✓ Telegram deal alerts with deduplication — existing
- ✓ Scan scheduler with rate limiting and batch processing — existing
- ✓ CLI entry point (resolve, price, watch, list, scan, run) — existing
- ✓ HTTP server entry point with agent registration — existing

### Active

- [ ] Harden existing modules for production reliability
- [ ] End-to-end deal finding flow: watchlist → scan → score → Telegram alert
- [ ] eBay purchase execution (Buy It Now + auction snipe)
- [ ] OpenClaw skill wrapper with tool registration
- [ ] Portfolio tracking (holdings, cost basis, unrealized P&L)
- [ ] Additional price sources (Alt.xyz, PriceCharting, eBay sold comps)
- [ ] SNKRDUNK scanner (stretch goal for v1)

### Out of Scope

- Vault/tokenization infrastructure — requires physical vault partner, not ready yet
- Gacha marketplace — depends on vault + tokenization pipeline
- Gacha hosted app (Track 2) — separate project, starts after OpenClaw ships
- Sports cards / non-Pokémon cards — Pokémon only for v1
- TCGPlayer / Mercari Japan scanning — eBay only for v1
- OAuth/social login — not needed for OpenClaw skill
- Mobile app — web/CLI only for v1

## Context

- **Existing codebase:** Experimental TypeScript modules exist for card resolution, pricing, scanning, deal scoring, watchlist, alerts, and scheduling. Code works but is experimental/broken — needs hardening, not rewriting from scratch.
- **Two-track strategy:** `gacha-agent-core` is the shared library. Track 1 (OpenClaw skill) wraps it for viral distribution. Track 2 (Gacha App) wraps it later for the hosted product.
- **OpenClaw:** User's own early-stage project — the skill framework is still being built alongside this.
- **Competitive landscape:** Courtyard, Collector Crypt, Phygitals, rip.fun exist but none have an intelligent agent layer. Manual everything.
- **Go-viral thesis:** "My AI agent sniped a PSA 10 Charizard while I was sleeping" is the tweet that drives organic growth.

## Constraints

- **Card scope**: Pokémon TCG cards only (graded + raw) — keeps card resolution and pricing focused
- **Marketplace**: eBay only for v1 — largest volume, API available, reduces scraping complexity
- **Alerts**: Telegram as primary alert channel — reply "BUY" to execute
- **Tech stack**: TypeScript, Node.js 18+, no web framework (native HTTP), Vitest for testing
- **Architecture**: All business logic in gacha-agent-core — wrappers (OpenClaw skill, future Gacha App) are thin
- **Storage**: JSON file storage for v1 (pluggable via StorageAdapter interface)
- **Timeline**: ~4 weeks to ship OpenClaw skill MVP

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pokémon only for v1 | Focused card resolution, single pricing domain, passionate community | — Pending |
| eBay only for v1 | Largest volume, official API, avoids browser scraping complexity | — Pending |
| Telegram for alerts | Reply-based UX ("BUY"), popular in crypto/trading communities | — Pending |
| Build on existing experimental code | Foundation exists, harden rather than rewrite | — Pending |
| OpenClaw skill as distribution channel | 145k+ stars community, viral potential, validates demand before building full app | — Pending |

---
*Last updated: 2026-02-18 after initialization*
