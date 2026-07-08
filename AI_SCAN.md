# AI receipt scanning

Turn a receipt photo into transaction product line items — one OpenAI vision call.

Code: `src/lib/receipt-scan.ts` (`scanReceipt`) · `src/actions/receipt.ts`
(`scanReceiptForTransaction`).

## Process

1. **Upload** — user picks a photo; the client downscales it to a JPEG `data:` URL.
2. **Create** — on the create form a staged receipt starts the transaction as
   `processing` and returns its id; the scan then runs in the background (added
   independently). In the products modal, pressing Scan first clears the existing
   products and marks the row `processing` (`startReceiptScan` — a new scan
   *replaces* the old products), then runs the scan in the background; a row
   already `processing` can't be re-scanned.
3. **Store** — before the vision call, the action persists the image into the
   `receipts` table (migration 011; upsert on `transaction_id`, so a re-scan
   replaces the stored photo and it survives a failed scan; a store failure is
   logged but never aborts the scan). It's served back by the authed
   `/api/receipts/[id]` route handler, linked as "View receipt" in the products
   modal via `Transaction.receipt_id`.
4. **Scan** — `scanReceipt` sends the image to OpenAI with the composed system
   prompt (see **Prompt** below) + strict schema, `JSON.parse`s the reply,
   validates it with `zod`, and maps it to product fields (trim strings, keep only
   positive numbers, drop unnamed items). The HTTP call
   is bounded by a **60 s `AbortController` timeout** (mapped to a friendly
   "timed out" error) so a hung request can't leave the row stuck `processing`.
5. **Attach** — the action inserts the products and recomputes status:
   `ready_to_verify` if product costs sum to `transaction.amount`, else
   `unverified`. The recompute + `revalidatePath` run in a `finally` that covers
   **every** post-ownership failure path — scan error, timeout, *and a bad/missing
   image* (the image check lives inside the `try`) — so an owned row the create
   flow already marked `processing` is never left stuck there.

On the client, `TransactionRow` also **self-heals**: while a row reads
`processing` it polls `router.refresh()` (every 4 s, torn down the instant the
status changes), so even if the fire-and-forget scan's `revalidatePath` never
reaches this client, the UI catches up to the recovered DB status.

`OPENAI_API_KEY` required (`OPENAI_MODEL` optional, default `gpt-4o-mini`).

## Prompt

The system prompt is composed at runtime (`getSystemPrompt`) from three checked-in
config files, so it can be tuned without touching code:

- `src/lib/receipt-prompt.md` — the rules, with `{{UNITS}}` and `{{EXAMPLES}}`
  placeholders.
- `src/lib/receipt-units.json` — the allowed unit list, injected at `{{UNITS}}`.
- `src/lib/receipt-examples.json` — few-shot examples, rendered into `{{EXAMPLES}}`
  as pretty-printed JSON outputs. Each example's optional `note` is a
  maintainer-only annotation and is **never** sent to the model.

It tells the model to extract three things — the merchant (`store`), the grand
total (`total`), and one `products` object per purchased line item (the grand
total/subtotals/tax/discounts go nowhere near `products`). Per product it reads
`name`, `cost` (line total), and optional `brand`/`product_type`/`amount`/`unit`/
`price`/`tags`. `product_type`, `unit` and `tags` must be **lowercase English**
even on a foreign-language receipt, and `unit` must be one of the allowed units.
It uses `null` for anything it can't read and never invents values. `description`
is **not** extracted — it's typed in manually later.

The `.md` is read from disk, so it's force-included in the `standalone` build via
`outputFileTracingIncludes` in `next.config.ts`; the JSON config is bundled via
import.

## Schema

Strict `json_schema` structured output → `{ store, total, products[] }`, where each
product is `{ name, brand, cost, product_type, tags, price, amount, unit }` (only
`name` required). Mirrors the stored product fields **minus `description`** (which
is manual-only), so items map straight onto line items. `store`/`total` are context
only — `transaction.amount` stays authoritative.
