# Testing

How testing works in finmon. This is a living document — it grows as tests land.
If you add a test pattern, fixture, or convention that the next person needs to
know, write it here. For the *plan* of what still needs covering, see
[`TESTS_COVERAGE.md`](./TESTS_COVERAGE.md).

---

## TL;DR for a new agent

```bash
npm test          # run everything once
npm run test:watch  # watch mode
npm run test:cov    # with a V8 coverage report
npx vitest run src/lib/charts.test.ts   # a single file
```

- Runner is **Vitest 3.2.4** (pinned — see [Why pinned](#why-vitest-is-pinned)).
- Tests are **co-located** next to source as `*.test.ts` / `*.test.tsx`.
- Default environment is **node**. Component tests opt into jsdom per-file (see
  [Component tests](#component-tests)).
- **Never hit the real DB, network, or auth in unit tests** — mock at the
  module boundary. See [Mocking](#mocking).
- Anything that reads "now" **must pin the clock**. See
  [Time-sensitive tests](#time-sensitive-tests).

---

## Test stack

| Concern | Tool |
|---------|------|
| Runner / assertions / mocking | `vitest` (`expect`, `vi`, globals on) |
| Path aliases (`@/` → `src/`) | `vite-tsconfig-paths` plugin |
| DOM for component tests | `jsdom` + `@testing-library/react` + `user-event` |
| DOM matchers | `@testing-library/jest-dom` (loaded in `test/setup.ts`) |
| Coverage | `@vitest/coverage-v8` |

Config: [`vitest.config.ts`](./vitest.config.ts). Setup: [`test/setup.ts`](./test/setup.ts).
Globals (`describe`/`it`/`expect`/`vi`) are enabled, so you can use them without
importing — but existing tests import them explicitly for clarity; match that.

### Why Vitest is pinned

`vitest@latest` (3.2.5) declares a hard dependency on `vite-node@3.2.5`, which
was **never published** to npm — installing it fails with `ETARGET`. `3.2.4` is
the last version with a resolvable `vite-node` and is compatible with Node 20 /
`@types/node@20`. The `vitest@5` beta drops `vite-node` but requires
`@types/node@22+` and `vite@6+`, so it's not an option here yet. Keep `vitest`
and `@vitest/coverage-v8` pinned to the same exact version.

### `server-only` stub

`src/lib/dal.ts` and `src/lib/email.ts` import `server-only`, which throws when
resolved outside a React Server Component graph (which is always, under Vitest).
`vitest.config.ts` aliases `server-only` → [`test/stubs/empty.ts`](./test/stubs/empty.ts)
(a no-op) so those modules import cleanly. Add to that stub list if a new
server-only shim is needed.

---

## Layout & naming

```
src/lib/filters.ts        →  src/lib/filters.test.ts      (co-located)
test/setup.ts             jest-dom matchers
test/helpers.ts           shared helpers (formData builder, TEST_USER_ID)
test/stubs/empty.ts       server-only stub
```

Name a test after the branch it pins ("rejects a category the user does not
own"), not the function name. One behavior per `it`. Use `it.each([...])` for
the validation-rejection tables — most action tests do.

---

## Layers of tests

| Layer | Files | Strategy |
|-------|-------|----------|
| Pure logic | `src/lib/{filters,charts,chartData,email}.ts`, registries | Plain unit; no mocks except `resend` |
| Server actions | `src/actions/*.ts` | Mock `@/db`, `@/lib/dal`, `next/cache`; assert validation, SQL params, `revalidatePath` |
| DB queries | `src/db/queries.ts` | Mock `@/db`; assert generated SQL + param array (incl. tenancy) |
| Middleware / auth | `src/proxy.ts`, `src/lib/dal.ts` | Mock `better-auth/cookies` / `@/lib/auth`; assert redirects |
| Route handlers | `src/app/api/receipts/[id]/route.ts` | Mock `@/lib/dal` + `@/db/queries`; call `GET(request, { params })` directly (`params` is a Promise) and assert status/headers/body |
| Components | `src/components/*` | jsdom + RTL; mock the action module and `next/navigation`; drive via `user-event`, assert state/URL/`FormData` |
| E2E | full stack | _Not yet — Phase 6_ |

---

## Mocking

Mock at the module boundary so unit tests stay fast and hermetic. The
`vi.mock` factory is **hoisted above imports**, so any mock fn it references must
be created with `vi.hoisted`:

```ts
const { query, revalidatePath } = vi.hoisted(() => ({
  query: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/db", () => ({ pool: { query } }));
vi.mock("@/lib/dal", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("next/cache", () => ({ revalidatePath }));

// then import the module under test AFTER the mocks
import { createTransaction } from "@/actions/transactions";
```

Seams in use:

| Module | Mocked as | Used by |
|--------|-----------|---------|
| `@/db` | `{ pool: { query } }` | action + query tests |
| `@/lib/dal` | `requireUser` → `{ id: "user-1" }` | action tests |
| `next/cache` | `revalidatePath` spy | action tests |
| `next/navigation` | `redirect` spy | `auth` action, `dal` |
| `next/headers` | `headers` → `new Headers()` | `auth` action, `dal` |
| `@/lib/auth` | `{ auth: { api: { getSession, signOut } } }` | `dal`, `auth` action |
| `better-auth/cookies` | `getSessionCookie` spy | `proxy` |
| `resend` | `{ Resend: () => ({ emails: { send } }) }` | `email` |
| `@/actions/{transactions,categories,plans}` | the action(s) → `vi.fn()` | component tests |
| `next/navigation` | `useRouter`→`{replace}`, `usePathname`, `useSearchParams` | `ChartTabs`, `FilterPanel` |

Reset between tests: `query.mockReset()` in `beforeEach`, `vi.clearAllMocks()` in
`afterEach`. For `email` tests, also `vi.resetModules()` + `vi.unstubAllEnvs()`
because `email.ts` reads `RESEND_API_KEY` **at module load** — set the env with
`vi.stubEnv(...)` *before* `await import("@/lib/email")`.

### Helpers — `test/helpers.ts`
- `formData({ amount: "10", type: "spend", ... })` — builds a `FormData`,
  skipping `undefined` values. Server actions take `FormData`, so all action
  tests use this.
- `TEST_USER_ID` — the id the mocked `requireUser` returns; assert it appears in
  write params.

---

## Time-sensitive tests

`currentMonth` (filters) and the chart bucket/tail-trim logic (`charts.ts`) read
the current date. **Always pin the clock**, or tests rot at month boundaries:

```ts
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
// ...assert...
vi.useRealTimers(); // in afterEach
```

Two gotchas in `charts.ts`: some helpers use **local** date getters
(`getFullYear`/`getMonth`), so results can shift by a timezone offset. Tactics
used in `src/lib/charts.test.ts`:
- For bucket-length assertions, freeze "today" **past** every selected month so
  the current-month tail-trim never fires — month lengths are then TZ-independent.
- For the one tail-trim test, freeze mid-month at **noon UTC** and assert a ±1
  day tolerance rather than an exact count.

---

## Database tests

Currently **mocked only** — `src/db/queries.test.ts` asserts the generated SQL
string and the param array for each branch (with/without category filter, day
vs month bucket, empty-month short-circuit) and includes a tenancy sweep
asserting every query is scoped by `user_id = $1`. No real Postgres is spun up.

A real-Postgres integration tier (Phase 3b in the coverage plan) is **not yet
implemented**. When it is, document provisioning / migration / teardown here.

---

## Component tests

Done (Phase 5). Each file opts into jsdom with a **first-line pragma**:

```ts
// @vitest-environment jsdom
```

The default environment stays `node`; only files with that pragma get a DOM.

Covered client components and what each test pins:

| File | Pins |
|------|------|
| `CategoryRow.test.tsx` | edit toggle, save `FormData` (id+name+priority), error-stays-editing, cancel reverts |
| `PlanRow.test.tsx` | remaining = planned−spent, unplanned shows input directly, Save disabled until amount, upsert `FormData`, error |
| `TransactionRow.test.tsx` | two-click delete confirm, verifying a `ready_to_verify` tx by clicking its status tag → `verifyTransaction`, and that the row carries no inline Edit/Verify buttons (both moved to the modal / the status tag) |
| `ProductsModal.test.tsx` | the **Show products** toggle gates the product list, transaction edit → `updateTransaction` `FormData`, add-product via the collapsed "Add product" form, two-click product delete, the green/red product-total line, the two-phase receipt scan (start awaited, vision scan deferred until the row re-renders `processing`) + start-error, close |
| `TransactionCreateSheet.test.tsx` | FAB open / Escape / Close, **auto-close on `successCount` bump**, error keeps it open, datalist options |
| `ChartTabs.test.tsx` | sets/clears `?chart=`, preserves other params, no-op on active tab |
| `FilterPanel.test.tsx` | open dropdown, month/category toggle → URL params, "all but one" collapse, Clear all, `showCategoryFilter` |
| `BugReportButton.test.tsx` | open/Escape/Close, submit `FormData` (message), auto-close on `successCount` bump, error keeps it open |

Conventions / gotchas learned here:

- **Mock the action, not the DB.** Component tests `vi.mock("@/actions/...")` with
  `vi.fn()`s — they assert the component's behavior (what `FormData` it builds,
  how it reacts to `{ok}`/`{error}`/`successCount`), not the action internals
  (those are Phase 2). Resolve the mock with the shape the component expects.
- **Row components must be rendered inside a `<table><tbody>`** or React warns —
  helper-wrap them.
- **Mobile + desktop render simultaneously** under jsdom (no CSS media queries),
  so list rows emit *two* copies of most text/inputs. Disambiguate by scoping to
  the row you want (`TransactionRow.test.tsx` uses a `desktopRow()` helper that
  grabs the `hidden md:table-row` `<tr>` via its date cell, then queries
  `within(...)` it) or by `findAllByText`.
- **`useActionState` is driven by a real form submit**: fill required inputs and
  click submit; jsdom enforces `min`/`required`, so a value that violates them
  silently blocks the submit and the action never runs (use a valid value and
  let the *mock's* return drive the error branch).
- **`next/navigation`** is mocked; assert on `router.replace` calls. Build the
  expected query with `URLSearchParams` rather than matching a raw string.

---

## CI

Not wired up yet. Intended gate once it is: `npm ci && npm run lint && npm test`,
with E2E as a separate job behind a Postgres service container.

---

## Coverage status

281 tests (1 `todo`) across 27 files. Targeted modules are at/near 100%; overall
line coverage is dragged down only by server components/pages and infra files
(`auth.ts`, `db/index.ts`) that aren't unit-tested. (See `TESTS_COVERAGE.md` for
the full plan.)

| Area | Status |
|------|--------|
| Tooling (Phase 0) | ✅ done |
| Pure logic (Phase 1) | ✅ done — `filters` `charts` `chartData` `email` + registries |
| Server actions (Phase 2) | ✅ done — `transactions` `categories` `plans` `auth` |
| DB queries (Phase 3a, mocked) | ✅ done — `queries.ts` SQL builders + tenancy |
| DB integration (Phase 3b, real PG) | ☐ not started |
| Proxy & DAL (Phase 4) | ✅ done |
| Components (Phase 5) | ✅ done — `CategoryRow` `PlanRow` `TransactionRow` `TransactionCreateSheet` `ChartTabs` `FilterPanel` |
| E2E (Phase 6) | ☐ not started |

### Known gaps / TODOs pinned by tests
- `deleteTransaction` does not validate its `id` before querying (TO_FIX). Tracked
  as an `it.todo` in `src/actions/transactions.test.ts`.
