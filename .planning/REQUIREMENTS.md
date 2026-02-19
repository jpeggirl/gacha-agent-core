# Requirements: Gacha Agent

**Defined:** 2026-02-18
**Core Value:** The agent eliminates the tedious work of manually searching, comparing, and sniping card deals — users set what they want and the agent handles the rest.

## v1 Requirements

Requirements for initial release (OpenClaw skill MVP). Each maps to roadmap phases.

### Card Resolution

- [x] **CARD-01**: User can resolve a card from natural language description (e.g. "Charizard Base Set holo PSA 10") to a canonical card identity
- [x] **CARD-02**: Card resolver handles ambiguous queries by returning ranked candidates with confidence scores
- [x] **CARD-03**: Card resolver surfaces disambiguation options when confidence is below threshold

### Pricing

- [x] **PRICE-01**: User can get fair market value (FMV) for any graded Pokémon card from PokemonPriceTracker
- [x] **PRICE-02**: FMV results are cached (30-min TTL) to avoid redundant API calls
- [x] **PRICE-03**: FMV lookup returns population count alongside price data

### Deal Scoring

- [x] **SCORE-01**: Each eBay listing is scored (0-100) against FMV using weighted algorithm (price vs FMV, seller rep, listing type, population rarity)
- [x] **SCORE-02**: Each listing receives a signal classification (strong_buy, buy, fair, overpriced, avoid)
- [x] **SCORE-03**: Seller quality filter excludes sellers with <95% feedback from positive signals
- [x] **SCORE-04**: Deal score includes human-readable reasoning text explaining the signal

### Scanning

- [x] **SCAN-01**: Agent scans eBay Browse API for listings matching a resolved card
- [x] **SCAN-02**: Scanner builds optimized search queries from card name, set, variant, and grade
- [x] **SCAN-03**: Scan scheduler processes active watchlist entries on configurable interval (default 15 min)
- [x] **SCAN-04**: Scheduler prioritizes entries by last scan time (oldest first) with batch concurrency limits
- [x] **SCAN-05**: Scheduler respects daily API rate limits (eBay 5000/day, pricing 100/day)

### Watchlist

- [x] **WATCH-01**: User can add a card to watchlist with target price and grade
- [x] **WATCH-02**: User can remove cards from watchlist
- [x] **WATCH-03**: User can list all active watchlist entries
- [x] **WATCH-04**: Watchlist entries support grade-specific targeting (e.g. PSA 9 at $200, PSA 10 at $500 for same card)
- [x] **WATCH-05**: Watchlist persists across process restarts via StorageAdapter

### Alerts

- [x] **ALERT-01**: Agent sends formatted deal alerts to Telegram with card info, listing price vs FMV, deal score, and reasoning
- [ ] **ALERT-02**: Alert includes inline keyboard with "View on eBay" deep-link button for human-confirmed purchase
- [x] **ALERT-03**: Alert deduplication persists across process restarts (not just in-memory)
- [x] **ALERT-04**: Alerts respect Telegram rate limits to avoid bot throttling

### Testing & Tuning

- [ ] **TEST-01**: CLI test mode allows running live scans and scoring against real APIs from terminal
- [ ] **TEST-02**: Simulation mode can replay saved eBay API responses to tune scoring thresholds without hitting live APIs
- [ ] **TEST-03**: Simulation mode supports saving real API responses for later replay

### OpenClaw Skill

- [ ] **SKILL-01**: SKILL.md manifest describes agent capabilities with natural-language trigger descriptions
- [ ] **SKILL-02**: Skill exposes tools for watchlist management, scanning, price checking via HTTP endpoints
- [ ] **SKILL-03**: Heartbeat and registration endpoints allow agent lifecycle management
- [ ] **SKILL-04**: Skill published to ClawHub registry for discovery and installation

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhanced Pricing

- **PRICE-04**: Multiple FMV sources (Alt.xyz, PriceCharting, eBay sold comps) with weighted consensus
- **PRICE-05**: FMV data quality warnings when population count < 5 (thin market signal)

### Enhanced Alerts & Purchase

- **ALERT-05**: Watchlist management via Telegram chat commands (add/remove by messaging bot)
- **ALERT-06**: Purchase history tracking (what was bought, when, at what price)

### Execution

- **EXEC-01**: eBay Buy It Now purchase execution via Order API (requires Limited Release approval)
- **EXEC-02**: Auction snipe execution (last-second bid placement)
- **EXEC-03**: Spend caps and daily budget limits as safety guardrails

### Portfolio

- **PORT-01**: Portfolio tracker with holdings, cost basis, unrealized P&L
- **PORT-02**: Daily FMV refresh for all portfolio holdings
- **PORT-03**: Portfolio summary generation for agent relay

### Additional Scanning

- **SCAN-06**: SNKRDUNK marketplace scanning for Japanese market arbitrage
- **SCAN-07**: TCGPlayer scanning

## Out of Scope

| Feature | Reason |
|---------|--------|
| Fully autonomous buying (no confirmation) | eBay ToS bans LLM-driven automated purchasing without human review (Feb 2026). Legal liability. |
| Vault/tokenization infrastructure | Requires physical vault partner, not ready yet |
| Gacha marketplace | Depends on vault + tokenization pipeline |
| Sports cards / non-Pokémon | Pokémon only for v1 — focused card resolution |
| Mobile app | Telegram is the mobile interface |
| Price history charts | High cost, low buying-decision value — use PokemonPriceTracker for charts |
| Image-based card recognition | NL resolution is faster and more reliable |
| Multi-marketplace arbitrage | Different legal domain, requires seller accounts |
| Real-time (<1 min) scanning | eBay API limits make this unsustainable (5000 calls/day) |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CARD-01 | Phase 2 | Complete |
| CARD-02 | Phase 2 | Complete |
| CARD-03 | Phase 2 | Complete |
| PRICE-01 | Phase 2 | Complete |
| PRICE-02 | Phase 2 | Complete |
| PRICE-03 | Phase 2 | Complete |
| SCORE-01 | Phase 2 | Complete |
| SCORE-02 | Phase 2 | Complete |
| SCORE-03 | Phase 2 | Complete |
| SCORE-04 | Phase 2 | Complete |
| SCAN-01 | Phase 2 | Complete |
| SCAN-02 | Phase 2 | Complete |
| SCAN-03 | Phase 7 | Pending |
| SCAN-04 | Phase 7 | Pending |
| SCAN-05 | Phase 7 | Pending |
| WATCH-01 | Phase 2 | Complete |
| WATCH-02 | Phase 2 | Complete |
| WATCH-03 | Phase 2 | Complete |
| WATCH-04 | Phase 7 | Pending |
| WATCH-05 | Phase 2 | Complete |
| ALERT-01 | Phase 2 | Complete |
| ALERT-02 | Phase 3 | Pending |
| ALERT-03 | Phase 2 | Complete |
| ALERT-04 | Phase 2 | Complete |
| TEST-01 | Phase 6 | Pending |
| TEST-02 | Phase 6 | Pending |
| TEST-03 | Phase 6 | Pending |
| SKILL-01 | Phase 4 | Pending |
| SKILL-02 | Phase 4 | Pending |
| SKILL-03 | Phase 4 | Pending |
| SKILL-04 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 31
- Unmapped: 0

---
*Requirements defined: 2026-02-18*
*Last updated: 2026-02-19 after v1.0 audit gap closure — SCAN-03/04/05/WATCH-04 assigned to Phase 7*
