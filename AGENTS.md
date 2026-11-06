# Agent rules (Replyboard)

## 0. How to use this document

You are the Cursor Agent building this repo from scratch. Work **phase by phase** (Section 15). Do not start a phase until the previous phase's acceptance criteria pass.

**Operating rules**

1. TypeScript, `strict: true`, no `any`. Prefer pure functions. Small commits, one concern each. **Follow the Google TypeScript Style Guide** (https://google.github.io/styleguide/tsguide.html) as adapted in Section 4.1; lint and formatting enforce it.
2. Before moving to the next phase run `pnpm typecheck && pnpm lint && pnpm test`. All must pass.
3. Never commit secrets. Secrets live in Wrangler secrets, `.dev.vars` (gitignored), or the owner's shell. Never print secrets in logs.
4. **Never call `search.list`** (100 quota units per call). Only the endpoints listed in Section 8.
5. **Never persist comment text, author display names, or author channel IDs.** Author channel IDs are compared in memory to the creator's channel ID and then discarded.
6. Do not add dependencies beyond those named here without a stated reason in the commit message.
7. Anything in Section 14 ("Known unknowns") must be verified against current official docs when you reach it. If reality differs from this spec, follow reality, update this file, and note it in the commit.
8. **Stop and ask the owner** before: creating cloud accounts, entering or rotating credentials, running destructive migrations on a non-empty database, choosing the creator seed list, or changing scoring constants.
9. After Phase 0, copy Section 0 **and Section 4.1** into `AGENTS.md` at the repo root so future agent sessions inherit these rules.

### 4.1 Code style — Google TypeScript Style Guide

**Authority:** https://google.github.io/styleguide/tsguide.html. Read the whole guide at the start of Phase 0 (especially the comments/JSDoc and type-system sections) and follow it for all TypeScript in this repo. Below is a working summary in our own words plus the places where this project deliberately deviates. If this summary and the guide disagree, the guide wins, except for the documented exceptions.

**Modules**

- Named exports only; no default exports (exceptions below). Minimize the exported surface.
- No `export let`; expose mutable state through functions. No container classes or objects holding only static members: export individual constants and functions.
- ES module syntax only: no `namespace`, no `require`, no `/// <reference>`. Use `import type` / `export type` for type-only symbols. Relative imports within a package; avoid long `../../..` chains (use package names across packages).
- Rename imports only to resolve collisions or unclear names.

**Variables and values**

- `const` by default, `let` only when reassigned, never `var`; one declaration per statement.
- Literals, not `Array()` / `Object()` constructors; never instantiate `String`/`Number`/`Boolean` wrappers.
- Use `===` / `!==` (comparing to `null` with `==` is the one allowed exception). Always use semicolons.
- Single-quoted strings; template literals for non-trivial concatenation.
- Convert numbers with `Number()` and check for `NaN`/non-finite; avoid unary `+` and `parseFloat`; `parseInt` only for non-decimal radixes after validation.
- Always use braces for control flow (a single-line `if` may omit them). Every `switch` has a final `default`; non-empty cases must not fall through. Prefer `for...of` for arrays; no unfiltered `for...in`.
- No `eval`, `with`, `debugger`, or modifying built-in prototypes.

**Functions and classes**

- Function declarations for named functions; arrow functions for callbacks and nested functions. Use rest parameters, never `arguments`. Keep functions short (roughly 40 lines is the cue to split).
- Prefer `readonly` for fields not reassigned after construction; use TypeScript `private`, not `#private`; no `public` modifier except on parameter properties. Prefer parameter properties over manual field assignment. No empty or pass-through constructors. Always `new Foo()` with parentheses.
- No decorators of our own.

**Errors**

- Throw only `Error` instances (always `new Error(...)` or a subclass); this includes promise rejections. All custom errors (`YouTubeError`, `BudgetExceeded`) extend `Error`. When wrapping, pass the original as `cause`.
- Empty `catch` blocks require a comment explaining why. Keep `try` blocks small.

**Types**

- Rely on inference for local variables; annotate exported functions and constants (and keep annotations on anything whose inferred type is unclear). Enable `isolatedDeclarations` in `packages/*` if the toolchain supports it.
- Prefer `interface` over object-literal `type` aliases for object shapes. Use `T[]` for simple element types and `Array<T>` for complex ones. Do not put `null`/`undefined` inside a type alias union; add them at the use site.
- No `any`: use `unknown` (including for caught values) and narrow. Avoid `as` and non-null `!` assertions; prefer runtime checks (`zod`), and when an assertion is unavoidable add a comment saying why it is safe. Use `as` syntax (never angle brackets); annotate object literals instead of asserting them.
- No `const enum`. Prefer string-literal unions or plain `enum`. Do not implicitly convert enum values to booleans.
- Avoid unnecessary type-system cleverness: the simplest mapped/conditional type that works.
- Suppression comments (`@ts-ignore`, `@ts-expect-error`) need a stated reason and are not allowed in production code paths unless the guide's current text permits them; check the guide.

**Naming**

- `UpperCamelCase`: classes, interfaces, types, enums, type parameters.
- `lowerCamelCase`: variables, parameters, functions, methods, properties.
- `CONSTANT_CASE`: module-level constants and enum values, for values created once (for example `WINDOW_DAYS`).
- No leading/trailing underscores on members; no `I` prefix on interfaces; no type information in names; descriptive names over abbreviations; acronyms are words in camel case (`loadHttpUrl`, `channelId`). Intentionally unused parameters take an underscore prefix.
- Test names may use underscores freely.

**Comments and docs**

- JSDoc (`/** ... */`) on every exported symbol, describing purpose, not restating the signature. Do not repeat TypeScript types in JSDoc. Use `//` for implementation comments, explaining why rather than what. Comments are required for unsafe assertions, empty `catch` blocks and non-obvious constants (such as the scoring parameters).
- Optional `@fileoverview` for files whose purpose isn't obvious from the name.

**Formatting** (Prettier does the formatting; do not hand-format)

- Prettier options: `singleQuote: true`, `semi: true`, `trailingComma: 'all'`, `arrowParens: 'always'`, `printWidth: 100` (project choice; if the full guide mandates a different line length, follow the guide).
- No blank lines at the start or end of a function body; single blank lines between class members.

**Deliberate deviations (the only allowed ones)**

| Rule in the guide           | Exception here                                                                                                                                                                                                                                       | Why                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| No default exports          | `export default { scheduled }` in `apps/ingest/src/index.ts`; Next.js `page.tsx`, `layout.tsx`, `error.tsx`, `not-found.tsx` and similar route files; tool config files (`next.config.*`, `vitest.config.*`, `eslint.config.*`, `tailwind.config.*`) | Runtime/framework entry points require them. Confine default exports to these files via ESLint overrides; everything else uses named exports. |
| `lowerCamelCase` properties | Database column names stay `snake_case` in SQL and in raw rows; convert to camelCase at the DB boundary (a single `mapRow` helper or postgres.js's column transform, verify the option) so application code never sees snake_case.                   | SQL convention vs TS convention; isolate the translation in one place.                                                                        |
| Test names                  | Underscore-separated test names are fine.                                                                                                                                                                                                            | Matches the guide's allowance.                                                                                                                |

**Lint enforcement (`eslint.config.js`, flat config, `typescript-eslint` strict + stylistic, `eslint-config-prettier` last).** Configure at least: `@typescript-eslint/no-explicit-any`, `consistent-type-imports`, `no-non-null-assertion`, `consistent-type-assertions` (style `as`, object literal assertions `never`), `consistent-type-definitions` (`interface`), `array-type` (`array-simple`), `naming-convention` (types UpperCamelCase; variables/functions/properties lowerCamelCase with CONSTANT_CASE allowed for module-level `const`; no leading underscore except unused parameters), `no-namespace`, `no-require-imports`, `no-unused-vars` (underscore-prefixed args ignored), `only-throw-error`, `no-floating-promises`, `eslint`: `eqeqeq` (allow `null`), `no-var`, `prefer-const`, `curly`, `default-case`, `default-case-last`, `no-fallthrough`, `no-eval`, `no-new-wrappers`, `guard-for-in`, `no-restricted-syntax` for `for...in`; and `import-x/no-default-export` with the overrides in the table above. `pnpm lint` must fail on violations. If a rule above conflicts with the real guide text, fix the lint config, not the guide.

**Tooling note:** Dev and CI use **Node 24** (see `.nvmrc` and root `package.json` `engines`), not Node 22 as in `IMPLEMENTATION.md` Section 4. TypeScript is pinned to **5.9.3** because `typescript-eslint@8.72.1` does not support TypeScript 7.0 yet.
