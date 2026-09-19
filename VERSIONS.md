# Versions

Release log for finmon — newest first. Each entry records the **shipped feature and behaviour changes** for a version, at the level someone needs to decide whether to pull and redeploy (and what to do on the server when they do).

This is distinct from issue tracking: `TO_FIX.md` / `FIXED.md` track audit findings, while this file is the changelog of intentional changes. When you complete a meaningful update — a feature, a behaviour change, a migration — add an entry here and bump `version` in `package.json`.

Entry shape: `## <version> — <YYYY-MM-DD> — <headline>`, then **Added / Changed / Fixed** as needed, plus **Migrations** and **Deploy notes** when they apply.

---

## 0.13.0 — 2026-09-19 — Scan receipts in the assistant chat

### Added
- The assistant composer has a camera button. Attach a receipt photo (text optional) and the assistant scans it and proposes a transaction. On Accept, the transaction gets the scanned line items as products, the receipt total and the stored photo ("View receipt"), the same as scanning on the create form.
- The agent never sees the image. Its message carries an `[Image attached: receipt #<id>]` marker, and a new `scan_receipt` tool runs the existing OpenAI receipt scan on the stored photo. The agent can call it again if the result looks wrong; the latest scan is what gets attached. A turn with a photo gets extra receipt instructions and only the `scan_receipt` and `create_transaction` tools. `scan_receipt` also stays available in later turns ("rescan it").
- `create_transaction` takes an optional `receipt_id`. A scanned receipt can stand in for a missing amount or category.
- **Stop button**: while the assistant is answering, Send turns into Stop. Stopping aborts the turn, deletes your message and any partial reply, rejects proposals it made, and puts your text (and photo) back in the input, so you continue from the same place. Stopping the first message of a new chat removes that chat.

### Changed
- **Replies no longer depend on the page staying open.** Sending only starts the assistant's turn (opencode `prompt_async`); it runs and is saved on the server even if you switch pages, close the tab or lose the connection. Reopening the chat shows the reply, or the thinking dots and Stop while it's still working (the page checks every 2 s). This also removes the ~90 s limit on a turn.
- One running turn per chat: sending, Accept and Reject in that chat wait until it finishes or is stopped.

### Migrations
- `018_agent_attachments.sql`: the `agent_attachments` table (chat photos plus their latest scan).

### Deploy notes
- Needs `OPENAI_API_KEY` (already required for receipt scanning). `git pull` + `docker compose up -d --build`; the migration runs on startup.

---

## 0.12.1 — 2026-09-18 — Assistant replies render as Markdown

### Changed
- Assistant replies are rendered as GitHub-flavored Markdown (`react-markdown` + `remark-gfm`): tables, lists, bold and links show formatted instead of as raw `|`/`**` text. Wide tables scroll sideways inside the bubble on mobile. Raw HTML in replies is not rendered.
- The system prompt tells the model its replies are Markdown and to keep tables to at most 4 columns.

---

## 0.12.0 — 2026-09-18 — Assistant can use a LiteLLM-served model

### Added
- The assistant can run on any model behind a LiteLLM (OpenAI-compatible) server: set `AGENT_MODEL=litellm/<model>`, `LITELLM_BASE_URL` and `LITELLM_API_KEY`. Other `AGENT_MODEL` prefixes (`openai/`, `anthropic/`, `opencode/`) work as before.

### Changed
- A user's assistant config is rewritten whenever it no longer matches the server's settings (not only when its token rotates), so changing `AGENT_MODEL` takes effect on the next message for everyone.

### Deploy notes
- To use LiteLLM, add `AGENT_MODEL=litellm/<model>`, `LITELLM_BASE_URL=https://<host>/v1` and `LITELLM_API_KEY` to `.env`, then `docker compose up -d --build` (compose now passes `LITELLM_API_KEY` to the `opencode` container). The model must support tool calling.

---

## 0.11.4 — 2026-09-17 — Assistant reuses existing categories

### Fixed
- The assistant could create a duplicate category that differed only in case (e.g. "food" next to "Food"). Creating a transaction — from the assistant or the form — now reuses an existing category whose name matches case-insensitively.

### Changed
- When the assistant names a category that doesn't exist, the tool replies with the user's existing categories so it can pick one; a new category is only proposed when the user asks for one, and the proposal marks it "(NEW category)".
- An unknown category id in an assistant update also returns the list of existing categories.

---

## 0.11.3 — 2026-09-17 — Assistant buttons stuck disabled

### Fixed
- After the first message in a chat, Send stayed disabled, and a proposal's Accept/Reject stayed disabled until you switched chats (iPhone and desktop).
- Tapping a suggestion no longer wipes what you had typed.
- If accepting/rejecting fails (e.g. already decided), the cards refresh to their real status.

### Changed
- The assistant page always opens on a new chat (no `?chat=` in the URL). Switching and deleting chats is disabled while a reply is on its way.

---

## 0.11.2 — 2026-09-17 — Assistant: string amounts, stuck chat

### Fixed
- The assistant couldn't propose a transaction when the model sent the amount as text (`"100"`), failing with "expected number, received string". Numeric strings are now accepted for every number in the assistant's tools.
- A slow assistant reply could leave the chat stuck: the send button stayed disabled with no error shown. A failed or timed-out request now shows an error, restores the message and reloads the chat.

### Changed
- opencode requests now time out after 90s instead of 170s, so the page gets an answer before Cloudflare's 100s limit. nginx waits up to 120s on the app instead of the 60s default.

### Deploy notes
- nginx config changed: `docker compose up -d --build` picks it up (or `docker compose restart nginx`).

---

## 0.11.1 — 2026-09-17 — Mobile assistant button fix

### Fixed
- On Transactions (iPhone) the assistant button overlapped the "+" button. They now share one container, stacked with a gap.

### Changed
- The mobile assistant button is gray, so it's distinct from the black "+".

---

## 0.11.0 — 2026-09-17 — Assistant page

### Added
- **Delete chats** — each chat in the chats list has a delete button (click twice to confirm). Deleting only hides the chat: the record and its conversation are kept. Changes it proposed that were still waiting are marked rejected.

### Changed
- **The assistant has its own page, `/assistant`.** On desktop it's an "Assistant" link next to the other pages and looks like them (title + pill header). On mobile it's a round button in the bottom-right, above the "+" on Transactions and in the "+" spot on other pages. The header chat icon and slide-in panel are gone.
- **Chats panel** — the previous-chats dropdown is now a pill in the page header (where filters sit on other pages), with dates and a New chat row.
- **Nicer chat** — suggestion chips on an empty chat, assistant avatar and bubbles, a typing indicator, a rounded auto-growing composer, and restyled proposal cards with a status pill.

### Migrations
- `017_agent_chats_soft_delete.sql` — `agent_chats.deleted_at`.

---

## 0.10.0 — 2026-09-17 — AI assistant

### Added
- **Assistant chat** — a chat button in the header opens a panel (full screen on mobile, side panel on desktop). The agent is opencode, run as a sidecar container. It answers questions about your own transactions, categories, spend and plans, and can propose changes: create/update/delete/verify transactions, add/update/delete products, create/update categories, set plans.
- **Every change needs your approval** — the agent never writes. A proposed change appears as a card with Accept/Reject; only Accept applies it, through the same validation as the normal UI.
- **Locked down** — the agent's only tools are finmon's (served as an MCP endpoint at `/api/agent/mcp`, private, per-user token). No shell, files or web. finmon checks this before every prompt and disables the chat if the config doesn't match.
- Previous chats can be reopened; history is stored by opencode.

### Changed
- Write logic for transactions, products, categories and plans moved to `src/lib/mutations/*`; the server actions are thin wrappers (no behaviour change).

### Fixed
- `deleteTransaction` validates the id.

### Migrations
- `016_agent.sql` — `agent_chats`, `agent_proposals`.

### Deploy notes
- New `opencode` service, `agent` network and `agent-workspaces` / `opencode-data` volumes in `docker-compose.yml`.
- **Required in `.env`:** `OPENCODE_SERVER_PASSWORD` (compose refuses to start without it). Set `AGENT_MODEL` (e.g. free `opencode/big-pickle`; default `openai/gpt-4.1-mini` needs `OPENAI_API_KEY`).
- nginx now returns 404 for `/api/agent/` — restart nginx to pick it up.

---

## 0.9.0 — 2026-09-16 — Transaction text search

### Added
- **Search on `/transactions`** — a small search button in the header opens a text box. It matches store, note, category and the transaction's products (name, brand, type, description, tags), case-insensitive, and combines with the month/category filters and sort. The search lives in the URL (`?q=`) and isn't carried to other pages.

### Deploy notes
- No migration or env changes.

---

## 0.8.0 — 2026-09-16 — Plan carry-over, scan tile, sticky filters

Fixes from in-app bug reports.

### Added
- **Plan carry-over** — an empty current/future month on `/plan` is seeded from the latest earlier month with plans. Months with a saved plan, and past months, are untouched.
- **Sticky filters** — the month/category selection follows the nav between Transactions, Expenditures, Plan and Charts (per browser tab).
- **Expenditures → transactions** — clicking a category opens `/transactions` filtered to it and the same months.

### Changed
- **"Scan receipt" hero tile** at the top of the create form and mobile sheet; a staged photo shows a thumbnail with Change / remove.

### Fixed
- **Implausible scanned dates ignored** — a date over 60 days back or over a day ahead keeps today's date.

### Deploy notes
- No migration or env changes.

---

## 0.7.0 — 2026-08-04 — Bug reports from the header

### Added
- **"Report a bug" button** in the header (right of the user menu, all screen sizes, signed-in only). It opens a small modal with a free-text description; submitting saves the report to the new `bug_reports` table along with the reporter's `user_id`, email and a `created_at` timestamp. The modal auto-closes on success; blank or >5000-character messages are rejected inline. There is no in-app admin view yet — reports are read straight from the DB.

### Migrations
- **`015_bug_reports.sql`** — creates `bug_reports` (`user_id` FK → `"user"` with cascade, denormalized `email`, `message`, `created_at`). Additive only.

### Deploy notes
- `git pull` + `docker compose up -d --build`; the runner applies `015` on the first request. No new env vars.

---

## 0.6.0 — 2026-08-03 — Sort transactions by date added; stop dropping unplanned & uncategorized spend

A sort control on `/transactions`, plus two related fixes so spend stops silently disappearing from the plan/expenditure/chart aggregates: unset plans now count as a 0 budget, and category-less spend gets an "Uncategorized" bucket.

### Added
- **Sort toggle on `/transactions`** (`src/components/SortToggle.tsx`) — a pill next to the filters flips the list between the transaction's own **date** (default) and **date added** (insertion order). Driven by a `?sort=` URL param (default omitted); it composes with the existing month/category filters rather than clearing them. Backed by a `TransactionSort` arg on `getTransactions` — `"added"` orders by `t.id DESC` (the SERIAL `id` doubles as an insertion timestamp, so no new column/migration was needed).
- **Zero-value plans** — a plan amount of `0` ("budget nothing here") can now be saved.

### Changed / Fixed
- **Plan page counts spend against unplanned categories.** Previously, spend in a category with no plan for the month was silently dropped from the month's total and shown as an em-dash. Now a missing (or explicit `0`) plan is treated as a 0 budget: the spend counts toward the total and shows as a negative "left". Applies to both the single-month and multi-month (summary) views.
- **`upsertPlan`** accepts `0` (blank and negative are still rejected: "Amount is required" / "Amount must be zero or more").
- **Uncategorized spend no longer vanishes from aggregates.** A spend transaction with no category (possible since 0.4.0's optional category) was invisible on `/plan`, `/expenditures` and `/charts` because every aggregation inner-joined categories. All four now bucket it under an "Uncategorized" sentinel: the expenditure/series queries `LEFT JOIN` + coalesce it (so `/expenditures` shows an "Uncategorized" row and `/charts` an "Uncategorized" series/slice), and the plan views append a synthetic, read-only "Uncategorized" row (no plan can be attached) whenever such spend exists and no category filter is active. No migration. Chart series are now keyed by **category id** rather than name (`seriesKey` in `src/lib/chartData.ts`), so the sentinel can't merge with a real category a user happened to name "Uncategorized"; `/expenditures` rows key off the id for the same reason.

### Migrations
- **`014_plan_amount_allow_zero.sql`** — relaxes the `plans_amount_check` constraint from `amount > 0` to `amount >= 0`. Applies automatically on startup; no backfill, no data change.

### Deploy notes
- Migration is additive and non-destructive — `git pull` + `docker compose up -d --build`; the runner applies `014` on the first request. No new env vars.

---

## 0.5.2 — 2026-07-09 — Lock the mobile viewport: no zoom on input focus

The mobile UI no longer zooms in when tapping a form field (or via pinch/double-tap) — the page stays pinned to the screen width.

### Changed
- **Viewport** (`src/app/layout.tsx`) — `maximumScale: 1, userScalable: false` added to the `viewport` export. Blocks pinch zoom on Android and iOS's automatic zoom-in on input focus (iOS still allows deliberate pinch zoom as an accessibility override).
- **Form controls** (`globals.css`) — `input`/`select`/`textarea` are forced to 16px below the `md:` breakpoint, removing the trigger for iOS focus-zoom (any focused control under 16px) even where viewport hints are ignored. Mobile field text renders slightly larger than the surrounding `text-sm` labels as a result.

### Deploy notes
- No migration, no new env vars — `git pull` + `docker compose up -d --build`.

---

## 0.5.1 — 2026-07-09 — Drop the check-wide discount: the scanned total is final

0.5.0's check-wide discount double-counted in practice: receipts print a **final** grand total with every discount already reflected (and final line costs), so netting `receipts.discount` off the product-cost sum broke the `ready_to_verify` match on exactly the receipts it was meant to help. Discounts are now **per-product only**; the scanned total is treated as the final amount paid, with nothing subtracted from it.

### Changed
- **Scan** no longer extracts a check-wide discount — the top-level `discount` is gone from the response schema, prompt rules, and few-shot examples (a stray one from the model is ignored). The prompt now stresses that `total` is the final paid figure.
- **Status recompute** compares the plain product-cost sum against the effective amount — no discount netting on either side.
- **Modal** — the "Receipt discount" detail row and the `Total: X − Y discount = Z` netting in the products total line are gone; per-product discounts still show under their line's cost.
- **`receipts.discount`** is now **dormant**: nothing writes or reads it. The column is deliberately kept in the schema (no drop migration) in case a check-wide discount comes back later; values written by 0.5.0 scans linger but are ignored.

### Deploy notes
- No migration, no new env vars — `git pull` + `docker compose up -d --build`. Transactions knocked out of `ready_to_verify` by a 0.5.0-scanned check-wide discount fix themselves on the next product edit or re-scan (the recompute runs then).

---

## 0.5.0 — 2026-07-09 — Receipt discounts: per-product and check-wide

The receipt scan now reads **discounts**: each line item can carry its own discount, and the check as a whole can carry a general one (loyalty card, coupon). Semantics: a product's `cost` is always the **final amount paid** for that line (its discount is informational, already baked in), while a check-wide discount is money the line items *don't* account for — so `sum(costs) − general discount ≈ total`, and the status recompute subtracts it.

### Added
- **`products.discount`** (migration 013) — the money taken off that specific line, scanned or entered manually (new Discount field in the product editor; shown under the cost in the products list).
- **`receipts.discount`** (migration 013) — the check-wide discount as read by the scan. Reset to `NULL` with `total` when a new image is stored, filled on a successful scan. Exposed as `Transaction.scanned_discount` and shown as a "Receipt discount" detail row and in the modal's total line (`Total: X − Y discount = Z`).
- **Scan schema** — `discount` added per product and at the receipt level (strict response schema, zod parse, prompt rules, and few-shot examples demonstrating both kinds).

### Changed
- **Status recompute** nets the check-wide `receipts.discount` off the product-cost sum before comparing against the effective amount (the modal's total line mirrors the same maths).

### Migrations
- **013** — add `products.discount` and `receipts.discount`.

### Deploy notes
- No new env vars — `git pull` + `docker compose up -d --build` applies migration 013 on startup. Receipts scanned before 0.5.0 have no discounts until re-scanned.

---

## 0.4.0 — 2026-07-09 — Scan-first transactions: optional amount & category, scanned receipt total

A transaction can now be created from a **receipt photo alone** — amount and category are optional, and the scan fills in what the user left blank. The receipt's printed grand total is stored and used as the fallback amount everywhere until a manual amount exists.

### Added
- **`receipts.total`** (migration 012) — the grand total as read by the scan. Reset to `NULL` whenever a new image is stored, filled on a successful scan. Exposed as `Transaction.scanned_total` (`getTransactions`).
- **Scan fills blank fields** — the vision call now also returns a purchase `date` and a best-fit `category` (constrained to the user's own category names — rendered into the prompt *and* enforced as a response-schema enum — with a lazily-created `other` fallback). After a scan, a blank category/store is filled in, and a still-default (today) date is replaced by the receipt's date. A manually entered amount is **never** overwritten.
- **Verification mismatch guard** — a manual amount that disagrees with the scanned total (≥ ±1) blocks `ready_to_verify`; the modal shows an amber explanation. Verifying a transaction with no manual amount adopts the scanned total, so a verified row always has an amount.
- **Tests** — optional amount/category rules in `createTransaction`/`updateTransaction`, and direct `recomputeTransactionStatus` coverage (effective-amount fallback, mismatch, nothing-to-match) — suite now 252 tests + 1 todo.

### Changed
- **`transactions.amount` and `transactions.category_id` are nullable** (migration 012). App-enforced rule on create and edit: at least one of {amount, category, receipt}. The create form/sheet dropped the `required` attributes in favour of a shared client-side guard mirroring the server error.
- **Status recompute** matches product costs against the *effective* amount — the manual amount, else the scanned total.
- **Spend aggregations** (`/plan`, `/expenditures`, `/charts`) count a scan-only transaction at `COALESCE(t.amount, r.total)`; the transactions list shows the scanned total as the amount fallback, an amber "No amount" pill with neither, and "Uncategorized" for a missing category.

### Migrations
- **012** — drop `NOT NULL` on `transactions.amount` / `transactions.category_id`; add `receipts.total`.

### Deploy notes
- No new env vars or compose changes — `git pull` + `docker compose up -d --build` applies migration 012 on startup. Receipts scanned before 0.4.0 have no stored `total` until re-scanned.

---

## 0.3.0 — 2026-07-08 — Receipt photo storage

Uploaded receipt photos are now **kept**, not just scanned and discarded. Each scanned transaction stores its (client-downscaled, ~100–300 KB) receipt image and can show it again later.

### Added
- **`receipts` table** (migration 011) — one stored image per transaction (`BYTEA` + content type), written by the scan action via upsert *before* the vision call, so the photo survives a failed scan and a re-scan replaces it. Stored in Postgres deliberately: images ride along in the existing DB backup/snapshot workflow instead of needing a separate file-storage backup.
- **`/api/receipts/[id]` route handler** — streams the stored image, session-checked (401) and tenant-scoped (404 for missing/foreign ids), `Cache-Control: private, no-store`.
- **"View receipt" link** in the products modal's scanner box whenever the transaction has a stored receipt (`Transaction.receipt_id`, LEFT JOINed by `getTransactions`).
- **Tests** — receipt persistence in the scan action, the new query, the route handler's auth/404/streaming branches, and the modal link (suite now 232 tests + 1 todo).

### Migrations
- **011** — `receipts` table.

### Deploy notes
- No new env vars or compose changes — `git pull` + `docker compose up -d --build` applies migration 011 on startup. Expect the DB (and its backups) to grow by roughly the size of the stored receipt JPEGs.

---

## 0.2.0 — 2026-06-30 — AI receipt scanning & product line items

Transactions are now made up of **product line items**, and a receipt photo can fill them in automatically with a single OpenAI vision call. Status moves through a `processing → unverified → ready_to_verify → verified` workflow driven by whether the line items add up.

### Added
- **Products** — each transaction can hold one or more line items (`name` mandatory; optional `brand`, `cost`, `product_type`, `tags`, `description`, `price`, `amount`, `unit`). Cost lives on the line item, not a shared catalog. Managed through a new `ProductsModal` (add/edit/delete) and exposed via `src/actions/products.ts` + `src/db/queries.ts`. `transaction.amount` stays authoritative — products are an optional breakdown.
- **AI receipt scanning** — upload a receipt photo on the create form (or hit Scan in the products modal) and an OpenAI vision call parses its line items into products under the hood (`src/lib/receipt-scan.ts` → `src/actions/receipt.ts`). The HTTP call is bounded by a 60 s timeout so a hung request can't strand a row in `processing`. Full design in `AI_SCAN.md`.
- **Status workflow** — `processing` | `unverified` | `ready_to_verify` | `verified`. Status is recomputed automatically: when product costs sum to `amount` the row becomes `ready_to_verify`, otherwise `unverified`. The `ready_to_verify → verified` step is user-driven — the row's `StatusBadge` is itself the verify control (no separate Verify button). Rows self-heal out of a stuck `processing` state by polling `router.refresh()`.
- **Tunable scan prompt** — the vision system prompt is composed at runtime from checked-in config (`src/lib/receipt-prompt.md`, `receipt-units.json`, `receipt-examples.json`), so it can be tuned without code changes.
- **Seed data** — `scripts/seed.mjs` now seeds stores, product line items, and status.
- **Tests** — full coverage for products, receipt actions, the scan library, and the products modal (suite now ~219 tests).

### Changed
- Transaction row and create/edit UI reworked around products and the status tag.
- Status is now recomputed when a transaction's `amount` is edited manually, not just when products change.
- Cost-matching for the `ready_to_verify` transition loosened to tolerate rounding.

### Migrations
- **007** — `products` table (backfilled existing rows with a single `other` product; new transactions start empty).
- **008** — product `price`, `amount`, `unit` columns.
- **009** — transaction `status` column.
- **010** — transaction `store` column.

Migrations run automatically on boot (`migrate()` in `src/instrumentation-node.ts`).

### Deploy notes
- Set **`OPENAI_API_KEY`** in the server `.env` to enable scanning (`OPENAI_MODEL` optional, default `gpt-4o-mini`). Without it, scanning returns a friendly error and everything else works unchanged. See `DEPLOY.md` and `.env.production.example`.
- No other server changes required — `git pull` + `docker compose up -d --build` applies migrations 007–010 on startup.

---

## 0.1.0 — initial

Baseline finmon: categories, transactions, monthly plans, expenditures and charts pages, email/password auth with per-user multi-tenancy, and the initial DigitalOcean / Docker Compose deployment. Predates this changelog; see git history for detail.
