# TO_FIX

Audit findings, ordered by severity.

---

## Critical — silent corruption or security exposure

_(none)_

---

## High — functional bugs in normal use

_(all resolved)_

---

## Medium — UX / robustness

### Expeditures over time chart allows to select month that are not adjacent.
We need to handle only adjacent months selection.


### No auth, no rate limit
Documented as intentional for single-user use, but if ever exposed past `localhost`, every server action is unauthenticated. Worth a guard if deployment is on the table.

---

## Low / cosmetic

### Date / month columns accept arbitrary strings — DB has no CHECK
Server actions validate `YYYY-MM-DD` / `YYYY-MM` with regex, so today the only writers are guarded. No DB-level constraint as defense-in-depth — a future code path that bypasses validation could silently insert garbage that falls out of `LEFT(date,7) = $month` filters. Fix would be a migration adding `CHECK (date ~ '^\d{4}-\d{2}-\d{2}$')` (and equivalent for `plans.month`).

### `CategoryShare.tsx` Recharts tooltip cast fails strict TS
`src/components/charts/CategoryShare.tsx:53` casts `payload as TooltipItem[] | undefined`, but Recharts v3's `TooltipPayload` is `readonly` — `tsc --noEmit` fails with TS2352. The chart still renders because Next/SWC strips types at build, but CI typecheck is broken. Fix: cast through `unknown` (`payload as unknown as TooltipItem[] | undefined`) or model `TooltipItem[]` as `readonly TooltipItem[]`.

