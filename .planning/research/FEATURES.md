# Feature Research

**Domain:** Agentic trading card buying / marketplace sniper (Pokémon focus)
**Researched:** 2026-02-18
**Confidence:** MEDIUM — competitor products verified via web; eBay Order API access requirements verified via official docs; no direct insider access to closed competitor codebases

---

## Competitive Landscape Summary

| Tool | Category | What It Does | Key Gap |
|------|----------|--------------|---------|
| Collector Crypt (CARDS) | Vault + blockchain sniper | eBay auction sniper → vault → tokenize; last-second bidding; 1% success fee; $10M+ bids placed | Requires blockchain/vault; no watchlist-driven intelligence; no FMV scoring |
| TCGSniper | Price drop alert | Monitors TCGPlayer price, emails/SMS/Discord when target price hit; 15 alerts free | TCGPlayer only, no eBay, no agentic buying |
| TCGPriceAlert | Price drop alert | TCGPlayer monitor, email + Telegram alerts; Chrome extension | No purchase execution, TCGPlayer only |
| Gixen / AuctionSniper / JustSnipe | eBay auction sniper | Last-second bid placement; group bidding; no computer required | No card intelligence; no FMV comparison; no watchlist |
| PokemonPriceTracker | Pricing API | 50,000+ cards, PSA price history, daily updates, grading ROI calculator | Passive tool — alerts and buying not supported |
| PokeDATA | Portfolio + price | Collection value tracking, price trend monitoring | No buying or alerting |
| Collectr | Portfolio manager | 200,000+ products, raw + graded + sealed | No scanning or buying |
| Telegram TCG channels | Deal sharing | Community-curated deals posted to channel | Manual, no automation |

**Key finding:** No competitor combines (a) FMV-aware deal scoring, (b) watchlist-driven scanning, (c) Telegram alert with one-command purchase execution, and (d) AI natural language card resolution. The "AI agent" layer is genuinely absent in the card buying space, even as agentic commerce explodes broadly in 2026.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or untrustworthy.

| Feature | Why Expected | Complexity | Existing? | Notes |
|---------|--------------|------------|-----------|-------|
| Watchlist with target price | Every sniper tool has this; fundamental UX contract | LOW | YES (hardening needed) | CRUD exists via WatchlistManager + JSON storage |
| Real-time deal alerts | Users demand notification the moment a deal appears; tolerate 15-min lag max | LOW | YES (hardening needed) | TelegramAlerts exists; deduplication implemented |
| FMV / fair market value comparison | Without FMV, "deal" has no meaning; price alone is useless | MEDIUM | YES (hardening needed) | PriceEngine exists; 30-min cache; single source |
| eBay listing scan | eBay is the primary market for graded Pokémon cards; mandatory source | MEDIUM | YES (hardening needed) | EbayScanner exists; Browse API; query builder |
| Deal score / signal | Raw listings overwhelm; users need a ranked, filtered view | MEDIUM | YES (hardening needed) | DealScorer with weighted algo (60% price vs FMV) |
| Card identity resolution | "Charizard holo first edition PSA 10" must resolve to a canonical card | HIGH | YES (hardening needed) | CardResolver via PokemonPriceTracker API |
| Seller quality filter | Bad sellers are a known eBay risk; excluding <95% feedback is expected | LOW | YES | DealScorer hard-filters <95% feedback sellers |
| Alert deduplication | Users get furious if alerted twice for same listing | LOW | YES | In-memory dedup on itemId+chatId |
| One-command purchase confirmation | Reply-to-buy is the defining UX promise of the product | HIGH | NO | eBay Order API needed; Limited Release approval required |
| Purchase history / receipts | Users must be able to audit what the agent bought on their behalf | MEDIUM | NO | Not built; trust/accountability critical for agentic buying |
| Watchlist management via chat | Adding to watchlist via Telegram message is natural for chat-native UX | MEDIUM | NO | CLI exists; Telegram command parsing not built |

### Differentiators (Competitive Advantage)

Features that set Gacha Agent apart. Not universally expected, but high perceived value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Natural language card resolution | "Pikachu Illustrator PSA 10" → resolved card without knowing set codes | HIGH | Already exists; massive UX advantage — no competitor does this |
| AI deal reasoning in alert | Alert includes human-readable explanation ("27% below FMV, top-rated seller, low PSA pop 34") — not just a raw price | MEDIUM | Already exists in TelegramAlerts.formatDealMessage; unique in market |
| OpenClaw skill distribution | Reaches 145k+ community users without App Store or marketing spend | MEDIUM | Viral distribution channel — OpenClaw skill is the MVP wrapper |
| Graded card population awareness | PSA population count influences true scarcity; low-pop cards are better bets | MEDIUM | DealScorer already uses populationCount; competitors ignore this |
| Auction snipe execution | Agent bids at last second on time-ending auctions, not just Buy It Now | HIGH | Requires eBay Order API (Limited Release) + timing logic; Collector Crypt does this but only for vault/tokenization |
| Multiple FMV sources | Single source FMV can be stale or gamed; multi-source consensus is more reliable | HIGH | Currently single source (PokemonPriceTracker); Alt.xyz, PriceCharting, eBay sold comps in backlog |
| Grade-specific targeting | Watch for "PSA 9" vs "PSA 10" vs "raw" of same card at different target prices | MEDIUM | Types support grade field; WatchlistEntry doesn't yet expose grade-level targeting |
| Portfolio P&L tracking | Show unrealized gains on cards already purchased; validates agent's ROI | HIGH | Out of scope for OpenClaw MVP; relevant for hosted Gacha app (Track 2) |
| SNKRDUNK / international market scanning | Japanese market prices often 20-40% below US FMV; arbitrage opportunity | HIGH | Stretch goal in PROJECT.md; scraping complexity; consider v1.x |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems — document explicitly to prevent scope creep.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Fully autonomous buying (no confirmation) | "Set and forget" sounds ideal | Legal liability if agent overspends or buys wrong card; users lose trust after one bad buy | Keep human-in-the-loop: agent alerts, human confirms with "BUY" — autonomous only after explicit opt-in per watchlist entry |
| TCGPlayer / Cardmarket scanning | More inventory coverage | Different pricing models, API limitations, scraping terms risk, card identity mapping complexity across platforms | eBay-only for v1; add TCGPlayer later when card resolver covers it |
| Real-time (sub-minute) scanning | Faster = more deals caught | eBay Browse API daily limit is 5,000 calls; 1 minute intervals with 50 watchlist items = 72,000 calls/day → banned | 15-minute scan interval with priority queue; alert on best deals not all deals |
| Bulk auto-buying (multiple listings at once) | Build collection faster | Budget management complexity, inventory conflicts, fraud risk if eBay account flagged | Single purchase confirmation per alert; bulk buying as explicit v2 feature with budget caps |
| Image-based card recognition (camera scan) | Seems tech-savvy | Vision model latency, accuracy issues with card condition variance, wrong resolution = wrong purchase | Natural language resolution is faster and more reliable; image scan is a nice-to-have collector feature, not a buying tool feature |
| Price history charts and graphs | Looks impressive in demos | High implementation cost (data storage, charting library), low direct value for buying decisions | Expose raw price data via API; let users use PokeDATA or PokemonPriceTracker for charts |
| Social / sharing features (post deals to Twitter) | Virality appeal | Distraction from core buying loop; auto-posting can expose user's buying strategy | Manually share: the Telegram alert message is already share-friendly; users will share naturally ("my agent sniped a Charizard") |
| Mobile app | Users request mobile | Build cost, App Store approval, push notification complexity | Telegram is the mobile interface; it's on every phone already |
| Multi-marketplace arbitrage engine (buy low sell high) | Profit potential | Requires seller accounts, shipping logistics, tax reporting; different legal domain | Out of scope; if users want to flip, they use their own accounts |

---

## Feature Dependencies

```
[Card Resolution]
    └──required by──> [eBay Scanning]
                          └──required by──> [Deal Scoring]
                                                └──required by──> [Telegram Alert]
                                                                      └──required by──> [Purchase Execution]

[FMV Pricing]
    └──required by──> [Deal Scoring]

[Watchlist CRUD]
    └──required by──> [Scan Scheduler]
                          └──required by──> [eBay Scanning] (batched, rate-limited)

[eBay Order API Access Approval]
    └──required by──> [Purchase Execution]
                          └──required by──> [Purchase History]

[Telegram Bot Setup]
    └──required by──> [Telegram Alert]
    └──required by──> [Watchlist via Chat] (bidirectional Telegram commands)

[OpenClaw Skill Wrapper]
    └──requires──> [All core modules stable] (hardened card resolution, pricing, scanning, scoring, alerts)
    └──enhances──> [Watchlist via Chat] (skill tools map directly to watchlist + scan commands)

[Multiple FMV Sources]
    └──enhances──> [Deal Scoring] (consensus pricing reduces false positives)
```

### Dependency Notes

- **Purchase Execution requires eBay Order API approval:** The Order API is a "Limited Release" API requiring eBay Partner Network application and approval (10+ business day process). This must be applied for immediately — it's on the critical path for the BUY command. Confidence: HIGH (verified via developer.ebay.com official docs).

- **OpenClaw Skill requires all core modules stable:** The skill wrapper is a thin adapter over gacha-agent-core. It cannot ship if card resolution, pricing, or scanning are unreliable. Module hardening is the prerequisite, not an afterthought.

- **Watchlist via Chat requires Telegram bot in bidirectional mode:** Currently TelegramAlerts only sends outbound messages. Receiving "BUY" replies and watchlist commands requires adding a Telegram webhook/polling receiver — separate work from alerting.

- **Multiple FMV sources enhances Deal Scoring but is not required for v1:** Single-source FMV (PokemonPriceTracker) is sufficient for the MVP signal. Multi-source consensus reduces false positives and is a v1.x improvement.

---

## MVP Definition

### Launch With (v1 — OpenClaw Skill)

Minimum viable product to prove the viral thesis and validate demand.

- [ ] **Watchlist CRUD via OpenClaw tool calls** — core interaction loop; users add cards by name, set target price
- [ ] **Card resolution (hardened)** — natural language "Charizard Base Set holo PSA 9" → canonical card; must be reliable or users lose trust immediately
- [ ] **FMV pricing (hardened)** — single source is fine; must not fail silently
- [ ] **eBay scan + deal scoring (hardened)** — end-to-end: watchlist item → eBay listings → scored deals; must handle errors gracefully
- [ ] **Telegram deal alerts (hardened)** — rich formatted message with deal reasoning; dedup working; "View on eBay" link present
- [ ] **"BUY" command receiver** — Telegram bot receives reply, confirms intent, triggers eBay purchase; this is the defining feature that generates the shareable moment
- [ ] **eBay Order API production access** — apply immediately; without this, "BUY" is a dead end; even a "pending approval" launch with manual fallback is acceptable

### Add After Validation (v1.x)

Add once OpenClaw skill is shipping and users are engaging.

- [ ] **Grade-specific watchlist targeting** — "watch for PSA 9 under $200 AND PSA 10 under $500 for same card"; users ask for this as soon as they start using it
- [ ] **Multiple FMV sources** — Alt.xyz + eBay sold comps + PriceCharting; reduces alert false-positives; trust signal for power users
- [ ] **Purchase history log** — audit trail per user; "what did the agent buy for me"; essential for trust after first real purchase
- [ ] **Auction snipe execution** — last-second bidding; requires eBay Order API + auction end-time countdown logic; Collector Crypt's core feature, significant differentiator
- [ ] **Watchlist management via Telegram commands** — `/watch Charizard Base Set Holo PSA 9 under $300` without needing OpenClaw; lowers friction for non-OpenClaw users

### Future Consideration (v2+)

Defer until product-market fit is established via OpenClaw skill.

- [ ] **Portfolio P&L tracking** — holdings, cost basis, unrealized gains; relevant for the hosted Gacha App (Track 2), not OpenClaw skill
- [ ] **SNKRDUNK / Japanese market scanning** — high complexity, high reward; valid only if users are sophisticated enough to want international arbitrage
- [ ] **Multi-source marketplace scanning (TCGPlayer)** — increases inventory coverage but adds card identity mapping complexity
- [ ] **AI-powered price prediction** — "this card is trending up, buy now" signals; requires price history time series; interesting but not core to buying decisions
- [ ] **Seller profile blocklist** — block specific known-bad sellers permanently; niche but high demand from power users
- [ ] **Budget caps and auto-buy thresholds** — set a monthly budget limit; agent auto-buys below threshold without confirmation; only safe after proven track record

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Card resolution (hardened) | HIGH | MEDIUM | P1 |
| FMV pricing (hardened) | HIGH | MEDIUM | P1 |
| eBay scan + deal scoring (hardened) | HIGH | MEDIUM | P1 |
| Telegram alerts (hardened) | HIGH | LOW | P1 |
| OpenClaw skill wrapper | HIGH | MEDIUM | P1 |
| "BUY" command execution (Telegram receiver + eBay Order API) | HIGH | HIGH | P1 |
| eBay Order API production access (apply now) | HIGH | LOW (process, not code) | P1 |
| Watchlist via OpenClaw tool calls | HIGH | LOW | P1 |
| Purchase history / audit log | HIGH | LOW | P2 |
| Grade-specific watchlist targeting | MEDIUM | LOW | P2 |
| Multiple FMV sources | MEDIUM | MEDIUM | P2 |
| Auction snipe execution | HIGH | HIGH | P2 |
| Watchlist management via Telegram commands | MEDIUM | MEDIUM | P2 |
| Portfolio P&L tracking | MEDIUM | HIGH | P3 |
| SNKRDUNK scanning | MEDIUM | HIGH | P3 |
| TCGPlayer scanning | LOW | HIGH | P3 |
| AI price prediction | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for OpenClaw skill launch
- P2: Add post-launch when users validate demand
- P3: Defer to hosted Gacha App (Track 2)

---

## Competitor Feature Analysis

| Feature | Collector Crypt | TCGSniper | Gixen/AuctionSniper | Gacha Agent Approach |
|---------|-----------------|-----------|---------------------|----------------------|
| Watchlist | No (token-based) | Yes (URL-based) | Yes (bid list) | Yes — card name + target price, not URLs |
| FMV comparison | No | No | No | Yes — core of deal scoring |
| Natural language card resolution | No | No | No | Yes — unique differentiator |
| Deal reasoning / explanation | No | No | No | Yes — AI-generated reasoning in alert |
| eBay auction sniping | Yes (with vault) | No | Yes (bid only) | Planned v1.x — without mandatory vault |
| Buy It Now execution | No | No | No | Yes — primary v1 purchase path |
| Alert channel | None (platform) | Email/SMS/Discord | None | Telegram — reply-to-buy UX |
| Graded card population awareness | No | No | No | Yes — PSA pop count in deal score |
| OpenClaw / agent framework | No | No | No | Yes — viral distribution channel |
| Multi-marketplace | No (eBay only) | TCGPlayer only | eBay only | eBay only for v1; extensible |

---

## Sources

- Collector Crypt product documentation: [BingX Learn](https://bingx.com/en/learn/article/what-is-collector-crypt-cards-token-on-solana-and-how-does-it-work), [CoinGecko](https://www.coingecko.com/learn/what-is-collector-crypt-cards) — MEDIUM confidence
- Collector Crypt sniper analytics: [Blockworks](https://blockworks.com/analytics/collector-crypt/collector-crypt-users/collector-crypt-no-of-successful-bids-using-ebay-sniper) — MEDIUM confidence
- TCGSniper feature analysis: [tcgsniper.com](https://tcgsniper.com/) directly fetched — HIGH confidence
- TCGPriceAlert features: [tcgpricealert.com](https://tcgpricealert.com/) — MEDIUM confidence
- eBay Order API (limited release, production approval requirements): [developer.ebay.com/api-docs/buy/static/api-order.html](https://developer.ebay.com/api-docs/buy/static/api-order.html) — HIGH confidence (official docs)
- eBay Buy API requirements: [developer.ebay.com/api-docs/buy/static/buy-requirements.html](https://developer.ebay.com/api-docs/buy/static/buy-requirements.html) — HIGH confidence (official docs)
- OpenClaw skill structure: [docs.openclaw.ai/tools/skills](https://docs.openclaw.ai/tools/skills) directly fetched — HIGH confidence
- OpenClaw ecosystem scale (5,705 skills, 145k community): [WebSearch findings](https://github.com/VoltAgent/awesome-openclaw-skills) — MEDIUM confidence
- Gixen / AuctionSniper / JustSnipe features: [WebSearch](https://www.gixen.com/main/index.php) — MEDIUM confidence
- Agentic commerce 2026 landscape (Amazon Rufus, ChatGPT Buy, Visa agent payments): [Modern Retail](https://www.modernretail.co/technology/why-the-ai-shopping-agent-wars-will-heat-up-in-2026/), [CNBC](https://www.cnbc.com/2025/12/29/ai-agentic-shopping-price-discounts-cheap-sales-commerce-visa-mastercard-chatbots.html) — MEDIUM confidence
- PokemonPriceTracker capabilities: [pokemonpricetracker.com](https://www.pokemonpricetracker.com/) — HIGH confidence (used in existing codebase)
- Portfolio tracking tools (PokeDATA, Collectr): [WebSearch findings](https://www.pokedata.io/portfoliolanding) — MEDIUM confidence

---

*Feature research for: Gacha Agent — agentic Pokémon card buying platform*
*Researched: 2026-02-18*
