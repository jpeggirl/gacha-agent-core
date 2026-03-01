# Pitfalls Research

**Domain:** Agentic marketplace scanner / trading card buyer (Gacha Agent)
**Researched:** 2026-02-18
**Confidence:** HIGH (critical pitfalls verified against official eBay policy, Telegram docs, OpenClaw docs; MEDIUM on pricing/card-specific issues from multiple credible sources)

---

## Critical Pitfalls

### Pitfall 1: eBay Explicitly Bans LLM-Driven Automated Purchasing (Effective Feb 20 2026)

**What goes wrong:**
eBay's updated User Agreement (effective February 20, 2026) explicitly prohibits "buy-for-me agents, LLM-driven bots, or any end-to-end flow that attempts to place orders without human review." Any automated purchase flow — even one that uses the official Buy Order API — violates this agreement without prior written eBay approval. Enforcement includes permanent account suspension and potential legal action.

**Why it happens:**
Developers assume that having API access (client_credentials OAuth) grants permission to automate purchases. It does not. The Buy Browse API is permitted for scanning/searching; order placement requires a separate user-token OAuth flow AND compliance with the User Agreement. The distinction between "scanning with Browse API" and "buying with Order API" was easy to miss before this rule change.

**How to avoid:**
- Do not build a fully automated end-to-end purchase path without a mandatory human confirmation step.
- The safe architecture: agent alerts via Telegram → user reviews → user explicitly triggers purchase (one-tap confirm). This constitutes "human review" under the agreement.
- If full autonomy is required, apply for explicit eBay developer approval before shipping that feature.
- Document in the skill/SKILL.md that the agent will never execute purchase without user acknowledgment.

**Warning signs:**
- Any code path that calls the eBay Order API from a scheduled job without a human-initiated trigger.
- "Auto-buy on strong_buy signal" feature requests in the backlog without a confirmation gate.
- Missing a user-facing confirm/deny flow in the Telegram bot before any purchase.

**Phase to address:**
Purchase execution phase (whenever Buy Order API integration is planned). Confirmation gate must be a hard requirement, not an optional enhancement.

---

### Pitfall 2: In-Memory Deduplication State Lost on Restart — Duplicate Alerts

**What goes wrong:**
`TelegramAlerts.sentAlerts` is an in-memory `Set<string>`. `ScanScheduler.sentAlertKeys` is also an in-memory `Set<string>`. When the process restarts, both sets reset to empty. This causes every previously-seen deal to be re-alerted on next startup — potentially flooding the Telegram chat with hundreds of duplicate notifications.

**Why it happens:**
In-memory deduplication is the easiest implementation but has no persistence. The current `JsonStorageAdapter` persists watchlist state but deduplication state is not stored. Process restarts happen normally (deploys, crashes, server reboots).

**How to avoid:**
- Store sent alert keys in the persistent `JsonStorageAdapter` (or Supabase) under a prefix like `alert:sent:{itemId}:{entryId}`.
- Set a TTL on stored alert keys (e.g., 7 days) so the store does not grow unbounded.
- On scheduler startup, load the persisted sent-alert set instead of starting empty.

**Warning signs:**
- User reports receiving the same deal alert multiple times after a bot restart.
- Sent-alert Set size never persists across process lifetimes.
- No `alert:sent:` keys written to `gacha-agent-data.json`.

**Phase to address:**
Production hardening phase — this is a regression risk that will manifest on the first real deploy that gets restarted.

---

### Pitfall 3: FMV Based on Thin-Market / Stale Price Data — Agent Buys at Wrong Price

**What goes wrong:**
The `PriceEngine` uses median price from the PokemonPriceTracker API with a 30-minute in-memory cache. For low-population PSA graded cards (pop < 50), there may be only 1-3 comparable sales in the dataset — making the "median" unreliable. A single outlier sale (shill bid, distressed seller, estate sale) can shift the median 30-50% from true FMV. The deal scorer then flags an overpriced listing as "fair" or even "buy," or flags a genuine deal as "avoid."

**Why it happens:**
Median is more robust than mean for large datasets, but with N=2 or N=3 price points it is just as fragile. Rare cards by definition have thin markets. The system has no awareness of how many comparable sales back the FMV figure.

**How to avoid:**
- Surface `prices.length` in `FairMarketValue` and expose it as a confidence signal.
- When `prices.length < 5`, add a "low-data" warning to the Telegram alert and downgrade the deal signal one level (e.g., `strong_buy` → `buy`, `buy` → `fair`).
- Consider age-weighting: sales older than 90 days should count for less in volatile card markets.
- Log a warning when FMV is backed by fewer than 3 sales points.

**Warning signs:**
- Cards with `populationCount < 50` receiving `strong_buy` signals.
- FMV for an ultra-rare card showing a precise round number (e.g., exactly $1,000) with only 1 price point.
- Alert for a card that last sold publicly 6+ months ago.

**Phase to address:**
Pricing engine hardening phase. Must be addressed before any purchase automation is enabled.

---

### Pitfall 4: Card Disambiguation Failure — Wrong Card Gets Purchased

**What goes wrong:**
The `CardResolver` resolves a user's natural-language query to a specific card. The confidence threshold is 0.7. At confidence 0.71, the system proceeds as if the match is correct. For common card names with many variants ("Charizard ex," "Pikachu Promo"), a wrong match means the agent sends buy-signal alerts for the wrong card — potentially triggering a purchase of a $50 card when the user wanted a $2,000 card (or vice versa).

**Why it happens:**
The V2 API `computeRelevanceAdjustment` heuristics add/subtract confidence deltas based on keyword matching. The final confidence value can land just above 0.7 due to numeric coincidence rather than true semantic certainty. There is no human review gate when `needsDisambiguation` is false but confidence is only 0.71-0.79.

**How to avoid:**
- Add a second confidence tier: `HIGH_CONFIDENCE >= 0.85` proceeds automatically; `MEDIUM_CONFIDENCE 0.70-0.84` sends a disambiguation request to Telegram ("Did you mean X? Reply YES/NO") before adding to watchlist.
- Never start scanning based on a `MEDIUM_CONFIDENCE` resolution without user confirmation.
- Store the original `confidence` on `WatchlistEntry` and surface it in alerts ("Matched with 73% confidence").

**Warning signs:**
- `WatchlistEntry.card.confidence` between 0.70 and 0.84 with no disambiguation prompt sent.
- Multiple cards with similar names in the watchlist (e.g., two "Charizard ex" entries with different IDs).
- User complaining that alerts are for the wrong Charizard.

**Phase to address:**
Card resolution hardening — add the disambiguation Telegram confirmation flow before watchlist additions go live.

---

### Pitfall 5: OpenClaw SKILL.md Description Mismatch — Skill Never Invoked

**What goes wrong:**
OpenClaw decides whether to invoke a skill based on the `description` field in the SKILL.md frontmatter, not the full instruction body. If the description does not match how a user asks for the task, the skill is silently ignored. The agent proceeds without the Gacha-specific context and gives generic or wrong responses.

**Why it happens:**
Developers treat the description as documentation ("This skill helps you find deals on Pokemon cards"). OpenClaw uses it as a trigger-phrase classifier. The full skill body is only loaded after the description matches. A mismatch means the skill never loads.

**How to avoid:**
- Write the description to mirror natural user phrasing: "Find deals on eBay for Pokemon trading cards, check prices, and alert on underpriced PSA-graded cards."
- Test the skill by phrasing queries exactly as users would and verifying skill activation in OpenClaw's verbose logging.
- Keep descriptions under 2 sentences; longer descriptions dilute the trigger signal.
- Each skill in the system must have a unique, non-overlapping description to avoid ambiguous selection.

**Warning signs:**
- Agent answers card deal questions without surfacing watchlist or eBay data.
- Skill appears installed but `openclaw --verbose` shows it not being selected.
- Description uses third-person ("This skill...") instead of action-oriented language.

**Phase to address:**
OpenClaw skill wrapper phase — description wording must be validated with real user queries before the skill ships.

---

### Pitfall 6: eBay Browse API Rate Limit Exhausted by Poorly Prioritized Scans

**What goes wrong:**
The eBay Browse API has a hard limit of 5,000 calls per day by default. With `maxConcurrentScans: 3` and a 15-minute `scanIntervalMs`, a watchlist of 20 cards would use 20 calls every 15 minutes = 1,920 calls in 24 hours — fine. But as the watchlist grows to 50+ cards, or if scan intervals are shortened, the daily quota is exhausted before midnight. After exhaustion, no new scans or alerts fire until midnight UTC reset, silently degrading the product.

**Why it happens:**
The daily counter reset is per-UTC-midnight (`resetDailyCountersIfNeeded`), but the effective budget math is not exposed to the operator. When the limit is hit mid-day, the scheduler logs one message and stops — there is no alert sent to the operator.

**How to avoid:**
- Implement proactive rate limit budget tracking: calculate `callsPerDay = (86400000 / scanIntervalMs) * watchlistSize` and warn when > 70% of daily limit.
- Send a Telegram operator alert when `ebayCallsToday > ebayDailyLimit * 0.8`.
- Priority-sort the watchlist so high-priority cards (e.g., highest target price, most recently added) get scanned even when budget is tight.
- Apply for eBay rate limit increase via Application Growth Check before watchlist exceeds 100 entries.

**Warning signs:**
- `[Scheduler] eBay daily rate limit reached — stopping` log before 18:00 UTC.
- User reports no alerts despite active watchlist entries.
- `ebayCallsToday` reaching limit without any operator notification.

**Phase to address:**
Production hardening phase — add operator alerts for rate budget exhaustion.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| In-memory deduplication Set | Zero implementation overhead | Duplicates on every restart | Never in production |
| JSON file storage with full-rewrite on every set() | Simple to implement | Write amplification; data corruption risk on crash mid-write | MVP/dev only, must migrate to append-safe storage before production |
| Single-grade scan (hardcoded PSA 9 default) | Simpler query building | Misses deals on PSA 8 or 10 of the same card | Acceptable MVP, document explicitly |
| 30-minute in-memory price cache | Reduces API calls | Stale FMV during rapid market moves | Acceptable if TTL warning is surfaced in alerts |
| No spend limit on automated purchases | Fast to prototype | Catastrophic runaway spend if triggered incorrectly | Never — a per-session spend cap is non-negotiable |
| Secrets in openclaw.json (not env vars) | Convenient for local dev | Credential exposure if file committed or shared | Never in production |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| eBay Browse API | Using `client_credentials` grant for order placement — this token only has application-level scope, cannot make purchases on behalf of a user | Purchase flows require user OAuth (authorization code grant) with `buy.order` scope |
| eBay Browse API | Not handling `itemEndDate` for auctions — scoring an auction that ends in 5 minutes same as one with 3 days left | Filter out auctions ending in < 30 minutes or downgrade their deal score |
| eBay Browse API | Including shipping cost as 0 when `shippingOptions` array is empty rather than absent — some BIN listings have undisclosed shipping | Treat missing shippingOptions as unknown (not free); flag in alert |
| PokemonPriceTracker API | Not normalizing the base URL (`pokemonpricetracker.com` → `www.pokemonpricetracker.com`) causes auth header stripping on redirect | Already handled in codebase; must ensure this is applied to ALL fetch paths, including any new endpoints added in future |
| Telegram Bot API | Not respecting `retry_after` in 429 responses — retrying immediately triggers IP-level blacklisting for 30 seconds | Extract `retry_after` from 429 response body and wait that duration + jitter before retry |
| Telegram Bot API | Sending HTML-formatted messages with unescaped `<` or `&` characters from card names/titles — Telegram rejects with parse error | Sanitize all user-generated content (card names, listing titles, seller usernames) before embedding in HTML template |
| OpenClaw SKILL.md | Putting credentials directly in SKILL.md — OpenClaw warns this is unsafe | Reference env var names only in SKILL.md; actual values via `.env` or `openclaw.json` |
| OpenClaw SKILL.md | YAML frontmatter `metadata` field cannot span multiple lines — parser silently ignores multi-line metadata | Keep `metadata` as a single-line JSON object |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `JsonStorageAdapter` full-rewrite on every `set()` | Increasing write latency; occasional data corruption under concurrent writes | Switch to SQLite or Supabase before multi-user deployment | At ~1,000 watchlist entries or any concurrent write scenario |
| `Promise.all` on `maxConcurrentScans` without back-pressure | eBay API burst rejection; Telegram flood if all scans find deals simultaneously | Rate-limit eBay calls across the concurrent batch; queue Telegram sends with 1/s pacing | When watchlist > 20 entries with short scan interval |
| In-memory price cache not shared across instances | Each server instance re-fetches FMV independently — multiplies API cost | Move cache to Redis or Supabase KV before horizontal scaling | First horizontal scale-out |
| Growing `sentAlertKeys` Set in scheduler | Memory growth; no GC ever runs on this Set | TTL on persisted alert keys; prune keys older than 7 days | After ~30 days of continuous operation with large watchlist |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| eBay `appId` and `certId` in unencrypted JSON storage or committed env files | Credential theft allows attacker to exhaust eBay API quota or conduct scraping under your developer identity | Use environment variables; never commit `.env`; rotate keys if exposed |
| Telegram bot token in logs or error messages | Anyone with the token can send messages to all watched chats, impersonate alerts, or drain the watchlist | Redact bot token from all log output; use structured logging with a secrets filter |
| No server-side validation of watchlist `targetPrice` | A malicious API client could set targetPrice to $0.01, causing alerts for every listing | Validate `targetPrice > 0` and `targetPrice < reasonable_max` (e.g., $50,000) at API ingress |
| Accepting card `id` from untrusted client without re-verifying against resolver | Client supplies a valid-looking card ID that maps to a different, more valuable card — buy-signal mismatch | Always re-resolve card identity server-side when used in financial context; never trust client-supplied card IDs |
| OpenClaw running with full user permissions | Agent can read credentials, AWS keys, SSH keys from host filesystem | Run OpenClaw in a sandboxed container with minimal filesystem access; no production credentials on the host |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Alerting on every listing that meets score threshold without ranking | User gets 12 Telegram messages for the same card — they mute the bot | Deduplicate to best 1-2 deals per card per scan cycle; batch into a single message |
| Alert says "20% below FMV" without explaining what FMV is or how many sales back it | User distrusts the number; makes purchase on gut feel anyway | Include price point count in alert: "FMV $450 (based on 8 sales)" |
| No way to acknowledge or dismiss an alert in Telegram | Watchlist fills with "seen" deals that keep re-alerting | Add a "Got it / Stop watching" inline button to each alert |
| Disambiguation requests sent via Telegram with no timeout | User never responds; card stays in limbo — never added to watchlist | Auto-expire disambiguation after 24 hours with a "Resolution timed out, please re-add" message |
| Deal score shown as 73/100 with no explanation of what that means | Users make purchase decisions without understanding the scoring | Show score component breakdown (price vs FMV, seller rep, listing type) in a "Details" inline button |

---

## "Looks Done But Isn't" Checklist

- [ ] **Deduplication:** Alert deduplication is in-memory only — verify that `sentAlerts` state survives process restart by checking storage for persisted alert keys.
- [ ] **FMV data quality:** Price engine returns FMV — verify `prices.length` is exposed and low-data scenarios produce a warning, not a confident signal.
- [ ] **Card confidence gate:** Resolver returns a match — verify confidence 0.70-0.84 triggers a Telegram disambiguation prompt before adding to watchlist.
- [ ] **eBay rate budget alerts:** Scheduler has a daily limit — verify an operator Telegram notification fires when 80% of daily eBay budget is consumed.
- [ ] **Purchase flow legality:** Buy signal sent — verify no automated purchase execution exists without an explicit human confirmation step.
- [ ] **OpenClaw skill activation:** Skill file is installed — verify skill actually gets selected by querying in the ways users naturally phrase card deal requests.
- [ ] **Telegram HTML escaping:** Alerts format correctly — verify card names with special characters (e.g., `Farfetch'd`, `Nidoran♀`) do not break HTML parse_mode.
- [ ] **Shipping cost unknown vs free:** eBay listing has no `shippingOptions` — verify this is treated as "unknown shipping" not "free shipping" in total price calculation.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Duplicate alerts sent after restart | LOW | Clear Telegram chat; add persistence for deduplication state; announce to users |
| Wrong card purchased due to confidence threshold too low | HIGH | Initiate eBay return request; review and raise confidence threshold; add mid-confidence disambiguation gate |
| eBay developer account suspended | HIGH | Contact eBay developer support; remove automation; demonstrate ToS compliance; may require new developer account |
| FMV-based bad purchase (card overpriced vs. actual market) | MEDIUM | Initiate eBay return; add FMV data-quality gates; cross-reference second pricing source |
| LLM cost runaway (agentic loop in OpenClaw skill) | MEDIUM | Kill OpenClaw process; review skill for unbounded tool call loops; add max-iteration guard in skill instructions |
| Telegram bot rate limited (IP blacklisted 30s) | LOW | Wait 30s; implement retry_after-aware retry queue; add jitter to all sends |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Automated purchasing violates eBay ToS | Purchase execution phase — enforce mandatory human confirmation gate | Code review: no Order API calls outside user-triggered handler |
| In-memory deduplication lost on restart | Production hardening phase | Restart process; verify no duplicate alerts appear in Telegram |
| Stale/thin FMV data causes wrong deal signal | Pricing engine hardening phase | Unit test: FMV with N<5 price points produces low-data warning and downgraded signal |
| Card disambiguation failure (wrong card) | Card resolution hardening phase | Integration test: confidence 0.73 triggers Telegram confirm prompt, not immediate watchlist add |
| OpenClaw skill not invoked due to description mismatch | OpenClaw skill wrapper phase | Manual test: 10 natural-language phrasings of "find me a deal on Charizard" all activate skill |
| eBay Browse API daily quota exhausted silently | Production hardening phase | End-to-end test: mock rate limit hit at 80% → operator Telegram notification fires |
| Telegram HTML parse errors from unescaped card names | Alert hardening phase | Unit test: alert formatter with `Farfetch'd` and `Nidoran♀` produces valid HTML output |
| JSON storage corruption on concurrent write | Storage migration phase | Load test: concurrent watchlist updates do not corrupt `gacha-agent-data.json` |

---

## Sources

- eBay User Agreement update (effective Feb 20, 2026): https://www.valueaddedresource.net/ebay-bans-ai-agents-updates-arbitration-user-agreement-feb-2026/
- eBay developer API call limits (verified Feb 2026): https://developer.ebay.com/develop/get-started/api-call-limits
- eBay OAuth token types and scopes: https://developer.ebay.com/api-docs/static/oauth-token-types.html
- eBay Browse API overview: https://developer.ebay.com/api-docs/buy/browse/overview.html
- Telegram Bot API rate limiting (Bots FAQ): https://core.telegram.org/bots/faq
- Telegram retry_after and 429 handling: https://telegramhpc.com/news/574/
- OpenClaw skills documentation: https://docs.openclaw.ai/tools/skills
- OpenClaw runaway loop issue (GitHub): https://github.com/openclaw/openclaw/issues/3181
- OpenClaw skill troubleshooting: https://openclawskill.cc/blog/openclaw-skill-troubleshooting-15-common-errors
- LLM token cost scaling at agentic scale: https://medium.com/@klaushofenbitzer/token-cost-trap-why-your-ai-agents-roi-breaks-at-scale-and-how-to-fix-it-4e4a9f6f5b9a
- PWCC shill bidding case (eBay graded cards): https://boardroom.tv/pwcc-ebay-shill-bidding/
- AI agent guardrails and spend limits: https://www.reco.ai/hub/guardrails-for-ai-agents
- Cisco blog on OpenClaw security model: https://blogs.cisco.com/ai/personal-ai-agents-like-openclaw-are-a-security-nightmare

---
*Pitfalls research for: Agentic marketplace scanner / Pokemon card buyer (Gacha Agent)*
*Researched: 2026-02-18*
