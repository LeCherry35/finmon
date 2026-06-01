# Test Coverage

What finmon's tests cover today, and what's still planned. For *how* the tests
work — stack, mocking seams, fixtures, gotchas — see [`TESTS.md`](./TESTS.md).

**Where we are:** **152 tests + 1 `todo`** across 18 files, all green. Every
layer below the UI is unit-tested; the gaps left are a real-Postgres tier, full
end-to-end flows, and the CI gate.

> Status legend: ✅ covered · ☐ planned

---

## Covered

The build went bottom-up by return-on-investment — pure logic first (fast, no
infra), then the action/query/guard layers behind mocks, then the interactive
components.

| Layer | Files | What the tests pin |
|-------|-------|--------------------|
| ✅ Pure logic | `src/lib/{filters,charts,chartData,email}.test.ts`, `src/components/charts/registry.test.ts` | Filter parsing & URL round-trips, chart bucketing / date math (clock pinned), Recharts pivot, email templating & HTML-escaping, chart/nav registry integrity |
| ✅ Server actions | `src/actions/{transactions,categories,plans,auth}.test.ts` | The `FormData` → validate → `pool.query` → `revalidatePath` contract: every validation-rejection branch, the success path, unique-violation handling, and `user_id` tenancy on every write |
| ✅ DB queries (mocked) | `src/db/queries.test.ts` | Generated SQL + param array for each branch (category/month clauses, day-vs-month bucket, empty-month short-circuit) and a sweep asserting every query is scoped by `user_id = $1` |
| ✅ Middleware & auth gate | `src/proxy.test.ts`, `src/lib/dal.test.ts` | Every redirect branch of the route guard (protected/auth pages, `?stale` cookie clearing) and `requireUser` / `getCurrentUser` |
| ✅ Components | `src/components/{CategoryRow,PlanRow,TransactionRow,TransactionCreateSheet,FilterPanel}.test.tsx`, `charts/ChartTabs.test.tsx` | Edit/save/cancel state, two-click delete confirm, sheet open/auto-close on success, error display, and filter/tab toggles producing the right URL params |

These run with no infrastructure — `npm test` is enough.

---

## Planned

### ☐ Database integration (real Postgres)

The mocked query tests assert *what SQL we send*, not *what Postgres returns* —
they can't catch an actual SQL mistake or a wrong aggregation. Spin up Postgres
(Docker / Testcontainers), run `src/db/migrations/*.sql`, seed two users, and
verify the things only a live DB proves:

- **Tenancy isolation** — user A never sees user B's rows.
- **Aggregation math** — `getPlansForMonth` / `getPlansSummary` planned-vs-spent
  totals, month filtering (`LEFT(date,7)`), and ordering.

Highest value for the aggregation queries; medium effort.

### ☐ End-to-end (Playwright)

Real app instance + disposable Postgres, covering the flows that span the whole
stack:

1. **Auth** — register → auto sign-in → `/transactions`; logout; login; wrong
   password; protected route while logged out → `/login`.
2. **Transactions CRUD** — create (incl. on-the-fly category), edit, delete;
   filters change the visible list.
3. **Categories CRUD** — create, duplicate-name error, edit priority.
4. **Plan** — set a plan; planned/spent/left updates after a spend.
5. **Charts** — `/charts` renders; tab switch persists in URL; bucket switches
   day↔month across a wide range.
6. **Tenancy** — two registered users never see each other's data.

Keep this tier small and high-value — it's the slowest to run.

### ☐ CI gate

The unit tiers are green and infra-free, so the gate is ready to add:
`npm ci && npm run lint && npm test`. Start `test:cov` with a lenient line
threshold (~60%) and ratchet up. E2E runs as a separate job behind a Postgres
service container.

---

## Seeds for new test cases

`TO_FIX.md` audit findings make good test cases — several describe exact edge
cases worth pinning. Two are already tracked as deviations rather than green
tests:

- `deleteTransaction` doesn't validate its `id` before querying — parked as an
  `it.todo` in `src/actions/transactions.test.ts`.
- `email.ts` doesn't escape `url` — noted in `TESTS.md` rather than pinned as a
  failing test.

When you fix one, convert the note into a real assertion.

---

## Conventions

- Mock at the module boundary (`@/db`, `@/lib/dal`, `next/cache`,
  `next/navigation`); never reach the real DB in a unit test.
- Anything that reads "now" (`currentMonth`, chart tails) **must** pin the clock
  with fake timers — otherwise tests rot at month boundaries.
- One assertion theme per test; name tests by the branch they pin, not the
  function.
