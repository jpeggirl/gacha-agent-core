# Phase 1: Foundation and Tooling - Research

**Researched:** 2026-02-18
**Domain:** TypeScript toolchain setup — ESLint, Vitest, library installation (grammy, ebay-api)
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 (partial) | CLI test mode allows running live scans and scoring against real APIs from terminal | Scaffolding already present in `src/cli.ts` (`scan` command). No new code required in Phase 1 — full implementation in Phase 6. Success criterion 4 (typecheck passing) ensures the scaffold compiles cleanly. |
</phase_requirements>

---

## Summary

Phase 1 is a pure toolchain phase: install missing libraries, wire up ESLint, and ensure typecheck + test run cleanly with zero warnings. The codebase is already structurally sound — `npx tsc --noEmit` passes with zero errors and `npm test` passes all 13 tests. The only broken surface is `npm run lint`, which fails because `eslint` is not installed (the script is defined but the binary is absent). The CJS deprecation warning from Vite/Vitest is a minor friction that can be resolved by upgrading Vitest.

The two library installs (`grammy` and `ebay-api`) replace hand-rolled `fetch` calls in `src/alerts/telegram.ts` and `src/scanner/ebay.ts`. Both libraries are stable, well-typed, and compatible with the project's existing `NodeNext` module resolution and `ES2022` target. The installs need only be verifiable as importable — full integration is deferred to Phase 2.

Phase 1 is low-risk and mechanical. The main planning decision is **scope discipline**: resist the temptation to refactor modules during toolchain setup. The four success criteria (lint, test, importable libraries, typecheck) are the entire scope.

**Primary recommendation:** Add ESLint with typescript-eslint flat config, upgrade Vitest to suppress the CJS warning, install grammy and ebay-api, add a `typecheck` npm script — done.

---

## Current State Assessment (Verified)

| Check | Current Result | Gap |
|-------|---------------|-----|
| `npm run lint` | Fails — `eslint: command not found` | ESLint not installed, no config file |
| `npm test` | PASSES — 13 tests, 2 files | CJS deprecation warning from Vitest 1.6.1 |
| `npx tsc --noEmit` | PASSES — zero errors | No `typecheck` script in package.json |
| `grammy` installed | NO | Must add to dependencies |
| `ebay-api` installed | NO | Must add to dependencies |
| `npm run typecheck` | Script missing | Must add to package.json scripts |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `eslint` | `^9.x` (9.x latest) | JavaScript/TypeScript linter | ESLint 9 is current stable; 8.x is in maintenance mode |
| `typescript-eslint` | `^8.x` (8.56.0 latest) | TypeScript rules for ESLint | Official TS-ESLint monorepo package — replaces separate `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` in ESLint 9 |
| `@eslint/js` | bundled with eslint 9 | ESLint recommended JS rules | Required companion for flat config |
| `grammy` | `^1.40.0` | Telegram Bot API framework | Most widely used TypeScript-first Telegram bot library; supports Node.js and Deno; zero peer dependencies |
| `ebay-api` | `^9.4.2` | eBay REST API client | Only actively-maintained TypeScript eBay library; supports Browse API v1; `eBayApi.fromEnv()` for clean credential loading |
| `vitest` | `^4.x` (upgrade from 1.6.1) | Test runner | Vitest 1.6.1 produces CJS deprecation warning; v4 removes it. Resolves the `npm test` warning without test changes. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tsx` | `^4.7.0` (already installed) | TypeScript execution for dev/CLI | Already present; no change needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `typescript-eslint` (unified) | Separate `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` | Separate packages are the ESLint 8 pattern; `typescript-eslint` unified package is the correct ESLint 9 pattern |
| `eslint` v9 flat config | eslint v8 legacy `.eslintrc` | v8 legacy config requires `ESLINT_USE_FLAT_CONFIG=false` workaround; not worth it for a new config |
| `vitest` v4 | Stay on v1.6.1 | Staying on v1 silences the warning only if `vitest.config.ts` is renamed `.mts`, but upgrading is cleaner and future-proofs Phase 6 |

**Installation:**
```bash
# Toolchain (devDependencies)
npm install --save-dev eslint typescript-eslint @eslint/js

# Upgrade vitest (already in devDependencies)
npm install --save-dev vitest@^4

# Libraries (dependencies — must be importable at runtime)
npm install grammy ebay-api
```

---

## Architecture Patterns

### Recommended Project Structure

No structural changes in Phase 1. The existing layout is already correct:

```
src/
├── alerts/         # TelegramAlerts (will use grammy in Phase 2)
├── card-resolver/  # CardResolver
├── pricing/        # PriceEngine
├── scanner/        # EbayScanner (will use ebay-api in Phase 2)
├── scheduler/      # ScanScheduler
├── types/          # Shared type definitions
├── watchlist/      # WatchlistManager, JsonStorageAdapter
├── cli.ts          # CLI entrypoint
├── index.ts        # Library exports
└── server.ts       # HTTP server entrypoint
```

### Pattern 1: ESLint 9 Flat Config (TypeScript)

**What:** Single `eslint.config.mjs` file in project root using the new flat config format.
**When to use:** ESLint 9 only supports flat config. The old `.eslintrc.json` is not supported.
**Example:**
```javascript
// eslint.config.mjs
// Source: https://typescript-eslint.io/getting-started/
// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**'],
  }
);
```

**Note:** Because the project has `"module": "NodeNext"` in tsconfig but no `"type": "module"` in package.json, use `.mjs` extension (not `.js`) to ensure ESLint loads it as ESM. Alternatively, add `"type": "module"` to package.json — but that affects all `.js` files and should be evaluated for side effects.

### Pattern 2: npm scripts additions

**What:** Add `typecheck` and optionally `lint:fix` scripts to package.json.
**Example:**
```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "lint": "eslint src/",
  "lint:fix": "eslint src/ --fix"
}
```

### Pattern 3: Vitest config — suppress CJS warning

**What:** Rename `vitest.config.ts` to `vitest.config.mts` OR upgrade to Vitest 4.
**Recommendation:** Upgrade to Vitest 4 (cleaner than renaming).

After upgrading, the existing config content works unchanged:
```typescript
// vitest.config.ts (unchanged content)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

### Pattern 4: Library smoke-test imports

**What:** Verify grammy and ebay-api are importable without TypeScript errors.
**When:** Phase 1 success criterion 3 — "installed and importable."
**How:** Add a type-only import check in a test file or verify with `tsc --noEmit` after installation.

```typescript
// Verify importability (no runtime execution needed)
import type { Bot } from 'grammy';
import type eBayApi from 'ebay-api';
```

### Anti-Patterns to Avoid

- **Refactoring TelegramAlerts or EbayScanner during Phase 1:** Integration of grammy/ebay-api replaces hand-rolled fetch calls — that is Phase 2 work. Phase 1 only installs the packages.
- **Adding typed linting rules (`parserOptions.project`):** Type-aware linting requires `tsconfig.json` path configuration and is significantly slower. Start with `tseslint.configs.recommended` (no type info needed). Upgrade to type-aware rules only if desired — defer to later.
- **Adding `"type": "module"` to package.json without testing:** This changes how Node.js treats `.js` files everywhere. The project uses `NodeNext` module resolution and explicit `.js` extensions already, so it likely works — but verify before committing.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Telegram Bot API calls | Custom `fetch` wrapper | `grammy` Bot class | grammy handles auth, retry, polling, webhook, rate limits, typed API surface |
| eBay OAuth token refresh | Manual `client_credentials` fetch | `ebay-api` credential management | ebay-api handles token lifecycle, refresh, and API routing |
| TypeScript linting rules | Custom ESLint rules | `typescript-eslint` recommended preset | Thousands of hours of rule development for TS-specific issues |

**Key insight:** The hand-rolled `fetch` calls in `telegram.ts` and `ebay.ts` have already accumulated edge-case gaps (no retry, in-memory-only deduplication, no rate limit handling). Installing the proper libraries now sets Phase 2 up to replace them correctly.

---

## Common Pitfalls

### Pitfall 1: eslint.config.js vs .mjs vs .ts

**What goes wrong:** Creating `eslint.config.js` without `"type": "module"` in package.json causes ESLint to load it as CJS, which fails when using `import` syntax.
**Why it happens:** Node.js treats `.js` as CJS unless `"type": "module"` is set.
**How to avoid:** Use `.mjs` extension for the config file — no package.json change required.
**Warning signs:** `SyntaxError: Cannot use import statement in a module` at lint runtime.

### Pitfall 2: Vitest upgrade breaking test output

**What goes wrong:** Vitest v4 has breaking changes from v1 (removed deprecated config options).
**Why it happens:** Major version bump from 1.x to 4.x spans multiple breaking changes.
**How to avoid:** The existing `vitest.config.ts` uses only `test.include` — no deprecated options. The upgrade is safe as-is. Verify by running `npm test` after upgrading.
**Warning signs:** Test runner errors about unknown config options.

### Pitfall 3: grammy and ebay-api installed as devDependencies

**What goes wrong:** If installed with `--save-dev`, these packages won't be available when the library is consumed by external projects or deployed.
**Why it happens:** Easy to mistype the install flag.
**How to avoid:** Install with `npm install` (no flag) or `--save` — they go into `dependencies`, not `devDependencies`.
**Warning signs:** `Cannot find module 'grammy'` errors in production or when consuming the package.

### Pitfall 4: TypeScript errors after adding grammy/ebay-api

**What goes wrong:** grammy or ebay-api expose types that conflict with existing hand-rolled interfaces in `src/types/index.ts` or inline types in `scanner/ebay.ts`.
**Why it happens:** Both libraries have their own type definitions for eBay listings, Telegram messages, etc.
**How to avoid:** Phase 1 only installs — do not import from grammy/ebay-api in source files yet. Just verify `tsc --noEmit` still passes after install.
**Warning signs:** New TypeScript errors after `npm install grammy ebay-api`.

### Pitfall 5: ESLint errors on existing code

**What goes wrong:** Enabling `tseslint.configs.recommended` surfaces errors in existing source files (e.g., `no-explicit-any`, `no-unused-vars`).
**Why it happens:** Existing code was written without linting enforcement.
**How to avoid:** Run `npm run lint` and fix all errors before considering Phase 1 complete. The success criterion is zero errors — not "lint installs successfully."
**Warning signs:** Large number of lint errors on first run, particularly from `src/scanner/ebay.ts` (hand-rolled fetch with type casts) and `src/alerts/telegram.ts`.

---

## Code Examples

Verified patterns from official sources:

### ESLint 9 flat config — minimum viable setup
```javascript
// eslint.config.mjs
// Source: https://typescript-eslint.io/getting-started/
// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**'],
  }
);
```

### grammy — basic bot setup (for reference; integration is Phase 2)
```typescript
// Source: https://grammy.dev/guide/
import { Bot } from 'grammy';

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

// Send a message
await bot.api.sendMessage(chatId, 'Hello!', { parse_mode: 'HTML' });

// Start polling
bot.start();
```

### ebay-api — Browse API search (for reference; integration is Phase 2)
```typescript
// Source: https://hendt.gitbook.io/ebay-api/
import eBayApi from 'ebay-api';

const eBay = new eBayApi({
  appId: process.env.EBAY_APP_ID!,
  certId: process.env.EBAY_CERT_ID!,
  sandbox: false,
});

// Alternative: load all credentials from env vars automatically
const eBay2 = eBayApi.fromEnv();

// Browse API item search
const results = await eBay.buy.browse.search({ q: 'Charizard PSA 10' });
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.eslintrc.json` with `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` | `eslint.config.mjs` with unified `typescript-eslint` package | ESLint 9 (2024) | Simpler config, better TypeScript support, flat config is mandatory in v9 |
| Separate `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` v6 | `typescript-eslint` v8 unified package | 2024 | One package to install instead of two; same rules |
| Vitest 1.x with `vitest.config.ts` (CJS warning) | Vitest 4.x | 2025 | Warning eliminated; improved performance |

**Deprecated/outdated:**
- `.eslintrc.json` / `.eslintrc.js`: Removed in ESLint 9; use `eslint.config.mjs`.
- Separate `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser`: Still work but superseded by unified `typescript-eslint` package.
- `eslint-plugin-@typescript-eslint` as separate installs: Old ESLint 8 pattern.

---

## Open Questions

1. **Does `"type": "module"` belong in package.json?**
   - What we know: The project uses `"module": "NodeNext"` in tsconfig and explicit `.js` import extensions throughout — both are the ESM-compatible pattern for Node.js.
   - What's unclear: Adding `"type": "module"` to package.json would let `eslint.config.js` work without `.mjs` extension, but may affect how `dist/` output is consumed.
   - Recommendation: Use `eslint.config.mjs` and skip adding `"type": "module"` for now. Keep scope minimal.

2. **Should typed linting (`parserOptions.project`) be enabled?**
   - What we know: Type-aware rules catch more bugs but require `tsconfig` path in ESLint config and are 3-5x slower.
   - What's unclear: The team's tolerance for slower lint runs.
   - Recommendation: Start without type-aware rules. The `tseslint.configs.recommended` preset already catches the most common issues without a tsconfig reference.

3. **Which Vitest 4 breaking changes affect the existing tests?**
   - What we know: Existing config uses only `test.include`. Vitest 4 removed `deps.external`, `deps.inline`, `deps.fallbackCJS` — none of which are used.
   - What's unclear: Whether internal Vitest behavior changes affect the 13 existing tests.
   - Recommendation: Upgrade and run `npm test` immediately. If any test fails, investigate before proceeding.

---

## Sources

### Primary (HIGH confidence)
- `npx tsc --noEmit` — verified zero TypeScript errors in current codebase (2026-02-18)
- `npm test` — verified 13 passing tests, CJS deprecation warning from Vitest 1.6.1 (2026-02-18)
- `npm info grammy version` — 1.40.0 latest (2026-02-18)
- `npm info ebay-api version` — 9.4.2 latest (2026-02-18)
- `npm info vitest dist-tags` — 4.0.18 latest (2026-02-18)
- `npm info eslint version` — 10.0.0 latest (2026-02-18)
- `npm info typescript-eslint version` — 8.56.0 (2026-02-18)

### Secondary (MEDIUM confidence)
- [typescript-eslint Getting Started](https://typescript-eslint.io/getting-started/) — verified flat config setup pattern, `defineConfig` usage, `eslint.config.mjs` example
- [eBay API gitbook](https://hendt.gitbook.io/ebay-api/) — verified `new eBayApi()` constructor signature, `eBayApi.fromEnv()`, `eBay.buy.browse` namespace
- [WebSearch: ESLint 9 flat config TypeScript 2025](https://eslint.org/blog/2025/03/flat-config-extends-define-config-global-ignores/) — corroborates `eslint/config` `defineConfig` pattern

### Tertiary (LOW confidence)
- [WebSearch: Vitest CJS deprecation](https://vueschool.io/articles/vuejs-tutorials/the-cjs-build-of-vites-node-api-is-deprecated/) — fix via `.mjs` extension or upgrade; cross-referenced with vitest migration docs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified via npm registry, TypeScript check verified by running compiler
- Architecture: HIGH — flat config pattern verified against official typescript-eslint docs
- Pitfalls: HIGH for ESLint/Vitest (verified directly); MEDIUM for grammy/ebay-api TypeScript conflict risk (plausible, not reproduced)

**Research date:** 2026-02-18
**Valid until:** 2026-03-20 (stable toolchain domain; ESLint/Vitest versions may bump but patterns hold)
