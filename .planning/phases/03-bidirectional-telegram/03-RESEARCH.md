# Phase 3: Bidirectional Telegram and BUY Command — Research

**Researched:** 2026-02-19
**Domain:** grammy 1.40.0 — inline keyboards, long-polling, error handling
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Alert message content**
- Extend existing Phase 2 alert format — do NOT redesign the message
- Add a single inline keyboard button: "View on eBay" that deep-links directly to the eBay listing URL
- No BUY button on the alert (deferred to Phase 5)
- No raw URL in the message body — button only

**Alert signal filter**
- Only send alerts for `strong_buy` and `buy` signals
- Do not alert on `fair`, `overpriced`, or `avoid` signals

**Bot polling setup**
- Polling auto-starts when the server boots, same as alert sending — activated when Telegram token is configured
- Unknown/unhandled incoming messages receive a short acknowledgment reply (e.g. "Got it — more commands coming soon")
- Polling crash behavior: log the error and crash the process — let the process manager (e.g. pm2, systemd) restart it

### Claude's Discretion
- Polling mode vs webhook: Claude picks (long-polling preferred — simpler, no public URL required, grammy has first-class support)
- Alert batching: Claude picks (separate message per deal is simpler and preserves per-message inline keyboards)
- Acknowledgment message exact wording

### Deferred Ideas (OUT OF SCOPE)
- **BUY command trigger** (reply to alert with "buy") — Phase 5
- **Confirmation step design** (inline keyboard with Confirm/Cancel, timeout behavior, listing data shown at confirmation) — Phase 5
- **Per-session spend limits** — Phase 5
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ALERT-02 | Alert includes inline keyboard with "View on eBay" deep-link button for human-confirmed purchase | grammy `InlineKeyboard.url()` + pass as `reply_markup` in `sendMessage` options; verified via grammy official docs |
</phase_requirements>

---

## Summary

Phase 3 has two independent tasks: (1) add an inline keyboard button to outgoing deal alerts, and (2) start bot long-polling so the bot receives messages. Both use grammy 1.40.0, which is already installed and in use. No new dependencies are required.

The inline keyboard change is surgical: `sendDealAlert` currently calls `bot.api.sendMessage` with only `parse_mode` and `link_preview_options`. The change is to add a `reply_markup` field containing a single `InlineKeyboard.url("View on eBay", listing.itemUrl)` button — one extra import and three extra lines. The existing `<a href="...">View on eBay →</a>` link in the message body must be removed as a locked decision requires button-only, no raw URL in body.

Bot polling is added by exposing `bot.start()` on the `TelegramAlerts` class (or a thin wrapper). The call does not need to be awaited — grammy's `bot.start()` returns a Promise that never resolves while running. It must be called after registering the `bot.on('message')` catch-all handler. Error handling: install `bot.catch()` before `bot.start()`. On errors in the polling loop itself (not middleware), grammy's default behavior re-throws, crashing the process — which matches the locked decision. Signal filtering (`strong_buy` and `buy` only) is added in `scanEntry` inside `ScanScheduler` rather than in `TelegramAlerts`, keeping alerts dumb and filters in business logic.

**Primary recommendation:** Two focused changes to `telegram.ts` (inline keyboard + `startPolling`/`stopPolling` methods) and one filter addition in `scan-scheduler.ts`. No new packages needed.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| grammy | 1.40.0 (installed) | Bot framework — inline keyboards, polling, error handling | Already in use; `InlineKeyboard` and `bot.start()` are core exports |
| @grammyjs/transformer-throttler | 1.2.1 (installed) | Proactive rate-limit throttling on outgoing API calls | Already installed on `bot.api`; handles Telegram send-rate limits |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @grammyjs/auto-retry | — | Reactive retry on 429 from outgoing API calls | Would complement throttler; NOT required for Phase 3 since throttler already handles outgoing rate limits and polling 429s are rare in low-traffic bots |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| grammy long-polling (`bot.start()`) | webhooks | Webhooks require public HTTPS URL — adds infrastructure complexity; polling is simpler for dev/small-scale |
| One message per deal | Batched message | Batching would lose per-message inline keyboard attachment; locked decision is one message per deal |

**Installation:** No new packages needed. All required APIs (`InlineKeyboard`, `bot.start()`, `bot.on()`, `bot.catch()`) are exported from `grammy` core.

---

## Architecture Patterns

### Recommended Change Scope

```
src/
├── alerts/
│   └── telegram.ts          # 2 changes: inline keyboard on sendDealAlert, + startPolling/stopPolling
├── scheduler/
│   └── scan-scheduler.ts    # 1 change: signal filter before calling sendDealAlert
└── server.ts                # 1 change: call alerts.startPolling() after scheduler.start()
```

### Pattern 1: Inline Keyboard on an Existing sendMessage Call

**What:** Add `reply_markup` with a single URL button to the existing `bot.api.sendMessage` call in `sendDealAlert`.

**When to use:** Any time you attach an inline keyboard to an outgoing message via the raw API (not `ctx.reply`).

**Example:**
```typescript
// Source: https://grammy.dev/plugins/keyboard + https://grammy.dev/guide/api
import { Bot, InlineKeyboard } from 'grammy';

const keyboard = new InlineKeyboard()
  .url('View on eBay', listing.itemUrl);

await this.bot.api.sendMessage(targetChatId, message, {
  parse_mode: 'HTML',
  link_preview_options: { is_disabled: false },
  reply_markup: keyboard,  // InlineKeyboard instance accepted directly
});
```

The `InlineKeyboard` instance is passed directly as `reply_markup` — grammy serializes it automatically. No manual JSON construction needed.

**Remove from message body:** The existing `<a href="${listing.itemUrl}">View on eBay →</a>` line in `formatDealMessage` must be removed (locked: button only, no raw URL in body).

### Pattern 2: Long Polling with Message Handler

**What:** Register a catch-all message handler then start polling. Polling is non-blocking — do not await `bot.start()`.

**When to use:** When you need the bot to receive incoming messages.

**Example:**
```typescript
// Source: https://grammy.dev/guide/deployment-types + https://grammy.dev/guide/errors
import { Bot, InlineKeyboard } from 'grammy';

// Register handler BEFORE bot.start()
this.bot.on('message', async (ctx) => {
  await ctx.reply('Got it — more commands coming soon.');
});

// Install error handler BEFORE bot.start()
this.bot.catch((err) => {
  console.error('[Telegram] Handler error:', err.error);
  // Do NOT re-throw — keeps polling alive despite handler errors
  // Per locked decision: crash on polling loop errors (handled by grammy default)
});

// Start polling — do NOT await; Promise never resolves while running
void this.bot.start({
  allowed_updates: ['message'],
  onStart: (info) => console.log(`[Telegram] Polling started as @${info.username}`),
});
```

**Key:** `bot.on('message')` fires for ALL message update types (text, photo, sticker, etc.). If you only need text, use `bot.on('message:text')`.

**Key:** `void this.bot.start(...)` — intentionally not awaited. grammy docs: "You don't need to await the call."

### Pattern 3: Signal Filter in Scheduler (not in TelegramAlerts)

**What:** Filter to `strong_buy`/`buy` signals before calling `alerts.sendDealAlert`, keeping alert concerns out of `TelegramAlerts`.

**When to use:** Business filtering belongs in the orchestrator (scheduler), not in the transport (alerts).

**Example:**
```typescript
// In scan-scheduler.ts scanEntry(), before the existing alert loop
const alertDeals = scoredDeals.filter(
  (deal) =>
    deal.score >= this.config.minDealScore &&
    deal.listing.totalPrice <= entry.targetPrice &&
    (deal.signal === 'strong_buy' || deal.signal === 'buy'),  // Phase 3 addition
);
```

### Pattern 4: Polling Lifecycle in server.ts

**What:** Call `startPolling()` after `scheduler.start()` in the same `if (config.ebay && config.telegram)` block.

**Example:**
```typescript
// In server.ts main(), after scheduler.start()
if (config.ebay && config.telegram) {
  const alerts = new TelegramAlerts(config, storage);
  // ... scheduler setup ...
  scheduler.start();
  alerts.startPolling();  // Non-blocking; bot.start() called internally
  console.log('[Server] Telegram polling started');
}

// In shutdown handler:
const shutdown = () => {
  scheduler?.stop();
  alerts?.stopPolling();
  server.close(() => process.exit(0));
};
```

### Anti-Patterns to Avoid

- **Awaiting `bot.start()`:** This blocks forever. Always use `void bot.start()` or call without await.
- **Re-throwing in `bot.catch()`:** If you re-throw inside `bot.catch()`, grammy's default handler re-throws again, crashing. For handler errors (not polling loop errors), swallow and log. The polling loop itself crashes on its own errors per grammy default behavior — this matches the locked decision.
- **Starting polling before registering handlers:** `bot.on()` must be called before `bot.start()`.
- **Putting the eBay link in both the message body AND the button:** Locked decision is button-only. Remove the existing `<a href="...">` HTML link from `formatDealMessage`.
- **Registering polling in TelegramAlerts constructor:** Constructor should remain synchronous. Expose `startPolling()`/`stopPolling()` as explicit methods called by `server.ts`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Inline keyboard button | Manual `{ inline_keyboard: [[{ text, url }]] }` JSON | `new InlineKeyboard().url(text, url)` | grammy serializes correctly; builder handles row/column layout and escaping |
| Rate limit retry on sends | Custom exponential backoff | `apiThrottler()` (already installed) | Already on `bot.api`; handles Telegram's per-chat and global limits |
| Polling loop | Manual `getUpdates` loop with sleep | `bot.start()` | grammy handles timeout negotiation, update offset tracking, and error recovery |

**Key insight:** grammy's polling loop manages the entire `getUpdates` state machine. Manual polling would need to track `update_id` offset, handle Telegram's long-poll timeout (30s), and manage error recovery — all handled internally by `bot.start()`.

---

## Common Pitfalls

### Pitfall 1: Forgetting to Remove the HTML Link from Message Body

**What goes wrong:** Alert has both `<a href="...">View on eBay →</a>` in the message body AND the inline keyboard button — duplicate navigation, messy UX, violates locked decision.

**Why it happens:** `formatDealMessage` currently ends with the HTML link. It's easy to add the keyboard and forget to remove that line.

**How to avoid:** Delete the `<a href="${listing.itemUrl}">View on eBay →</a>` line from `formatDealMessage` as part of the same change that adds `reply_markup`.

**Warning signs:** Test for message NOT containing the raw eBay URL in body text.

### Pitfall 2: `link_preview_options` Conflict with Button

**What goes wrong:** The current code has `link_preview_options: { is_disabled: false }`. Once the URL is removed from the message body, there's nothing to preview — this option becomes a no-op. It won't break anything, but it may cause confusion.

**How to avoid:** Remove or flip to `is_disabled: true` now that the URL is gone from the body. The button doesn't generate a link preview.

### Pitfall 3: `bot.start()` Awaited by Accident

**What goes wrong:** `await this.bot.start()` in an async function blocks forever — the function never returns, hanging the caller.

**Why it happens:** `start()` returns `Promise<void>` so TypeScript doesn't warn about awaiting it; it just never resolves.

**How to avoid:** Always write `void this.bot.start(...)` or do not use await.

**Warning signs:** `startPolling()` returns a Promise that never settles.

### Pitfall 4: Handler Errors vs Polling Loop Errors

**What goes wrong:** Confusing the two error paths leads to wrong behavior.

**Why it happens:** grammy has two distinct error paths:
- **Middleware error** (error thrown in `bot.on('message', ...)` handler) → caught by `bot.catch()` → does NOT crash if `bot.catch()` is installed
- **Polling loop error** (network failure, can't reach Telegram) → grammy's default re-throws → crashes the process

**How to avoid:** Install `bot.catch()` so handler errors don't crash the process. Don't re-throw inside `bot.catch()`. Polling loop crashes are intentional (process manager restarts).

### Pitfall 5: Testing Polling — Don't Call `bot.start()` in Tests

**What goes wrong:** If tests instantiate `TelegramAlerts` and call `startPolling()`, the polling loop runs during tests, making real HTTP calls to `api.telegram.org` (which MSW intercepts as unhandled).

**How to avoid:** Tests should only test `sendDealAlert` and `formatDealMessage`. Do not test `startPolling()` in unit tests — it requires integration/e2e setup. The vitest setup has `onUnhandledRequest: 'error'` which will fail tests if polling starts.

### Pitfall 6: Signal Filter Missing `strong_buy` or `buy`

**What goes wrong:** Typo or wrong property checked — `deal.signal` vs `deal.score` vs some other field — results in zero alerts or all alerts.

**How to avoid:** The filter condition is `deal.signal === 'strong_buy' || deal.signal === 'buy'`. TypeScript's `DealSignal` type enforces valid values. Add a unit test for the filter.

---

## Code Examples

Verified patterns from official grammy sources:

### Inline Keyboard with URL Button (grammy 1.40.0)
```typescript
// Source: https://grammy.dev/plugins/keyboard
import { InlineKeyboard } from 'grammy';

const keyboard = new InlineKeyboard()
  .url('View on eBay', 'https://www.ebay.com/itm/12345');

// Pass to sendMessage via reply_markup
await this.bot.api.sendMessage(chatId, messageText, {
  parse_mode: 'HTML',
  reply_markup: keyboard,
});
```

### Catch-All Message Handler + Polling Start
```typescript
// Source: https://grammy.dev/guide/errors + https://grammy.dev/guide/deployment-types
import { Bot } from 'grammy';

// Must register BEFORE bot.start()
this.bot.on('message', async (ctx) => {
  await ctx.reply('Got it — more commands coming soon.');
});

// Must install BEFORE bot.start()
this.bot.catch((err) => {
  console.error('[Telegram] Error handling update:', err.error);
  // Swallow — do not re-throw, keeps polling alive
});

// Do NOT await — Promise never resolves while polling is running
void this.bot.start({
  allowed_updates: ['message'],
  drop_pending_updates: false,
  onStart: (info) =>
    console.log(`[Telegram] Polling started as @${info.username}`),
});
```

### Stopping Polling Cleanly
```typescript
// Source: https://grammy.dev/ref/core/Bot
await this.bot.stop();
// Completes in-flight handler, no more getUpdates calls
```

### Error Types in bot.catch()
```typescript
// Source: https://grammy.dev/guide/errors
import { GrammyError, HttpError } from 'grammy';

this.bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) {
    // Telegram API returned ok: false (e.g. bad parse_mode, blocked by user)
    console.error('[Telegram] API error:', e.description);
  } else if (e instanceof HttpError) {
    // Network failure — could not reach Telegram
    console.error('[Telegram] Network error:', e);
  } else {
    console.error('[Telegram] Unknown error:', e);
  }
});
```

### Signal Filter Addition in scan-scheduler.ts
```typescript
// Extend the existing alertDeals filter in scanEntry()
const alertDeals = scoredDeals.filter(
  (deal) =>
    deal.score >= this.config.minDealScore &&
    deal.listing.totalPrice <= entry.targetPrice &&
    (deal.signal === 'strong_buy' || deal.signal === 'buy'),
);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Telegram webhooks (requires public HTTPS) | Long-polling via `bot.start()` (no URL needed) | grammy always supported both; polling chosen for simplicity | Polling is simpler for dev/small-scale; no reverse proxy needed |
| Raw `reply_markup` JSON objects | grammy `InlineKeyboard` builder class | grammy v1.x | Builder handles serialization, escaping, layout |

**Deprecated/outdated:**
- `node-telegram-bot-api`: Older library; grammy is the current TypeScript-native standard. Project already uses grammy — do not introduce a second library.

---

## Open Questions

1. **`link_preview_options` cleanup**
   - What we know: Current code passes `link_preview_options: { is_disabled: false }` — this was meaningful when the HTML `<a href>` was in the body.
   - What's unclear: Once the URL link is removed from the body, this option is a no-op. Does it cause any side effect?
   - Recommendation: Remove `link_preview_options` entirely from the `sendMessage` call when adding the keyboard, as there's no longer a URL in the body to preview.

2. **`ctx.reply` vs `bot.api.sendMessage` in `sendText`**
   - What we know: The catch-all handler uses `ctx.reply()` (context-aware, replies to the same chat). `sendDealAlert` uses `bot.api.sendMessage` (manual chatId). Both are valid grammy patterns.
   - What's unclear: Nothing — these are different call sites with different requirements.
   - Recommendation: Use `ctx.reply()` in the `bot.on('message')` handler (simpler, automatic chatId). Keep `bot.api.sendMessage` in `sendDealAlert` (needs explicit chatId from config).

3. **`drop_pending_updates` for polling start**
   - What we know: `PollingOptions.drop_pending_updates = true` discards messages that arrived while the bot was offline.
   - What's unclear: Should old messages be discarded on startup? Phase 3's handler sends a meaningless acknowledgment for unknown messages — processing a backlog of them on startup could be noisy.
   - Recommendation: Set `drop_pending_updates: true` to avoid replying to stale messages from before the bot started.

---

## Sources

### Primary (HIGH confidence)
- grammy official docs — https://grammy.dev/guide/deployment-types — `bot.start()` long-polling, `PollingOptions`
- grammy official docs — https://grammy.dev/guide/errors — `bot.catch()`, `GrammyError`, `HttpError`, default re-throw behavior
- grammy official docs — https://grammy.dev/plugins/keyboard — `InlineKeyboard.url()`, `reply_markup` usage
- grammy official docs — https://grammy.dev/ref/core/Bot — `bot.start()`, `bot.stop()`, `bot.on()`, `bot.catch()` signatures
- grammy official docs — https://grammy.dev/ref/core/pollingoptions — `PollingOptions` fields: `limit`, `timeout`, `allowed_updates`, `drop_pending_updates`, `onStart`
- grammy official docs — https://grammy.dev/plugins/auto-retry — auto-retry plugin for 429 handling
- grammy official docs — https://grammy.dev/advanced/flood — 429 rate limit strategy; auto-retry vs throttler
- Existing codebase — `src/alerts/telegram.ts` — Phase 2 implementation baseline
- Existing codebase — `src/scheduler/scan-scheduler.ts` — signal filtering location
- Existing codebase — `package.json` — grammy 1.40.0 confirmed installed

### Secondary (MEDIUM confidence)
- WebSearch cross-reference — grammy `InlineKeyboard.url()` builder pattern confirmed across multiple grammy docs pages and GitHub source
- WebSearch — `bot.start()` `onStart` callback confirmed via PollingOptions reference docs

### Tertiary (LOW confidence)
- None — all findings verified with official sources.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — grammy 1.40.0 already installed; APIs verified via official docs
- Architecture: HIGH — patterns verified against grammy official docs; existing codebase analyzed
- Pitfalls: HIGH — based on grammy error handling docs + direct code inspection of current implementation

**Research date:** 2026-02-19
**Valid until:** 2026-03-21 (grammy is stable; inline keyboard and polling APIs have not changed in multiple major versions)
