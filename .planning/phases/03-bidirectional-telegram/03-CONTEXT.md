# Phase 3: Bidirectional Telegram and BUY Command - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Add an inline "View on eBay" button to outgoing deal alerts AND set up bot polling so the infrastructure is in place for Phase 5's BUY command. The bot becomes capable of receiving messages but does not act on them beyond a placeholder acknowledgment. Actual BUY intent capture and the human confirmation flow are Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Alert message content
- Extend existing Phase 2 alert format — do NOT redesign the message
- Add a single inline keyboard button: "View on eBay" that deep-links directly to the eBay listing URL
- No BUY button on the alert (deferred to Phase 5)
- No raw URL in the message body — button only

### Alert signal filter
- Only send alerts for `strong_buy` and `buy` signals
- Do not alert on `fair`, `overpriced`, or `avoid` signals

### Bot polling setup
- Polling auto-starts when the server boots, same as alert sending — activated when Telegram token is configured
- Unknown/unhandled incoming messages receive a short acknowledgment reply (e.g. "Got it — more commands coming soon")
- Polling crash behavior: log the error and crash the process — let the process manager (e.g. pm2, systemd) restart it

### Claude's Discretion
- Polling mode vs webhook: Claude picks (long-polling preferred — simpler, no public URL required, grammy has first-class support)
- Alert batching: Claude picks (separate message per deal is simpler and preserves per-message inline keyboards)
- Acknowledgment message exact wording

</decisions>

<specifics>
## Specific Ideas

- No specific references or examples provided — open to standard grammy patterns for polling and inline keyboards

</specifics>

<deferred>
## Deferred Ideas

- **BUY command trigger** (reply to alert with "buy") — Phase 5
- **Confirmation step design** (inline keyboard with Confirm/Cancel, timeout behavior, listing data shown at confirmation) — Phase 5
- **Per-session spend limits** — Phase 5

</deferred>

---

*Phase: 03-bidirectional-telegram*
*Context gathered: 2026-02-19*
