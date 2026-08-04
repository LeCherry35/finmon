/** Spend on transactions with no category is bucketed under this sentinel so it
 *  still lands in every aggregate instead of vanishing (`category_id` became
 *  nullable in migration 012). Real category ids are SERIAL (≥ 1), so 0 is a
 *  safe stand-in; the aggregation queries in `src/db/queries.ts` emit it with
 *  name "Uncategorized".
 *
 *  These live here rather than in `queries.ts` deliberately: `PlanRow` is a
 *  client component and needs the id at runtime, and a *value* import from
 *  `@/db/queries` would pull `src/db/index.ts` — and with it `pg` — into the
 *  browser bundle. (Type-only imports from `queries.ts` are erased and stay
 *  fine.) Keep this module free of server-only imports. */
export const UNCATEGORIZED_ID = 0;
export const UNCATEGORIZED_NAME = "Uncategorized";
