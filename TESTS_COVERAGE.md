# Test Coverage

What finmon's tests cover today, and what's still planned. For *how* the tests
work — stack, mocking seams, fixtures, gotchas — see [`TESTS.md`](./TESTS.md).

**Where we are:** **255 tests + 1 `todo`** across 24 files, all green. Every
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
| ✅ Pure logic | `src/lib/{filters,charts,chartData,email,receipt-scan}.test.ts`, `src/components/charts/registry.test.ts` | Filter parsing & URL round-trips, chart bucketing / date math (clock pinned), Recharts pivot, email templating & HTML-escaping, chart/nav registry integrity, and the receipt scanner (OpenAI request shape, json_schema strict mode, mapping line items → product fields incl. per-item and check-wide discounts, dropping non-positive/unnamed items and the manual-only `description`, missing-key / non-OK / malformed-JSON / bad-shape errors — `fetch` stubbed; plus system-prompt composition: `{{UNITS}}`/`{{EXAMPLES}}` substitution from `receipt-units.json`/`receipt-examples.json`, no `note` leak, the read-once cache, and a missing `receipt-prompt.md` surfacing at scan time rather than on import) |
| ✅ Server actions | `src/actions/{transactions,categories,plans,products,auth,receipt}.test.ts` | The `FormData` → validate → `pool.query` → `revalidatePath` contract: every validation-rejection branch, the success path, unique-violation handling, and `user_id` tenancy on every write. `transactions` pins the create-time row insert (`RETURNING id` → `lastTxId`, `has_receipt` → `processing`) and the optional amount/category rules (all-blank create/update rejected unless a receipt is staged/stored, category-less create skips the upsert and `/categories` revalidate, blanking the amount triggers a status recompute); `products` pins add/update/delete incl. tag parsing and ownership checks, plus `recomputeTransactionStatus` directly — costs matched against the effective amount (manual, else scanned receipt total), the check-wide `receipts.discount` netted off the cost sum, the manual-vs-scanned-total mismatch forcing `unverified`, the nothing-to-match case, and the missing-row no-op; `receipt` pins `scanReceiptForTransaction` — ownership, image validation, insert+recompute+revalidate, the failure path that still clears `processing`, and receipt-image persistence (upsert before the vision call, stored even when the scan fails, a failed store logged but not aborting the scan) |
| ✅ DB queries (mocked) | `src/db/queries.test.ts` | Generated SQL + param array for each branch (category/month clauses, day-vs-month bucket, empty-month short-circuit), the `getTransactions` products-attach round-trip and receipt LEFT JOIN, `getReceiptImage` (user-scoped, null for missing/foreign), and a sweep asserting every query is scoped by `user_id = $1` |
| ✅ Middleware & auth gate | `src/proxy.test.ts`, `src/lib/dal.test.ts` | Every redirect branch of the route guard (protected/auth pages, `?stale` cookie clearing) and `requireUser` / `getCurrentUser` |
| ✅ Route handlers | `src/app/api/receipts/[id]/route.test.ts` | The receipt-image endpoint: 401 without a session (before touching the DB), 404 for bad/missing/foreign ids, and the 200 path's bytes + `Content-Type` + `private, no-store` |
| ✅ Components | `src/components/{CategoryRow,PlanRow,TransactionRow,TransactionCreateForm,TransactionCreateSheet,FilterPanel,ProductsModal}.test.tsx`, `charts/ChartTabs.test.tsx` | Edit/save/cancel state (CategoryRow/PlanRow inline, and the transaction's edit form which now lives in the products modal), two-click delete confirm, verifying a `ready_to_verify` transaction by clicking its status tag (fires `verifyTransaction` with the row id; a plain non-clickable label for any other status, with no inline Edit/Verify buttons left on the row), sheet open/auto-close on success, error display, filter/tab toggles producing the right URL params, the products modal (transaction edit, Show-products toggle, product render / add-via-collapsed-form / delete, the green/red product-total line, the two-phase receipt scan + start-error, the "View receipt" link gated on `receipt_id`, close), and the create form's receipt flow (button flips to "Scan & add", `has_receipt` set, follow-up `scanReceiptForTransaction` fired against the new row) |

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

### ☐ Transaction status workflow

`recomputeTransactionStatus` is now pinned directly (see the server-actions row
above), but two status surfaces are still untested:

- **`StatusBadge`** in `src/components/TransactionRow.tsx` — label/colour per status
  and the unknown-status fallback to `unverified`.
- **`verifyTransaction`** in `src/actions/transactions.ts` — the action itself is
  untested (the `TransactionRow` test only pins the status-tag click → action call). Assert
  the guarded `ready_to_verify` → `verified` promotion, the `rowCount === 0`
  "not ready to verify" branch, invalid-id rejection, and `user_id` tenancy.

All fit the existing mocked-action / component tiers; low effort.

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
