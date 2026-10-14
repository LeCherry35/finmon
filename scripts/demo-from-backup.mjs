// Builds an anonymized demo account in the LOCAL database from a prod backup:
// copies one source user's categories / transactions / products / plans into
// a fresh `demo@finmon.local` user. Amounts are jittered ±15% (products scale
// with their transaction, so statuses stay consistent), category names are
// translated, and notes / stores / product names that could identify anyone
// are dropped or neutralized. Receipt photos are not copied.
//
//   node --env-file=.env scripts/demo-from-backup.mjs [dump] [--source-user=root]
//
// Reads the dump with `pg_restore -f -` (no scratch DB needed). Idempotent:
// the demo user is deleted (cascading all its rows) and rebuilt each run.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";

const DEMO_EMAIL = "demo@finmon.local";
const DEMO_PASSWORD = "demo1234";
const DEMO_NAME = "Demo";
const SEED = 0xd3d0;
const DEFAULT_DUMP = "backups/finmon-20260916-220158.dump";
const PG_RESTORE = process.env.PG_RESTORE ?? "C:/Program Files/PostgreSQL/17/bin/pg_restore";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);
if (!LOCAL_HOSTS.has(process.env.SQL_DB_HOST ?? "")) {
  console.error(`Refusing: SQL_DB_HOST "${process.env.SQL_DB_HOST}" is not local.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const dump = args.find((a) => !a.startsWith("--")) ?? DEFAULT_DUMP;
const sourceUser = (args.find((a) => a.startsWith("--source-user=")) ?? "--source-user=root").split("=")[1];

// --- anonymization maps -----------------------------------------------------

const CATEGORY_NAMES = {
  Продукты: "Groceries",
  Транспорт: "Transport",
  Коты: "Pets",
  Одежда: "Clothes",
  Другое: "Misc",
  Рестораны: "Restaurants",
  Программирование: "Software",
  Дом: "Home",
  Надя: "Family",
  Сервисы: "Subscriptions",
  Спорт: "Sport",
  Лего: "Lego",
  Граффити: "Art",
  Шишки: "Leisure",
  other: "other",
};

// Notes kept verbatim; anything else (names, gifts, smoking…) becomes null.
const NOTE_ALLOW = new Set(
  `Зелень Чай Яйца Рынок Интернет Инет Вода Windsurf Claude Штаны Суши Спаржа Корм Комуналка Заправка
   Доставка Штатив Черепаха Фучжу Фойл Тряпка Тел Сухофрукты Стрижка Стенд Рамен Перчатки Переобувка
   Наполнитель Напитки мотошкола Мойка Мобильный Моб Кино Доска джинсы YouTube tcpizza Finmon Cloudflare
   Вейксерф Бенз Балони босоножки`
    .split(/\s+/)
    .map((s) => s.toLowerCase())
    .concat([
      "крепление сцепы", "доставка корма", "термо подштаники", "офис чай", "на шлем", "мото куртка",
      "мойка машины", "зип пакеты", "заправка мото", "заправка байка", "заправка мотыка",
      "замена подшипника, дворник, масло", "доставка шин", "доставка фучжу", "доставка спаржи",
      "вейк серф", "бургер стейкхаус", "smart brick 75421", "lego 744", "claude pro for claude code",
      "регистрация мотыка", "доставка мотыка", "соревы взнос",
    ]),
);

// Stores that are people or otherwise identifying → null.
const STORE_DENY = /ГУТКНЕХТ|ФОП|Женитися|Бабульки|Осама|Амик|Кета|Зенит/i;

// Product line items renamed to something neutral (cost kept so sums hold).
const PRODUCT_SENSITIVE = /табак|сигарет|снуз|смокн|папір різ|пиво|прокл|труси|tobacco|cigarette|beer|underwear|sanitary/i;

// --- dump reading -----------------------------------------------------------

function unescapeCopy(v) {
  if (v === "\\N") return null;
  return v.replace(/\\(.)/g, (_, c) => ({ t: "\t", n: "\n", r: "\r", "\\": "\\" })[c] ?? c);
}

function readTable(table) {
  const out = execFileSync(PG_RESTORE, ["-a", "-t", table, "-f", "-", dump], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  const lines = out.split(/\r?\n/); // pg_restore on Windows emits CRLF
  const start = lines.findIndex((l) => l.startsWith(`COPY public.${table} `));
  if (start < 0) return [];
  const cols = lines[start].match(/\(([^)]*)\)/)[1].split(", ").map((c) => c.replace(/"/g, ""));
  const rows = [];
  for (let i = start + 1; i < lines.length && lines[i] !== "\\."; i++) {
    const vals = lines[i].split("\t").map(unescapeCopy);
    rows.push(Object.fromEntries(cols.map((c, j) => [c, vals[j]])));
  }
  return rows;
}

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
const mine = (rows) => rows.filter((r) => r.user_id === sourceUser);

const src = {
  categories: mine(readTable("categories")),
  transactions: mine(readTable("transactions")),
  products: mine(readTable("products")),
  plans: mine(readTable("plans")),
  receipts: mine(readTable("receipts")),
};
if (src.transactions.length === 0) {
  console.error(`No transactions for source user "${sourceUser}" in ${dump}.`);
  process.exit(1);
}
const receiptTotal = new Map(src.receipts.map((r) => [r.transaction_id, r.total]));

// --- write ------------------------------------------------------------------

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
  await db.query("BEGIN");
  await db.query(`DELETE FROM "user" WHERE email = $1`, [DEMO_EMAIL]);

  const userId = `demo${randomBytes(14).toString("hex")}`;
  await db.query(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)`,
    [userId, DEMO_NAME, DEMO_EMAIL],
  );
  await db.query(
    `INSERT INTO account (id, "accountId", "providerId", "userId", password, "updatedAt")
     VALUES ($1, $2, 'credential', $2, $3, now())`,
    [randomBytes(16).toString("hex"), userId, await hashPassword(DEMO_PASSWORD)],
  );

  const catId = new Map();
  for (const c of src.categories) {
    const name = CATEGORY_NAMES[c.name] ?? `Category ${c.id}`;
    const { rows } = await db.query(
      `INSERT INTO categories (name, priority, user_id, is_default) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, Number(c.priority), userId, c.name === "other"],
    );
    catId.set(c.id, rows[0].id);
  }
  if (!src.categories.some((c) => c.name === "other")) {
    await db.query(
      `INSERT INTO categories (name, priority, user_id, is_default) VALUES ('other', 5, $1, true)`,
      [userId],
    );
  }

  const productsByTx = Map.groupBy(src.products, (p) => p.transaction_id);
  let nProducts = 0;
  for (const t of src.transactions) {
    const f = jitter();
    const amount = money(t.amount ?? receiptTotal.get(t.id), f);
    const note = t.note && NOTE_ALLOW.has(t.note.trim().toLowerCase()) ? t.note.trim() : null;
    const store = t.store && !STORE_DENY.test(t.store) ? t.store : null;
    const { rows } = await db.query(
      `INSERT INTO transactions (amount, type, category_id, date, note, user_id, status, store)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [amount, t.type, catId.get(t.category_id) ?? null, t.date, note, userId,
       t.status === "processing" ? "unverified" : t.status, store],
    );
    for (const p of productsByTx.get(t.id) ?? []) {
      const sensitive = PRODUCT_SENSITIVE.test(`${p.name} ${p.product_type ?? ""}`);
      await db.query(
        `INSERT INTO products (transaction_id, user_id, name, brand, cost, product_type, tags,
                               description, price, amount, unit, discount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          rows[0].id, userId,
          sensitive ? "Misc item" : p.name,
          sensitive ? null : p.brand,
          money(p.cost, f),
          sensitive ? null : p.product_type,
          sensitive || !p.tags ? "{}" : p.tags,
          sensitive ? null : p.description,
          money(p.price, f), p.amount, p.unit, money(p.discount, f),
        ],
      );
      nProducts++;
    }
  }

  const planFactor = new Map();
  for (const p of src.plans) {
    if (!catId.has(p.category_id)) continue;
    if (!planFactor.has(p.category_id)) planFactor.set(p.category_id, jitter());
    await db.query(
      `INSERT INTO plans (category_id, month, amount, user_id) VALUES ($1, $2, $3, $4)`,
      [catId.get(p.category_id), p.month, Math.round(Number(p.amount) * planFactor.get(p.category_id)), userId],
    );
  }

  await db.query("COMMIT");

  const { rows: status } = await db.query(
    `SELECT status, COUNT(*)::int AS n FROM transactions WHERE user_id = $1 GROUP BY 1 ORDER BY 1`,
    [userId],
  );
  console.log(`Demo account ${DEMO_EMAIL} / ${DEMO_PASSWORD} (id ${userId}) from "${sourceUser}" in ${dump}`);
  console.log(`  categories   ${src.categories.length}`);
  console.log(`  transactions ${src.transactions.length}`);
  console.log(`  products     ${nProducts}`);
  console.log(`  plans        ${src.plans.length}`);
  console.log(`  status       ${status.map((s) => `${s.status}=${s.n}`).join(", ")}`);
} catch (err) {
  await db.query("ROLLBACK");
  throw err;
} finally {
  db.release();
  await pool.end();
}
