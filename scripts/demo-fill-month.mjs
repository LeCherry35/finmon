// Fills one month of the LOCAL demo account (`demo@finmon.local`, built by
// demo-from-backup.mjs) with transactions cloned from its earlier months:
// each day of the target month takes the same day-of-month's transactions
// from a randomly picked donor month, amounts jittered ±15% (products scale
// with their transaction). Stops at today for the current month. Copies the
// latest earlier month's plans if the target month has none.
//
//   node --env-file=.env scripts/demo-fill-month.mjs [YYYY-MM] [--donors=2026-08,2026-09]
//
// Idempotent: the target month's demo transactions are deleted and rebuilt.

import pg from "pg";

const DEMO_EMAIL = "demo@finmon.local";
const SEED = 0xf111;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);
if (!LOCAL_HOSTS.has(process.env.SQL_DB_HOST ?? "")) {
  console.error(`Refusing: SQL_DB_HOST "${process.env.SQL_DB_HOST}" is not local.`);
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--")) ?? thisMonth;
const donors = (args.find((a) => a.startsWith("--donors="))?.split("=")[1] ?? "2026-08,2026-09").split(",");

const [ty, tm] = target.split("-").map(Number);
const daysInMonth = new Date(ty, tm, 0).getDate();
const lastDay = target === thisMonth ? now.getDate() : daysInMonth;

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const jitter = () => 0.85 + rng() * 0.3;
const money = (v, f) => (v == null ? null : Math.round(Number(v) * f * 100) / 100);

const pool = new pg.Pool({
  host: process.env.SQL_DB_HOST,
  port: Number(process.env.SQL_DB_PORT),
  database: process.env.SQL_DB_NAME,
  user: process.env.SQL_DB_USER,
  password: process.env.SQL_DB_PASSWORD,
  ssl: process.env.SQL_DB_SSL === "false" ? false : { rejectUnauthorized: false },
});
const db = await pool.connect();

try {
  const { rows: users } = await db.query(`SELECT id FROM "user" WHERE email = $1`, [DEMO_EMAIL]);
  if (users.length === 0) throw new Error(`No ${DEMO_EMAIL} user — run demo-from-backup.mjs first.`);
  const userId = users[0].id;

  const { rows: srcTx } = await db.query(
    `SELECT * FROM transactions WHERE user_id = $1 AND left(date, 7) = ANY($2)`,
    [userId, donors],
  );
  const { rows: srcProducts } = await db.query(
    `SELECT * FROM products WHERE transaction_id = ANY($1)`,
    [srcTx.map((t) => t.id)],
  );
  const txByMonthDay = Map.groupBy(srcTx, (t) => t.date.slice(0, 7) + "|" + Number(t.date.slice(8)));
  const productsByTx = Map.groupBy(srcProducts, (p) => p.transaction_id);

  await db.query("BEGIN");
  await db.query(`DELETE FROM transactions WHERE user_id = $1 AND left(date, 7) = $2`, [userId, target]);

  let nTx = 0;
  let nProducts = 0;
  for (let day = 1; day <= lastDay; day++) {
    // Only donors that actually reach this day (a partial month doesn't count).
    const candidates = donors.filter((m) => srcTx.some((t) => t.date.slice(0, 7) === m && Number(t.date.slice(8)) >= day));
    if (candidates.length === 0) continue;
    const donor = candidates[Math.floor(rng() * candidates.length)];
    for (const t of txByMonthDay.get(`${donor}|${day}`) ?? []) {
      const f = jitter();
      const { rows } = await db.query(
        `INSERT INTO transactions (amount, type, category_id, date, note, user_id, status, store)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [money(t.amount, f), t.type, t.category_id, `${target}-${pad(day)}`, t.note, userId, t.status, t.store],
      );
      nTx++;
      for (const p of productsByTx.get(t.id) ?? []) {
        await db.query(
          `INSERT INTO products (transaction_id, user_id, name, brand, cost, product_type, tags,
                                 description, price, amount, unit, discount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [rows[0].id, userId, p.name, p.brand, money(p.cost, f), p.product_type, p.tags ?? [],
           p.description, money(p.price, f), p.amount, p.unit, money(p.discount, f)],
        );
        nProducts++;
      }
    }
  }

  const { rowCount: hasPlans } = await db.query(
    `SELECT 1 FROM plans WHERE user_id = $1 AND month = $2 LIMIT 1`,
    [userId, target],
  );
  let nPlans = 0;
  if (!hasPlans) {
    ({ rowCount: nPlans } = await db.query(
      `INSERT INTO plans (category_id, month, amount, user_id)
       SELECT category_id, $2, amount, user_id FROM plans
       WHERE user_id = $1 AND month = (SELECT max(month) FROM plans WHERE user_id = $1 AND month < $2)`,
      [userId, target],
    ));
  }

  await db.query("COMMIT");
  console.log(`${DEMO_EMAIL}: ${target}-01..${pad(lastDay)} from ${donors.join(", ")}`);
  console.log(`  transactions ${nTx}`);
  console.log(`  products     ${nProducts}`);
  console.log(`  plans        ${nPlans} copied`);
} catch (err) {
  await db.query("ROLLBACK").catch(() => {});
  throw err;
} finally {
  db.release();
  await pool.end();
}
