# Replyboard — Implementation Spec (for Cursor Agent)

> Working title: **Replyboard**. A public leaderboard that ranks YouTube creators by how responsive they are to their own comment sections. Portfolio/demo project: correctness, clarity and polish matter more than scale or monetization.

---

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

---

## 1. Goal and non-goals

**Goal.** For a curated list of ~100–150 YouTube channels, periodically sample recent comment threads, measure how often the creator replies, and publish a ranked, filterable, well-designed leaderboard plus per-creator detail pages with a 30-day trend.

**Non-goals (v1):** user accounts, payments, creator badges, open-ended channel crawling, notifications, mobile app, storing comment text, any scraping (official API only).

**Success = a live public URL** where a visitor can: see the leaderboard, filter by niche, open a creator page, understand exactly how the score is computed, and see live "API quota used today" on a status page.

---

## 2. Architecture

```
                 ┌───────────────────────────────┐
   YouTube Data  │  apps/ingest  (Cloudflare     │      Supabase Postgres
   API v3  ◄─────┤  Worker, Cron: every minute)  ├────► (system of record)
                 │  quota guard + lease scheduler│  via Hyperdrive (role: ingest_writer)
                 └───────────────────────────────┘
                                                              ▲
                 ┌───────────────────────────────┐            │ Hyperdrive (role: web_reader, read-only)
   Visitors ────►│  apps/web (Next.js on         ├────────────┘
                 │  Cloudflare Workers) + KV     │
                 │  read-through cache           │
                 └───────────────────────────────┘
```

**Key decisions (and why)**

| Decision | Reason |
|---|---|
| Two separate Workers (`ingest`, `web`) | Cron handler stays out of the Next.js adapter bundle; separate bindings and DB roles; independent deploys. |
| Supabase Postgres, accessed only via **Hyperdrive** + a native driver (`postgres` / postgres.js) | Real Postgres (exportable, SQL window functions), no `supabase-js` (it uses `fetch`, which would consume the scarce external-subrequest budget). |
| Two Postgres roles (`ingest_writer`, `web_reader`) with RLS enabled on every table | A bug in the public site cannot write or read anything beyond what it needs. PostgREST/anon access is closed. |
| Cron every minute, pull-based "most overdue first" scheduler with a short lease | Self-heals after missed ticks (Cloudflare cron incidents happen) and fits the Free plan's per-invocation limits by doing 1–3 creators per tick. |
| Rolling **30-day window**, store only derived counts/scores | Aligns with YouTube API Services policy that stored API data must be refreshed or deleted within 30 days. |
| KV read-through cache in the web Worker (best-effort) | Protects the Hyperdrive 100,000 queries/day Free cap from traffic or crawlers. |
| Plain `<img>`, not `next/image` | Avoids Cloudflare Images transformation limits. |

---

## 3. Owner prerequisites (human tasks — ask the owner, do not attempt)

1. **Google Cloud project** with *YouTube Data API v3* enabled and an **API key restricted to that API only**. Quota: 10,000 units/day, resets at midnight **Pacific Time**.
2. **Supabase project** (Free). Note the project ref and database password.
3. **Cloudflare account** (Workers Free), `wrangler login` completed on the dev machine.
4. **GitHub repo** (public, since this is a portfolio piece).
5. **`seed/creators.csv`**: ~100–150 rows of `handle,niche` (see Section 6.4). The owner chooses the creators.
6. A contact email for creator removal requests (`REMOVAL_CONTACT_EMAIL`).

---

## 4. Repo layout and tooling

pnpm workspaces monorepo, Node 22, ESLint + Prettier, Vitest.

```
replyboard/
├─ AGENTS.md
├─ README.md
├─ package.json                 # root scripts: typecheck, lint, test, format
├─ pnpm-workspace.yaml          # packages: ["apps/*", "packages/*"]
├─ tsconfig.base.json           # strict, ES2022, moduleResolution bundler
├─ eslint.config.js             # Google TS style enforcement (Section 4.1)
├─ .prettierrc                  # singleQuote, semi, trailingComma all, printWidth 100
├─ .github/workflows/ci.yml     # install, typecheck, lint, test (NO scheduled workflows)
├─ db/migrations/
│   ├─ 0001_init.sql
│   ├─ 0002_roles_rls.sql
│   └─ 0003_views.sql
├─ seed/creators.csv            # handle,niche
├─ scripts/seed.ts              # resolves handles -> channel IDs, upserts creators
├─ packages/
│   ├─ scoring/                 # pure functions + tests (Section 7)
│   └─ youtube/                 # typed API client + fixtures + tests (Section 8)
├─ apps/
│   ├─ ingest/                  # Cloudflare Worker (cron) (Section 9)
│   └─ web/                     # Next.js app on Cloudflare Workers (Section 10)
└─ docs/
    ├─ ARCHITECTURE.md
    └─ METHODOLOGY.md
```

Dependencies (allowed): `postgres`, `zod` (validate API responses), `vitest`, `typescript`, `wrangler`, `@cloudflare/workers-types`, `tsx`, `eslint`, `typescript-eslint`, `eslint-plugin-import-x` (or the maintained equivalent, for `no-default-export`), `eslint-config-prettier`, `prettier`. Web app adds: Next.js, React, Tailwind CSS, `recharts`, and whichever Cloudflare adapter the current official Next.js guide specifies (Section 14, item 4).

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

| Rule in the guide | Exception here | Why |
|---|---|---|
| No default exports | `export default { scheduled }` in `apps/ingest/src/index.ts`; Next.js `page.tsx`, `layout.tsx`, `error.tsx`, `not-found.tsx` and similar route files; tool config files (`next.config.*`, `vitest.config.*`, `eslint.config.*`, `tailwind.config.*`) | Runtime/framework entry points require them. Confine default exports to these files via ESLint overrides; everything else uses named exports. |
| `lowerCamelCase` properties | Database column names stay `snake_case` in SQL and in raw rows; convert to camelCase at the DB boundary (a single `mapRow` helper or postgres.js's column transform, verify the option) so application code never sees snake_case. | SQL convention vs TS convention; isolate the translation in one place. |
| Test names | Underscore-separated test names are fine. | Matches the guide's allowance. |

**Lint enforcement (`eslint.config.js`, flat config, `typescript-eslint` strict + stylistic, `eslint-config-prettier` last).** Configure at least: `@typescript-eslint/no-explicit-any`, `consistent-type-imports`, `no-non-null-assertion`, `consistent-type-assertions` (style `as`, object literal assertions `never`), `consistent-type-definitions` (`interface`), `array-type` (`array-simple`), `naming-convention` (types UpperCamelCase; variables/functions/properties lowerCamelCase with CONSTANT_CASE allowed for module-level `const`; no leading underscore except unused parameters), `no-namespace`, `no-require-imports`, `no-unused-vars` (underscore-prefixed args ignored), `only-throw-error`, `no-floating-promises`, `eslint`: `eqeqeq` (allow `null`), `no-var`, `prefer-const`, `curly`, `default-case`, `default-case-last`, `no-fallthrough`, `no-eval`, `no-new-wrappers`, `guard-for-in`, `no-restricted-syntax` for `for...in`; and `import-x/no-default-export` with the overrides in the table above. `pnpm lint` must fail on violations. If a rule above conflicts with the real guide text, fix the lint config, not the guide.

---

## 5. Configuration constants

Defined once in `packages/scoring/src/config.ts` and imported everywhere, each as an individually exported `CONSTANT_CASE` constant (no container object; see Section 4.1). Worker `vars` may override operational values (marked ⚙) but never scoring values.

| Constant | Value | Meaning |
|---|---|---|
| `WINDOW_DAYS` | 30 | Only videos published within this many days are sampled; also the data retention period. |
| `SAMPLE_VIDEOS` | 3 | Max most-recent uploads sampled per creator. |
| `MATURITY_HOURS` | 24 | Comments younger than this are excluded (the creator hasn't had time to reply). |
| `MIN_ELIGIBLE` | 30 | Minimum eligible comments to be ranked. |
| `PRIOR_RATE` | 0.05 | Shrinkage prior (assumed typical reply rate). |
| `PRIOR_STRENGTH` | 20 | Prior weight in pseudo-comments. |
| `MAX_COMMENT_PAGES_PER_VIDEO` ⚙ | 2 | Max `commentThreads.list` pages per video. |
| `SECOND_PAGE_THRESHOLD` | 50 | Fetch page 2 only if page 1 yields fewer eligible comments than this. |
| `MAX_REPLY_EXPANSIONS_PER_VIDEO` ⚙ | 2 | Max `comments.list` calls per video to resolve truncated reply lists. |
| `REFRESH_INTERVAL_HOURS` ⚙ | 12 | Re-sample each creator this often. |
| `METADATA_REFRESH_HOURS` ⚙ | 24 | Refresh channel title/thumbnail/subscribers this often. |
| `DAILY_UNIT_SAFETY_LIMIT` ⚙ | 9000 | Stop calling YouTube for the rest of the Pacific day at this many units. |
| `SUBREQUEST_BUDGET` ⚙ | 45 | Max external `fetch` calls per cron invocation (Free plan cap is 50). |
| `WORST_CASE_CALLS_PER_CREATOR` | 13 | `1 playlist + 3 videos × (2 pages + 2 expansions)`. |
| `MAX_CREATORS_PER_TICK` ⚙ | 3 | Hard cap per invocation. |
| `LEASE_MINUTES` | 15 | Claim lease so crashed runs retry later. |
| `RETENTION_DAYS` ⚙ | 30 | Snapshots and per-video rows older than this are deleted. Raise only after confirming the policy allows retaining derived metrics longer. |

Quota cost table (all list calls are **1 unit**): `channels.list`, `playlistItems.list`, `commentThreads.list`, `comments.list`. `search.list` = 100 and is **forbidden** (add a test asserting the client has no method that calls it).

---

## 6. Database (Supabase Postgres)

Apply migrations in order using the Supabase SQL editor or `supabase db push`. Files below are authoritative; copy verbatim.

### 6.1 `db/migrations/0001_init.sql`

```sql
-- file: db/migrations/0001_init.sql
create table creators (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null unique,
  handle text,
  title text not null,
  niche text not null,
  thumbnail_url text,
  subscriber_count bigint,
  uploads_playlist_id text not null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'invalid', 'removed')),
  next_refresh_at timestamptz not null default now(),
  last_refreshed_at timestamptz,
  metadata_refreshed_at timestamptz,
  failure_count int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
create index creators_due_idx on creators (next_refresh_at) where status = 'active';
create index creators_niche_idx on creators (niche);

create table creator_snapshots (
  id bigint generated always as identity primary key,
  creator_id uuid not null references creators (id) on delete cascade,
  captured_at timestamptz not null default now(),
  videos_sampled int not null,
  comments_eligible int not null,
  replied_threads int not null,
  raw_reply_rate numeric(6, 5),
  score numeric(5, 2),
  ranked boolean not null default false,
  median_reply_minutes int,
  creator_reply_likes int not null default 0,
  truncated_threads int not null default 0,
  units_used int not null default 0
);
create index snapshots_creator_time_idx on creator_snapshots (creator_id, captured_at desc);
create index snapshots_captured_idx on creator_snapshots (captured_at);

create table snapshot_videos (
  snapshot_id bigint not null references creator_snapshots (id) on delete cascade,
  video_id text not null,
  title text not null,
  published_at timestamptz not null,
  comments_disabled boolean not null default false,
  eligible_comments int not null default 0,
  replied_threads int not null default 0,
  primary key (snapshot_id, video_id)
);

create table quota_log (
  quota_date date primary key,            -- calendar date in America/Los_Angeles
  units_used int not null default 0,
  calls int not null default 0,
  updated_at timestamptz not null default now()
);

create table ingest_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  creators_processed int not null default 0,
  units_used int not null default 0,
  errors jsonb not null default '[]'::jsonb
);
create index ingest_runs_started_idx on ingest_runs (started_at desc);
```

### 6.2 `db/migrations/0002_roles_rls.sql`

Replace the password placeholders at apply time with generated values. **Never commit real passwords.**

```sql
-- file: db/migrations/0002_roles_rls.sql
create role ingest_writer login password 'REPLACE_ME_INGEST';
create role web_reader login password 'REPLACE_ME_WEB';

grant usage on schema public to ingest_writer, web_reader;

grant select, insert, update, delete
  on creators, creator_snapshots, snapshot_videos, quota_log, ingest_runs
  to ingest_writer;
grant usage, select on all sequences in schema public to ingest_writer;

grant select
  on creators, creator_snapshots, snapshot_videos, quota_log, ingest_runs
  to web_reader;

do $$
declare t text;
begin
  foreach t in array array['creators', 'creator_snapshots', 'snapshot_videos', 'quota_log', 'ingest_runs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy ingest_all on %I for all to ingest_writer using (true) with check (true)', t);
  end loop;

  foreach t in array array['creator_snapshots', 'snapshot_videos', 'quota_log', 'ingest_runs']
  loop
    execute format('create policy web_select on %I for select to web_reader using (true)', t);
  end loop;
end $$;

-- Public site may only read creators that are active.
create policy web_select on creators for select to web_reader using (status = 'active');
```

On Supabase, also close the public REST surface (do not rely on RLS alone):

```sql
-- file: db/migrations/0002b_close_rest.sql
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
```

### 6.3 `db/migrations/0003_views.sql`

```sql
-- file: db/migrations/0003_views.sql
create view v_leaderboard as
with latest as (
  select distinct on (creator_id)
    creator_id, captured_at, videos_sampled, comments_eligible, replied_threads,
    raw_reply_rate, score, ranked, median_reply_minutes, creator_reply_likes, truncated_threads
  from creator_snapshots
  order by creator_id, captured_at desc
)
select
  c.id as creator_id,
  c.channel_id,
  c.handle,
  c.title,
  c.niche,
  c.thumbnail_url,
  c.subscriber_count,
  l.captured_at,
  l.videos_sampled,
  l.comments_eligible,
  l.replied_threads,
  l.raw_reply_rate,
  l.score,
  l.ranked,
  l.median_reply_minutes,
  l.creator_reply_likes,
  l.truncated_threads,
  case when l.ranked then rank() over (order by l.score desc nulls last) end as global_rank,
  case when l.ranked then rank() over (partition by c.niche order by l.score desc nulls last) end as niche_rank
from creators c
join latest l on l.creator_id = c.id
where c.status = 'active';

grant select on v_leaderboard to web_reader;
```

The view runs with its owner's privileges (so it is not blocked by RLS on the base tables) and is granted only to `web_reader`.

### 6.4 Seed file and script

`seed/creators.csv` (owner fills; header required, handles include the `@`):

```
handle,niche
@example_handle_1,tech
@example_handle_2,gaming
```

Suggested niches (10–15 creators each): `tech, gaming, education, finance, fitness, cooking, music, comedy, science, travel`.

`scripts/seed.ts`: for each row call `channels.list?part=snippet,statistics,contentDetails&forHandle=<handle>` (1 unit each), then upsert into `creators` on `channel_id` setting `handle, title, niche, thumbnail_url, subscriber_count, uploads_playlist_id = contentDetails.relatedPlaylists.uploads, metadata_refreshed_at = now()`. Unresolvable handles are printed and skipped (exit code 0, summary at end). Reads `DATABASE_URL` (ingest_writer role) and `YOUTUBE_API_KEY` from env.

---

## 7. Scoring spec (`packages/scoring`)

**What is measured.** Of the *eligible* top-level comments sampled for a creator, what fraction received at least one reply from the creator's own channel.

**Definitions**

- *Sampled videos*: up to `SAMPLE_VIDEOS` most recent uploads published within `WINDOW_DAYS`.
- *Eligible comment* (top-level thread): published at least `MATURITY_HOURS` before `now`, **and** not authored by the creator.
- *Replied thread*: an eligible thread with ≥ 1 reply authored by the creator's channel (found in embedded replies or via an expansion call).
- `raw_reply_rate = replied / eligible`.
- **Score (0–100)** = `100 × (replied + PRIOR_RATE × PRIOR_STRENGTH) / (eligible + PRIOR_STRENGTH)`, rounded to 2 decimals. This is a shrunk (Bayesian-style) rate so tiny samples cannot top the board with 100%.
- Ranked only if `eligible ≥ MIN_ELIGIBLE`; otherwise `score = null`, `ranked = false` (shown as "not enough data").
- Secondary stats (displayed, **not** in the score): median reply latency in minutes (earliest creator reply minus parent publish time, median across replied threads, rounded) and total likes on the creator's replies.

**Not available from the official API:** whether the creator "hearted" or pinned a comment. Do not attempt to include hearts. Document this in METHODOLOGY.md.

**Known bias (document it):** `replies.comments` embedded in `commentThreads.list` is only a subset of replies when `totalReplyCount` exceeds the list length. Threads whose creator-reply status could not be resolved within the expansion budget are counted in `truncated_threads`. Therefore `raw_reply_rate` is a **lower bound**.

**Public API of the package**

```ts
export const WINDOW_DAYS = 30;
export const SAMPLE_VIDEOS = 3;
export const MATURITY_HOURS = 24;
export const MIN_ELIGIBLE = 30;
export const PRIOR_RATE = 0.05;
export const PRIOR_STRENGTH = 20;
export function isEligibleComment(publishedAt: Date, now: Date): boolean;
export function rawRate(replied: number, eligible: number): number | null;   // null when eligible = 0
export function shrunkRate(replied: number, eligible: number): number;
export function score(replied: number, eligible: number): number | null;     // null if eligible < MIN_ELIGIBLE
export function median(values: number[]): number | null;
```

**Test vectors (must be in `index.test.ts`)**

| Call | Expected |
|---|---|
| `score(40, 100)` | `34.17` |
| `score(3, 30)` | `8` |
| `score(0, 200)` | `0.45` |
| `score(10, 29)` | `null` (below `MIN_ELIGIBLE`) |
| `shrunkRate(10, 10)` | `≈ 0.36667` (within 1e-5) |
| `rawRate(0, 0)` | `null` |
| `median([])` | `null` |
| `median([5])` | `5` |
| `median([1, 3])` | `2` |
| `median([4, 1, 9])` | `4` |
| `isEligibleComment(now − 23h59m, now)` | `false` |
| `isEligibleComment(now − 24h, now)` | `true` |

Also property tests: score is monotonic non-decreasing in `replied` for fixed `eligible`; `0 ≤ score ≤ 100`.

---

## 8. YouTube client (`packages/youtube`)

Thin typed wrapper over `fetch` against `https://www.googleapis.com/youtube/v3/`. Responses validated with `zod`. **Request only needed fields** with the `fields` parameter (smaller payloads = less CPU on a 10 ms budget). The `fields` strings below must be verified in the API Explorer when implementing (Section 14, item 8).

```ts
export interface YouTubeClient {
  channelsByIds(ids: string[]): Promise<ChannelInfo[]>;                 // ≤50 ids, 1 unit
  channelByHandle(handle: string): Promise<ChannelInfo | null>;         // 1 unit
  latestUploads(playlistId: string, max: number): Promise<UploadItem[]>;// 1 unit
  commentThreads(videoId: string, pageToken?: string): Promise<CommentThreadsPage>; // 1 unit
  replies(parentId: string): Promise<ReplyItem[]>;                      // comments.list, 1 unit
}
```

Constructor: `createYouTubeClient({ apiKey, fetchImpl = fetch, onCall: (units: number) => void })`. `onCall` is invoked **before** every network call and is how the subrequest budget and unit counter are enforced (it may throw `BudgetExceeded`).

**Endpoints**

| Method | Request | `fields` |
|---|---|---|
| channels | `channels?part=snippet,statistics,contentDetails&id=A,B,C` or `&forHandle=@h` | `items(id,snippet(title,customUrl,thumbnails/default/url),statistics/subscriberCount,contentDetails/relatedPlaylists/uploads)` |
| uploads | `playlistItems?part=contentDetails,snippet&playlistId=<uploads>&maxResults=<n>` | `items(contentDetails(videoId,videoPublishedAt),snippet/title)` |
| threads | `commentThreads?part=snippet,replies&videoId=<id>&maxResults=100&order=time[&pageToken=]` | `nextPageToken,items(snippet(totalReplyCount,topLevelComment(id,snippet(publishedAt,likeCount,authorChannelId/value))),replies/comments(id,snippet(publishedAt,likeCount,authorChannelId/value,parentId)))` |
| replies | `comments?part=snippet&parentId=<id>&maxResults=100` | `items(id,snippet(publishedAt,likeCount,authorChannelId/value,parentId))` |

The uploads playlist ID is `contentDetails.relatedPlaylists.uploads` from `channels.list`. Do not request comment text fields.

**Errors.** Throw `YouTubeError` (a class extending `Error`, with `status: number` and `reason: 'commentsDisabled' | 'quotaExceeded' | 'videoNotFound' | 'forbidden' | 'rateLimitExceeded' | 'unknown'`) mapped from the API error body (`error.errors[0].reason`). One retry (500 ms + jitter) on network error or 5xx, **only** if the budget allows another call. `quotaExceeded` is never retried.

**Tests.** Store sanitized JSON fixtures under `packages/youtube/fixtures/` (threads with and without embedded replies, truncated replies, comments disabled, quota exceeded). Test parsing, error mapping, retry behavior, `onCall` counting, and that the client exposes no `search` method.

---

## 9. Ingest Worker (`apps/ingest`)

### 9.1 `wrangler.jsonc`

```jsonc
{
  "name": "replyboard-ingest",
  "main": "src/index.ts",
  "compatibility_date": "2026-11-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "triggers": { "crons": ["* * * * *"] },
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<HYPERDRIVE_INGEST_ID>" }],
  "observability": { "enabled": true }
  // If CPU limit errors appear on the Free plan (Section 14, item 2), the owner may move to the
  // Paid plan and add:  "limits": { "cpu_ms": 30000 }
}
```

Secret: `YOUTUBE_API_KEY` (via `wrangler secret put`). Local dev: `.dev.vars` (gitignored). Only a `scheduled` handler exists; no public `fetch`.

### 9.2 Tick algorithm (`runTick`)

```
runTick(env, scheduledTime):
  sql    = postgres(env.HYPERDRIVE.connectionString, { max: 2, fetch_types: false })
  now    = new Date(scheduledTime)
  qdate  = pacificDate(now)                       // Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles'})
  used   = SELECT units_used FROM quota_log WHERE quota_date = qdate   (0 if none)
  if used >= DAILY_UNIT_SAFETY_LIMIT: log; end
  budget = new SubrequestBudget(SUBREQUEST_BUDGET)
  yt     = createYouTubeClient({ apiKey, onCall: u => { budget.consume(1); tickUnits += u } })

  1. METADATA: if budget allows and any active creators have metadata_refreshed_at null or older than
     METADATA_REFRESH_HOURS: one channelsByIds() call (≤50 ids, oldest first); update title, thumbnail,
     subscriber_count, uploads_playlist_id, metadata_refreshed_at. IDs not returned -> failure_count++,
     last_error='channel not found'; status='invalid' after 5.

  2. CREATORS: processed = 0
     while processed < MAX_CREATORS_PER_TICK
           and budget.remaining >= WORST_CASE_CALLS_PER_CREATOR
           and used + tickUnits + WORST_CASE_CALLS_PER_CREATOR <= DAILY_UNIT_SAFETY_LIMIT:
       creator = claimOne()           // leased row, see 9.3; break if none
       try   { result = processCreator(creator, yt, now); persist(result); markSuccess(creator) }
       catch (e):
         if e is YouTubeError quotaExceeded: set quota_log.units_used = 10000 for qdate; release lease; break
         if e is BudgetExceeded: release lease (next_refresh_at = now()); break
         else: markFailure(creator, e)  // failure_count++, next_refresh_at = now + min(2^failure_count hours, 24h); invalid after 5
       processed++

  3. QUOTA: upsert quota_log (quota_date = qdate) units_used += tickUnits, calls += tickCalls, updated_at = now()
  4. PRUNE: only when scheduled minute == 17 and hour % 6 == 0 (UTC): see 9.5
  5. LOG: if processed > 0 or errors: INSERT ingest_runs row (idle ticks write nothing)
  6. ctx.waitUntil(sql.end())
```

### 9.3 Claiming (lease) query

```sql
with due as (
  select id from creators
  where status = 'active' and next_refresh_at <= now()
  order by next_refresh_at
  limit 1
  for update skip locked
)
update creators c
set next_refresh_at = now() + interval '15 minutes'
from due
where c.id = due.id
returning c.*;
```

On success: `next_refresh_at = now() + REFRESH_INTERVAL_HOURS`, `last_refreshed_at = now()`, `failure_count = 0`, `last_error = null`.

### 9.4 `processCreator(creator, yt, now)`

1. `uploads = yt.latestUploads(creator.uploads_playlist_id, SAMPLE_VIDEOS)`; keep videos with `videoPublishedAt ≥ now − WINDOW_DAYS`. If none: return an unranked snapshot (`videos_sampled = 0`).
2. For each sampled video:
   1. `page = yt.commentThreads(videoId)`. On `commentsDisabled`: record `comments_disabled = true`, continue.
   2. For each thread: skip if the top-level author channel ID equals `creator.channel_id`; skip if not `isEligibleComment(publishedAt, now)`. Otherwise it is eligible.
   3. If eligible count so far for this video `< SECOND_PAGE_THRESHOLD`, a `nextPageToken` exists, and pages `< MAX_COMMENT_PAGES_PER_VIDEO`: fetch the next page and repeat step 2.
   4. For each eligible thread, creator-replied = any embedded reply whose author channel ID equals `creator.channel_id`.
   5. **Expansion:** among eligible threads **not** yet creator-replied with `totalReplyCount > embedded reply count`, take up to `MAX_REPLY_EXPANSIONS_PER_VIDEO` with the largest `totalReplyCount`; for each call `yt.replies(parentId)` and re-check for a creator reply. Remaining unresolved threads of that kind are counted in `truncated_threads`.
   6. For replied threads, record latency = earliest creator reply `publishedAt` − parent `publishedAt` (minutes); sum `likeCount` of the creator's replies.
3. Aggregate across videos: `eligible`, `replied`, `latencies[]`, `reply_likes`, `truncated`.
4. `score(replied, eligible)`; `ranked = score !== null` (and ≥ 1 sampled video not disabled); `raw_reply_rate = rawRate(...)`; `median_reply_minutes = median(latencies)` rounded.
5. Return `{ snapshot, videos[], unitsUsed }`. **Do not retain any comment text or author IDs beyond in-memory comparison.**

`persist(result)` inserts one `creator_snapshots` row and its `snapshot_videos` rows in a single transaction.

### 9.5 Prune

```sql
delete from creator_snapshots where captured_at < now() - make_interval(days => $1);  -- cascades to snapshot_videos
delete from ingest_runs      where started_at  < now() - interval '7 days';
delete from quota_log        where quota_date  < (now() - interval '60 days')::date;
```

### 9.6 Helpers

- `SubrequestBudget { constructor(limit), consume(n=1) throws BudgetExceeded, get remaining }`; `BudgetExceeded` extends `Error`.
- `pacificDate(d: Date): string` returns `YYYY-MM-DD` in `America/Los_Angeles`. Test across a DST boundary.
- Structured JSON logging via `console.log(JSON.stringify({ evt, ... }))`. No secrets.

### 9.7 Tests (`apps/ingest`)

Vitest with mocked `YouTubeClient` and an in-memory fake for DB calls (extract DB access behind a small interface). Cover: eligibility edges, creator-authored threads excluded, embedded-reply detection, expansion selection order and cap, truncated count, disabled comments, no recent uploads, quota guard stops the loop, budget stops mid-run without partial writes, backoff math, Pacific date.

---

## 10. Web app (`apps/web`)

Next.js (App Router) + Tailwind, deployed to Cloudflare Workers following the **current official Cloudflare Next.js guide** (Section 14, item 4). Server components fetch data; only the trend chart and filter controls are client components.

### 10.1 Bindings

`HYPERDRIVE` (role `web_reader`), `CACHE` (KV namespace). Vars: `SITE_URL`, `REMOVAL_CONTACT_EMAIL`. Access bindings only through one module, `src/lib/env.ts`, so adapter differences are isolated.

`src/lib/db.ts`: `getSql()` returns a `postgres` client created from `env.HYPERDRIVE.connectionString` with `{ max: 5, fetch_types: false }` (confirm against Cloudflare's postgres.js + Hyperdrive guide). One client per request; close with `waitUntil`. Parameterized tagged-template queries only; **sort and filter inputs are validated against whitelists**, never interpolated.

`src/lib/cache.ts`:

```ts
export async function cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T>;
// KV get -> JSON.parse; on miss run loader, then KV put with expirationTtl (min 60s).
// Every KV operation is wrapped in try/catch: cache failure must never fail the request.
```

TTLs: leaderboard 300 s, creator detail 300 s, status 60 s.

### 10.2 Routes

| Route | Content |
|---|---|
| `/` | Leaderboard. Query params: `niche`, `sort` (`score` default \| `latency` \| `sample`), `q` (name search, max 60 chars). |
| `/creator/[channelId]` | Score card, 30-day trend chart (score + raw reply rate), per-video breakdown for the latest snapshot, secondary stats, link to the YouTube channel, "how this is calculated" excerpt. 404 for unknown/removed. |
| `/methodology` | Plain-language metric explanation, formula, constants, sampling, limitations (embedded replies lower bound, no hearts/pins, sample size, 24 h maturity), YouTube API Services notice. Source of truth is `docs/METHODOLOGY.md`. |
| `/status` | Quota used today (Pacific date) vs 10,000, safety limit, last ingest run, creators refreshed in the last 24 h / active creators, oldest `last_refreshed_at`. |
| `/about` | Purpose, creator removal process (`REMOVAL_CONTACT_EMAIL`), non-affiliation. |
| `/robots.txt`, `/sitemap.xml` | Allow all; sitemap lists leaderboard + creator pages. |

### 10.3 Queries (all read-only)

- Leaderboard: `select * from v_leaderboard where ($niche is null or niche = $niche) and ($q is null or title ilike '%' || $q || '%') order by ranked desc, <whitelisted sort>`. Unranked creators render in a separate "Not enough data yet" section.
- Niches: `select niche, count(*) from creators where status='active' group by niche order by niche` (served via `web_reader` policy).
- Trend: `select captured_at, score, raw_reply_rate, comments_eligible from creator_snapshots where creator_id = $1 order by captured_at`.
- Videos: `select * from snapshot_videos where snapshot_id = (select id from creator_snapshots where creator_id=$1 order by captured_at desc limit 1)`.
- Status: `quota_log` for today's Pacific date, latest `ingest_runs`, counts from `creators`.

Escape `%` and `_` in the `q` parameter before use in `ilike`.

### 10.4 UI requirements

The owner will do a visual polish pass, so structure the UI for easy restyling: **all design tokens (colors, radii, spacing, type scale) in CSS variables in `globals.css`, consumed by Tailwind**; components are small and prop-driven.

- **Leaderboard row:** rank, avatar (plain `<img loading="lazy">` with explicit width/height), name, niche chip, score (number + horizontal bar), "replies to X% of comments", "typically replies within Y" (formatted min/h/d), sample size ("n = 142 · 3 videos"), "low sample" badge when `comments_eligible < 60`, "updated N h ago".
- **Responsive:** table on ≥ md; stacked cards on mobile. Sticky niche tabs; filters reflected in the URL (shareable).
- **States:** loading skeletons, empty results, friendly 503 "demo at capacity, try later" when the DB is unavailable, stale-data banner if the newest snapshot is older than 36 h.
- **Accessibility:** semantic table markup, keyboard-focusable controls, visible focus rings, contrast ≥ WCAG AA, chart has a text/table alternative, respects `prefers-reduced-motion` and `prefers-color-scheme`.
- **Tone:** call the metric **"Responsiveness score"**. Default view emphasizes top responders. Do not use shaming language for low scores; low-score creators are simply ranked lower, with the methodology one click away.
- **Footer on every page:** "Data from the YouTube Data API. Use of this data is subject to the YouTube Terms of Service and the Google Privacy Policy. Not affiliated with or endorsed by YouTube." with links to `https://www.youtube.com/t/terms` and `https://policies.google.com/privacy`.
- **SEO:** per-page title/description, Open Graph tags.

### 10.5 Tests

Vitest for formatting helpers (duration, "updated ago"), query-param validation/whitelisting, `cached()` fallback behavior (KV throws -> loader still returns), and `ilike` escaping. Add one Playwright (or equivalent) smoke script `pnpm smoke <url>` that loads `/`, `/status`, `/methodology` and one creator page and asserts HTTP 200 and non-empty content.

---

## 11. Security, privacy, compliance

- API key restricted to YouTube Data API v3; lives only as an ingest Worker secret.
- Web Worker has **no** YouTube key and a **read-only** DB role.
- RLS enabled on all tables; anon/authenticated roles have no access.
- No comment text, commenter names, or commenter IDs stored (Rule 5). Per-video titles and IDs are API data: they are refreshed every snapshot and pruned after `RETENTION_DAYS`.
- Creator removal: on request set `creators.status = 'removed'` (hidden immediately) and delete their rows:
  `delete from creators where channel_id = '<id>';` (cascades). Document this in `docs/ARCHITECTURE.md`.
- Official API only; no scraping of any kind.
- Dependencies pinned via lockfile; CI runs `pnpm audit --prod` as a non-blocking report.

---

## 12. Testing and CI

`.github/workflows/ci.yml`: on push/PR run `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`. **No scheduled workflows** (the ingest cron runs on Cloudflare). Deploys are manual (`pnpm deploy:ingest`, `pnpm deploy:web`), each failing fast if tests fail.

Coverage expectations: `packages/scoring` ≥ 95 % lines; `packages/youtube` and `apps/ingest` core logic ≥ 80 %.

---

## 13. Deployment runbook

Owner runs the commands that need credentials; the agent prepares scripts and docs.

1. **Supabase:** apply `0001`, `0002` (with generated passwords), `0002b`, `0003`. Verify with the SQL editor that `anon` cannot select from `creators`.
2. **Seed:** `YOUTUBE_API_KEY=... DATABASE_URL=<ingest_writer direct URL> pnpm tsx scripts/seed.ts`. Expect ~1 unit per creator.
3. **Hyperdrive configs** (use Supabase's **Direct connection** host, not the pooled string):
   ```
   pnpm wrangler hyperdrive create replyboard-ingest --connection-string="postgres://ingest_writer:<pw>@db.<project-ref>.supabase.co:5432/postgres"
   pnpm wrangler hyperdrive create replyboard-web    --connection-string="postgres://web_reader:<pw>@db.<project-ref>.supabase.co:5432/postgres"
   ```
   Put the returned IDs into each app's `wrangler.jsonc`.
4. **KV:** `pnpm wrangler kv namespace create CACHE`; bind in `apps/web`.
5. **Ingest:** `pnpm --filter ingest exec wrangler secret put YOUTUBE_API_KEY`, then `pnpm deploy:ingest`.
6. **Verify ingest (Phase 5 gate):** within ~15 minutes, `ingest_runs` rows appear and `creator_snapshots` fill. In the Cloudflare dashboard open the Worker's Metrics and check **Exceeded CPU Time Limits**. If present, set `MAX_CREATORS_PER_TICK=1`; if still failing, tell the owner (options: Paid plan + `limits.cpu_ms`).
7. **Web:** `pnpm deploy:web`; run `pnpm smoke https://<worker-url>`.
8. Optional: custom domain/subdomain via the Cloudflare dashboard (owner).

---

## 14. Known unknowns and fallbacks (verify; update this file with findings)

1. **Hearts/pins are not exposed by the official API.** Confirmed via the API's resource docs; scoring excludes them. Keep it that way.
2. **Free-plan CPU time (10 ms per cron invocation).** Unknown whether parsing a few `fields`-trimmed pages fits. Measure after Phase 5. Mitigations in order: tighter `fields`, `MAX_CREATORS_PER_TICK=1`, owner upgrades Workers plan and sets `limits.cpu_ms`.
3. **Hyperdrive ↔ Supabase connectivity.** Cloudflare documents the Direct connection string. If connection setup fails (for example IPv6 reachability), try Supabase's session-mode pooler string (username format `role.<project-ref>`) and consult Hyperdrive's troubleshooting docs. Also confirm how Hyperdrive queries count toward Worker subrequest limits (Free: 50 external, 1,000 to Cloudflare services); ticks make only a handful of queries so this should not bind.
4. **Next.js on Workers.** Cloudflare's docs currently recommend `vinext` for new Next.js apps and maintain the OpenNext adapter for existing ones. Follow the guide at `developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/` and note which path was used in `docs/ARCHITECTURE.md`. If the Free plan's Worker bundle-size limit blocks deployment, report it to the owner rather than silently dropping features.
5. **Retention.** YouTube API Services policy: stored API data generally must be refreshed or deleted within 30 days. Derived-score history beyond 30 days is **unconfirmed**; keep `RETENTION_DAYS = 30` until the owner confirms otherwise in the official policy.
6. **Replies subset.** Embedded replies are a subset when `totalReplyCount` exceeds the list length (documented by Google); expansions are budgeted, hence the lower-bound caveat.
7. **Rate/burst limits.** Free Workers have a daily request cap (100,000) and a burst limit; Hyperdrive Free allows 100,000 queries/day and fails further queries until reset. The KV cache and friendly 503 page exist for this reason.
8. **`fields` syntax.** Validate each `fields` string in the YouTube API Explorer before hard-coding it; adjust if a field path is rejected.
9. **KV Free limits** (1,000 writes/day, 100,000 reads/day): cache writes are best-effort and may be skipped without error.

---

## 15. Phases and acceptance criteria

**Phase 0 — Scaffold.** Monorepo, tsconfig, Vitest, CI, `AGENTS.md` (Sections 0 and 4.1), README skeleton, and ESLint + Prettier configured per Section 4.1 (Google TypeScript Style Guide).
*Accept:* `pnpm install && pnpm typecheck && pnpm lint && pnpm test` pass on an empty-but-wired repo; CI green; a deliberate violation (for example a `var`, an `any`, a default export outside the allowed files, or an `I`-prefixed interface) makes `pnpm lint` fail, then is removed.

**Phase 1 — Database and seed.** Migrations in Section 6, seed script, sample `creators.csv` with placeholder handles.
*Accept:* migrations apply cleanly to a scratch Postgres (local or Supabase); `anon` has no table access; `web_reader` can select from `v_leaderboard` but cannot insert; `ingest_writer` can insert snapshots; seed script dry-run prints resolved creators.

**Phase 2 — Scoring package.** Section 7 including all test vectors and property tests.
*Accept:* tests pass; coverage ≥ 95 %.

**Phase 3 — YouTube client.** Section 8 with fixtures.
*Accept:* tests pass; no `search` method; `onCall` counted per call; error mapping verified against fixtures.

**Phase 4 — Ingest logic.** `processCreator`, scheduler, quota, budget, prune, with tests (Section 9.7). Run locally with `wrangler dev --test-scheduled` against a scratch database using the Hyperdrive local connection string approach in Cloudflare's local-development docs.
*Accept:* tests pass; a local run processes ≥ 1 real creator and writes one snapshot and its video rows; quota_log increments by the expected number of units.

**Phase 5 — Deploy ingest.** Section 13 steps 1–6.
*Accept:* 24 hours of operation shows every active creator refreshed at least once, daily quota used well under the safety limit, no CPU-limit errors in metrics (or documented mitigation applied).

**Phase 6 — Web app.** Routes, queries, cache, UI per Section 10, with tests.
*Accept:* all pages render against real data locally; Lighthouse (mobile) ≥ 90 for performance and ≥ 95 for accessibility on `/`; keyboard-only navigation works; no secrets in the client bundle.

**Phase 7 — Deploy web.** Section 13 steps 7–8.
*Accept:* `pnpm smoke` passes against production; `/status` shows live quota; stale/empty/error states manually verified.

**Phase 8 — Documentation and polish.** README (what/why, screenshots, architecture diagram, setup, design decisions, limitations), `docs/ARCHITECTURE.md`, `docs/METHODOLOGY.md`, CI badge, license.
*Accept:* a stranger can clone, read the README, and understand the metric and architecture in under five minutes; METHODOLOGY states every limitation in Sections 7 and 14.

**Definition of done:** public URL live; ≥ 100 creators ranked across ≥ 5 niches; all tests green; `pnpm lint` clean under the Section 4.1 style configuration with no ad-hoc suppressions; README and methodology complete; no secrets or comment text in the repo or database.

---

## 16. Stretch ideas (only after Definition of done)

- Public read-only JSON endpoint for the leaderboard (cached).
- Per-niche shareable OG images.
- Weekly "most improved" view over the 30-day window.
- Reply-latency distribution chart per creator.
- Cloudflare Queues fan-out for polling if the creator list grows.
