---
phase: 01-foundation-and-tooling
plan: 01
subsystem: infra
tags: [eslint, vitest, grammy, ebay-api, typescript, tooling]

requires: []
provides:
  - ESLint 9 flat config with typescript-eslint recommended rules
  - Vitest 4.x test runner with 13 passing tests, no CJS deprecation
  - grammy and ebay-api installed as runtime dependencies
  - typecheck npm script (tsc --noEmit)
  - All source files linted and passing with zero errors
affects: [02-core-module-hardening, 03-bidirectional-telegram, 04-openclaw-skill-wrapper]

tech-stack:
  added:
    - eslint@^9 (linter)
    - typescript-eslint@^8 (TypeScript ESLint integration)
    - "@eslint/js@^9" (ESLint core rules)
    - vitest@^4 (test runner, upgraded from 1.x)
    - grammy@^1 (Telegram bot framework)
    - ebay-api@^9 (eBay API client)
  patterns:
    - ESLint 9 flat config via eslint.config.mjs (required for CJS projects — .mjs extension avoids ESM/CJS conflict)
    - Underscore prefix convention for unused function parameters (_param) to satisfy no-unused-vars rule
    - argsIgnorePattern/varsIgnorePattern configured in ESLint for clean parameter prefixing

key-files:
  created:
    - eslint.config.mjs
    - package-lock.json
  modified:
    - package.json

key-decisions:
  - "Pin @eslint/js to ^9 (not latest ^10) — latest @eslint/js requires ESLint 10 which conflicts with ESLint 9"
  - "Use eslint.config.mjs extension (not .js) — package.json has no 'type: module' so .js would be treated as CJS and fail ESM imports"
  - "Configure argsIgnorePattern: ^_ to allow _param convention for intentionally unused function parameters"
  - "Drop unused catch variable binding in resolver.ts and cli.ts using bare catch {} syntax"

patterns-established:
  - "ESLint flat config pattern: eslint.config.mjs with defineConfig wrapping recommended + tseslint.configs.recommended"
  - "Unused param pattern: prefix with _ when param must be in signature for interface compliance"

requirements-completed: []

duration: 3min
completed: 2026-02-18
---

# Phase 1 Plan 1: Foundation and Tooling Summary

**ESLint 9 flat config with typescript-eslint, Vitest 4 upgrade, grammy and ebay-api installed, zero lint/type errors across all source files**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-18T14:33:12Z
- **Completed:** 2026-02-18T14:36:22Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- ESLint 9 configured with typescript-eslint recommended rules — `npm run lint` exits 0, zero errors
- Vitest upgraded from 1.x to 4.x — 13 tests pass, no CJS deprecation warning
- grammy and ebay-api installed as runtime dependencies and importable
- `typecheck` script added — `npm run typecheck` exits 0, zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies, upgrade Vitest, add typecheck script** - `55c789f` (chore)
2. **Task 2: Configure ESLint and fix all lint errors** - `168c50e` (feat)

**Plan metadata:** to be committed in final docs commit

## Files Created/Modified
- `eslint.config.mjs` - ESLint 9 flat config with typescript-eslint recommended rules and underscore param pattern
- `package.json` - Added eslint devDependencies, vitest@^4, grammy, ebay-api, typecheck script
- `package-lock.json` - Lock file for all new dependencies
- `src/card-resolver/resolver.ts` - Removed unused ResolvedCard import; dropped unused message var in catch block
- `src/cli.ts` - Removed unused catch binding `e`
- `src/scanner/deal-scorer.ts` - Prefixed unused function parameters `_fmv` and `_componentScores`

## Decisions Made
- Pinned `@eslint/js` to `^9` not `*` — the latest `@eslint/js@10.0.1` requires ESLint 10, which conflicts with the ESLint 9 requirement in the plan
- Used `.mjs` extension for the ESLint config as instructed — this is essential because `package.json` has no `"type": "module"`, so a plain `.js` file would be treated as CommonJS and the ESM `import` syntax would error
- Configured `argsIgnorePattern: "^_"` in the `no-unused-vars` rule so unused-but-required function parameters can use the `_param` convention

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] @eslint/js version conflict with ESLint 9**
- **Found during:** Task 1 (dependency install)
- **Issue:** `npm install --save-dev eslint@^9 typescript-eslint @eslint/js` resolved `@eslint/js@10.0.1` which requires ESLint 10, causing an ERESOLVE peer dependency conflict
- **Fix:** Pinned `@eslint/js@^9` to stay on ESLint 9-compatible version
- **Files modified:** package.json, package-lock.json
- **Verification:** Install succeeded, all downstream steps unaffected
- **Committed in:** 55c789f (Task 1 commit)

**2. [Rule 1 - Bug] ESLint no-unused-vars rejected underscore-prefixed params**
- **Found during:** Task 2 (ESLint fix iteration)
- **Issue:** Adding `_fmv` and `_componentScores` prefix still triggered `@typescript-eslint/no-unused-vars` errors — the rule does not skip underscore-prefixed names by default
- **Fix:** Added `argsIgnorePattern: "^_"` and `varsIgnorePattern: "^_"` to the rule config in `eslint.config.mjs`
- **Files modified:** eslint.config.mjs
- **Verification:** `npm run lint` exits 0 with zero errors
- **Committed in:** 168c50e (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both fixes necessary to complete the tasks as specified. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Development toolchain fully configured and clean
- Phase 2 (Core Module Hardening) can begin immediately
- grammy and ebay-api are available for Phase 2 module work
- No blockers

---
*Phase: 01-foundation-and-tooling*
*Completed: 2026-02-18*
