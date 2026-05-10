import type { Category } from "@/actions/categories";
import type { ExpenditureSeriesRow } from "@/db/queries";

export type SeriesPoint = { bucket: string } & Record<string, string | number>;

export function pivotForRecharts(
  buckets: string[],
  categories: Category[],
  rows: ExpenditureSeriesRow[],
): SeriesPoint[] {
  const valueByCatBucket = new Map<number, Map<string, number>>();
  for (const c of categories) valueByCatBucket.set(c.id, new Map());
  for (const r of rows) {
    const m = valueByCatBucket.get(r.category_id);
    if (!m) continue;
    m.set(r.bucket, Number(r.total));
  }

  return buckets.map((b) => {
    const point: SeriesPoint = { bucket: b };
    for (const c of categories) {
      const v = valueByCatBucket.get(c.id)?.get(b) ?? 0;
      point[c.name] = v;
    }
    return point;
  });
}

export function monthTransitionBuckets(buckets: string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i].slice(0, 7) !== buckets[i - 1].slice(0, 7)) {
      out.push(buckets[i]);
    }
  }
  return out;
}
