# AI receipt scanning

Turn a receipt photo into transaction product line items — one OpenAI vision call.

Code: `src/lib/receipt-scan.ts` (`scanReceipt`) · `src/actions/receipt.ts`
(`scanReceiptForTransaction`).

## Process

1. **Upload** — user picks a photo; the client downscales it to a JPEG `data:` URL
   (not persisted).
2. **Create** — on the create form a staged receipt starts the transaction as
   `processing` and returns its id; the scan then runs in the background (added
   independently). In the products modal the transaction already exists.
3. **Scan** — `scanReceipt` sends the image to OpenAI with the prompt + schema,
   `JSON.parse`s the reply, validates it with `zod`, and maps it to product fields
   (trim strings, keep only positive numbers, drop unnamed items).
4. **Attach** — the action inserts the products and recomputes status:
   `ready_to_verify` if product costs sum to `transaction.amount`, else
   `unverified` (also `unverified` on scan failure — never stuck on `processing`).

`OPENAI_API_KEY` required (`OPENAI_MODEL` optional, default `gpt-4o-mini`).

## Prompt

System message tells the model to extract one object per purchased line item;
skip totals/tax/discounts; read `name`, `cost` (line total), optional
`amount`/`unit`/`price`/`brand`/`product_type`/`description`/`tags`, plus the
`store` and `total`; use `null` for anything it can't read and never invent.

## Schema

Strict `json_schema` structured output → `{ store, total, products[] }`, where each
product is `{ name, brand, cost, product_type, tags, description, price, amount,
unit }` (only `name` required). Mirrors the existing product fields, so items map
straight onto line items. `store`/`total` are context only — `transaction.amount`
stays authoritative.
