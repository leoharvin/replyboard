# Handoff note from Claude: Phase 0 review fixes

**Date:** 2026-11-06
**Scope:** Review of the Phase 0 scaffold against `IMPLEMENTATION.md`, followed by two fixes to the lint and typecheck setup.
**Status:** Changes are in the working tree and **not yet committed**.

## Summary

Phase 0 was already working: `typecheck`, `lint`, `test` and `format` all passed. The review found two places where the tooling did not enforce what `AGENTS.md` (Section 4.1) promises. Both are now fixed.

| #   | Gap found                                                 | Fix                                           | Files                                  |
| --- | --------------------------------------------------------- | --------------------------------------------- | -------------------------------------- |
| 1   | `curly` (braces on control flow) was silently turned off  | Re-enabled after `eslint-config-prettier`     | `eslint.config.js`                     |
| 2   | Test files and `vitest.config.ts` were never type-checked | Added a second `tsc` pass over the whole repo | `package.json`, `tsconfig.eslint.json` |

## Fix 1: `curly` was not enforced

**Problem.** `eslint.config.js` sets `curly: ['error', 'all']`, but `eslint-config-prettier` is the last entry in the config and it disables `curly` (it is one of the rules that can conflict with formatters). The net effect was that the rule listed in Section 4.1 did nothing. A check with `if (x == 1) return x!;` produced no `curly` error.

**Change.** A final config block in `eslint.config.js`, placed after `eslintConfigPrettier`:

```js
{
  files: ['**/*.{ts,tsx}'],
  rules: { curly: ['error', 'multi-line'] },
},
```

**Why `multi-line` and not `all`.** Section 4.1 says: "Always use braces for control flow (a single-line `if` may omit them)." That is the Google guide's position. `multi-line` enforces exactly that:

- `if (x) return 1;` on one line is allowed.
- An `if` whose body sits on the next line without braces is an error.

`all` would have been stricter than the guide, and would contradict the spec text.

**Do not move this block above `eslintConfigPrettier`.** Order matters: whatever comes after Prettier's config wins.

## Fix 2: tests and config files were not type-checked

**Problem.** The root script was `typecheck: tsc -b`. The root `tsconfig.json` only references `packages/scoring`, and that package's `tsconfig.json` excludes `src/**/*.test.ts`. So a type error in any test file, or in `vitest.config.ts`, passed `pnpm typecheck` and CI. ESLint uses type information but does not report TypeScript compile errors.

**Change.**

- `package.json`: `"typecheck": "tsc -b && tsc -p tsconfig.eslint.json"`
- `tsconfig.eslint.json`: added `apps/**/*.tsx` to `include`, and an `exclude` of `**/node_modules`, `**/dist` and `**/.open-next`.

**How it works.**

- `tsc -b` still builds each package with its strict, declaration-emitting config (`composite`, `isolatedDeclarations`). This is the production-code check.
- `tsc -p tsconfig.eslint.json` is a no-emit pass over every TypeScript file in the repo, tests and config files included. This file already existed for ESLint's type-aware rules, so reusing it avoids a third tsconfig.
- The `exclude` is needed because `tsc -b` writes `.d.ts` files into `packages/*/dist`. Without it, the second pass would also read those build outputs.

**Future-proofing.** `apps/**` is already in the `include` list, so `apps/ingest` and `apps/web` are type-checked (tests included) as soon as they exist, even before they are added to the root `tsconfig.json` references. You still need to add them as references so `tsc -b` builds them.

## Verification

All commands were run from `node_modules/.bin` because `pnpm` was not on the PATH in the review shell. They are the same commands the `pnpm` scripts run.

- Positive: `tsc -b`, `tsc -p tsconfig.eslint.json`, `eslint .`, `vitest run` and `prettier --check .` all pass on the repo.
- Negative, in a throwaway copy outside the repo:
  - A type error in a `.test.ts` file and one in `vitest.config.ts` were both reported (TS2322).
  - A multi-line `if` without braces was reported by `curly`; a single-line `if` was not.

## Known gaps still open

These were reported in the review and deliberately not changed here.

1. **No git remote.** "CI green" (the Phase 0 acceptance criterion) cannot be shown until the repo is pushed to GitHub.
2. **Naming rules are looser than Section 4.1.**
   - Leading underscores are allowed on properties.
   - No `enumMember` rule requires CONSTANT_CASE.
   - CONSTANT_CASE is accepted for any `const`, not only module-level ones.
   - Quoted keys such as `'Content-Type'` may trigger the camelCase property rule once the YouTube client is written. Expect to handle `requiresQuotes`.
3. **`IMPLEMENTATION.md` still says Node 22.** The Node 24 / TypeScript 5.9.3 deviation is recorded in `AGENTS.md` only. Rule 7 says to update the spec when reality differs.
4. **Placeholder files.** `packages/scoring/src/phase0-smoke.ts` and its test exist only to prove the toolchain works. Remove them in Phase 2.
5. **Dependencies for later phases.**
   - Coverage targets (Section 12) need `@vitest/coverage-v8`, which is not on the allowed list. Add it with a stated reason in the commit message.
   - `console` does not resolve until `@cloudflare/workers-types` is added in Phase 4, because `tsconfig.base.json` uses `lib: ["ES2022"]` only.
6. **Root references.** Every new package or app must be added to the `references` in the root `tsconfig.json`.

## Guidance for the next agent

- Run `pnpm typecheck && pnpm lint && pnpm test` before leaving Phase 0 (Operating rule 2). `typecheck` is now stricter, so new test code must compile cleanly.
- The two fixes are small and share one concern (tooling enforcement), so they fit in a single commit. Per the attribution rules, end the message with the `Co-Authored-By` line given in the session.
- Do not weaken the new `typecheck` script or the `curly` override to make a failure go away. Fix the code instead.
