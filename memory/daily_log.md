# Daily Log

### 2026-02-27 16:40 — [Fix] Add Images to Seed & Backfill Cards
**What:** Fixed missing images on home page backfill cards. Added `imageUrl` to all 15 seed cards in `data/popular-cards.json` (pokemontcg.io CDN for 14, TCGPlayer CDN for Espeon VMAX). Added `fetchImageUrl` fallback in trending resolve loop for edge case where both resolver and eBay listing lack images.
**Files:** data/popular-cards.json (imageUrl for all 15 seeds), src/server.ts (fetchImageUrl fallback in trending loop), src/scripts/populate-seed-images.ts (one-time fetch script)
**Result:** Pass — 216 tests, typecheck clean
**Lessons:** PokemonPriceTracker API needs valid API key (returns 401 without it). pokemontcg.io image CDN is reliable for direct URLs (`images.pokemontcg.io/{setId}/{number}_hires.png`) but their search API is flaky. Set ID mapping differs between our data and pokemontcg.io (e.g. sv2a vs sv3pt5 for Pokemon 151, swsh12 for Silver Tempest). TCGPlayer product images at `product-images.tcgplayer.com/fit-in/400x558/{id}.jpg` work for most tcgPlayerId but not all (missing Pokemon 151 cards).

### 2026-02-27 16:20 — [Feature] Always Show 20 Cards — eBay Trending Backfill
**What:** Added `getTrending()` to EbayScanner (newlyListed PSA Pokemon cards). Rewrote `/api/popular` to always serve 20 cards: recent searches first, then eBay trending backfill (resolved via CardResolver, 1-hour in-memory cache), then seed data fallback. FMV fetched in parallel for all cards.
**Files:** src/scanner/ebay.ts (getTrending), src/scanner/ebay.test.ts (5 new tests), src/server.ts (/api/popular rewrite with trending cache + HOME_PAGE_TARGET)
**Result:** Pass — 213 tests, typecheck clean
**Lessons:** Fetching 40 trending listings gives dedup headroom when filtering against recent searches. Resolver caching means resolving ~20 eBay titles is fast after first call.

### 2026-02-27 15:23 — [Feature] Recent Searches as Home Page Content
**What:** Replaced hardcoded popular cards on home page with recently searched cards. Searches recorded via storage adapter on /api/search success (deduped by card.id, capped at 30). /api/popular now serves recent searches with FMV; falls back to seed data on cold start. Updated UI title to "Recent Searches", removed stats bar.
**Files:** src/types/index.ts (RecentSearchEntry), src/server.ts (recordRecentSearch, /api/popular rewrite, /api/search side-effect), public/index.html (title + stats bar)
**Result:** Pass — 167 tests, typecheck clean
**Lessons:** Fire-and-forget pattern (call json() then do async work before return) avoids blocking the response while still persisting data.

### 2026-02-27 15:02 — [UI] Gacha Pro Trading Terminal Reskin
**What:** Complete reskin of public/index.html — new design system with black bg, orange (#f97316) accents, Space Grotesk + JetBrains Mono fonts, Iconify icons, table-based card layouts, compact header, trading terminal footer with live data indicator
**Files:** public/index.html (full rewrite of HTML/CSS, JS logic unchanged)
**Result:** Pass — 167 tests pass, all SPA routes/API integrations preserved
**Lessons:** Keeping all JS logic (router, fetch calls, state management) identical while swapping only HTML structure and CSS makes visual reskins safe and easy to verify

### 2026-02-25 14:58 — [Feature] Grail Research Agent — New Sibling Project
**What:** Created gacha-research-agent/ as a sibling project implementing set browsing, grade comparison, price recommendations, conversation engine, and live chat UI
**Files:** 16 new files in gacha-research-agent/ (src/sets/, src/pricing/, src/conversation/, src/server.ts, src/chat.ts, public/index.html) + updated gacha-agent-core/src/index.ts barrel
**Result:** Pass — 55 new tests pass, 122 existing pass (177 total), zero type errors
**Lessons:** Building gacha-agent-core dist is required before typecheck resolves file: dependency types. The orchestrator pattern (intent -> route -> service -> response) is clean and testable.

### 2026-02-25 13:52 — [Feature] Card Disambiguation with Images + Conversation Logging
**What:** Implemented disambiguation flow: types, image enrichment, Telegram photo/callback methods, server session endpoints
**Files:** src/types/index.ts, src/card-resolver/resolver.ts, src/alerts/telegram.ts, src/server.ts, src/alerts/telegram.test.ts, src/card-resolver/resolver.test.ts
**Result:** Pass — 122 tests pass, typecheck clean, no new lint errors (5 pre-existing)
**Lessons:** Pre-existing lint errors in resolver.ts (unused ResolvedCard import), deal-scorer.ts, engine.test.ts, server.ts. escapeHtml is not exported from telegram.ts.

### 2026-02-25 22:05 — [Feature] CardResolver search fallback + grade stripping in intents
**What:** Added search fallback to CardResolver: when parse-title returns empty matches (common for "alt art", "alternate art" queries), resolve() now falls back to `/api/v2/cards?search=` endpoint. Uses parsed cardName from parse-title when available, strips grade terms from search query. Also stripped grade/grader info from card_lookup query in research agent intents.ts so "show me umbreon vmax psa 10" sends "umbreon vmax" to resolver instead of "umbreon vmax psa 10".
**Files:** `src/card-resolver/resolver.ts` (3 new methods: buildSearchQuery, callSearchCards, buildSearchCandidates + modified resolve), `src/card-resolver/resolver.test.ts` (4 new tests + updated 1 existing), `gacha-research-agent/src/conversation/intents.ts` (grade stripping), `gacha-research-agent/src/conversation/intents.test.ts` (2 modified + 1 new test)
**Result:** Pass — 126/126 core tests, 58/58 research agent tests, typecheck clean
**Lessons:** When adding fallback paths that make new network requests, update existing tests that mock only the primary endpoint — otherwise MSW will log unhandled request errors.

### 2026-02-25 15:30 — [Bugfix] Research agent chat: "No card selected" on inline price queries
**What:** Fixed `handlePrice` in `gacha-research-agent/src/conversation/orchestrator.ts`. When a user typed "how much is umbreon vmax alt art psa 10", the `price` intent matched but `handlePrice` immediately returned "No card selected" without extracting the card name from the message. Added inline card extraction: strips price keywords (`how much`, `is`, `it`, `the`, `psa N`, `grade N`) and routes the remaining card description to `handleCardLookup` for full research (resolve + FMV + grade comparison + eBay deals). Also added 2 new tests.
**Files:** `gacha-research-agent/src/conversation/orchestrator.ts`, `gacha-research-agent/src/conversation/orchestrator.test.ts`
**Result:** Pass — 57/57 tests (2 new), typecheck clean
**Lessons:** The old `chat.ts` REPL in gacha-agent-core had this inline extraction logic, but it was not ported to the research agent's orchestrator. When building a new system (orchestrator) from an existing one (chat.ts), audit all edge-case handling — especially "implicit resolution" paths where the user expects the system to parse a card name embedded in a different intent.
