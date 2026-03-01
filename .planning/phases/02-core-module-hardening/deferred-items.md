# Deferred Items — Phase 02 Core Module Hardening

## Pre-existing TypeScript Errors (Out of Scope)

These typecheck errors existed before Plan 02-02 and were not introduced by the two-tier confidence gate changes.

### FairMarketValue null safety (src/cli.ts, src/server.ts, src/scheduler/scan-scheduler.ts)

**Source:** Pre-existing before plan 02-02 execution
**Errors:**
- `src/cli.ts(117,44): error TS18047: 'fmv' is possibly 'null'`
- `src/cli.ts(118,11): error TS18047: 'fmv' is possibly 'null'`
- `src/cli.ts(119,40): error TS18047: 'fmv' is possibly 'null'`
- `src/cli.ts(122,23): error TS18047: 'fmv' is possibly 'null'`
- `src/cli.ts(203,80): Argument of type 'FairMarketValue | null' is not assignable to parameter of type 'FairMarketValue'`
- `src/scheduler/scan-scheduler.ts(120,9): Argument of type 'FairMarketValue | null' is not assignable to parameter of type 'FairMarketValue'`
- `src/server.ts(416,63): Argument of type 'FairMarketValue | null' is not assignable to parameter of type 'FairMarketValue'`

**Fix required:** Add null guards before using `fmv` value, or update call sites to handle `FairMarketValue | null` return type.
