# Phase 7: Phase 2 Completion & Code Quality - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Close integration gaps identified by the v1.0 audit. Lint clean, unused deps removed, CLI `remove` subcommand added, server `/api/scan` wired to `ScanScheduler` for continuous scanning, dead `rawConfidence` field removed, and requirement tracking docs updated. No new user-visible features — this is a hardening and correctness pass.

</domain>

<decisions>
## Implementation Decisions

### CLI remove command
- No confirmation prompt — remove immediately and print a single confirmation line on success
- All other design choices (identifier format, not-found behavior, alias vs canonical name) are Claude's discretion — match whatever is clearest and most consistent with the existing CLI style

### Claude's Discretion
- How the `remove` command identifies entries (by ID, name, or both)
- Whether `remove` and `unwatch` are aliases or one canonical name
- Not-found behavior (error exit vs silent no-op)
- Server `/api/scan` endpoint contract when wiring to `ScanScheduler`
- Gate logic approach after removing `rawConfidence` from `CardCandidate`

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for all unspecified areas.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 07-phase2-completion*
*Context gathered: 2026-02-19*
