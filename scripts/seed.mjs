import pg from "pg";

const SEED_INIT = 0xc0ffee;

const CATEGORIES = [
  { name: "Salary",        priority: 10, type: "income", min: 4500, max: 5500, freq: 0 },
  { name: "Rent",          priority: 10, type: "spend",  min: 1400, max: 1600, freq: 0 },
  { name: "Groceries",     priority: 9,  type: "spend",  min: 15,   max: 90,   freq: 5 },
  { name: "Utilities",     priority: 8,  type: "spend",  min: 40,   max: 180,  freq: 1 },
  { name: "Healthcare",    priority: 8,  type: "spend",  min: 20,   max: 300,  freq: 1 },
  { name: "Transport",     priority: 6,  type: "spend",  min: 5,    max: 40,   freq: 4 },
  { name: "Eating Out",    priority: 4,  type: "spend",  min: 12,   max: 75,   freq: 3 },
  { name: "Entertainment", priority: 3,  type: "spend",  min: 8,    max: 120,  freq: 2 },
];

const PLAN_AMOUNTS = {
  Rent: 1500,
  Groceries: 600,
  Utilities: 200,
  Healthcare: 150,
  Transport: 250,
  "Eating Out": 300,
  Entertainment: 200,
};

const NOTES = {
  Salary: ["Monthly salary"],
  Rent: ["Monthly rent"],
  Groceries: ["weekly shop", "corner store", "produce", "supermarket"],
  Utilities: ["electric", "gas", "internet", "water"],
  Healthcare: ["pharmacy", "clinic visit", "prescription"],
  Transport: ["bus", "fuel", "metro", "taxi", "parking"],
  "Eating Out": ["lunch", "coffee", "dinner with friends", "takeaway"],
  Entertainment: ["movie", "books", "streaming", "concert"],
};

const DAILY_COUNT_WEIGHTS = [1, 3, 4, 3, 2, 1]; // counts 0..5, biased toward 1-3

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

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randAmount(rng, min, max) {
  return Math.round((min + rng() * (max - min)) * 100) / 100;
}

function pickWeighted(rng, items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function formatMonth(d) {
  return d.toISOString().slice(0, 7);
}

function* eachDay(start, end) {
  const d = new Date(start);
  d.setUTCHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setUTCHours(0, 0, 0, 0);
  while (d <= last) {
    yield new Date(d);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

function generateDayTransactions(rng, date, idByName) {
  const rows = [];
  const dateStr = formatDate(date);

  if (date.getUTCDate() === 1) {
    rows.push({
      amount: randAmount(rng, 4500, 5500),
      type: "income",
      category_id: idByName.get("Salary"),
      date: dateStr,
      note: "Monthly salary",
    });
    rows.push({
      amount: randAmount(rng, 1400, 1600),
      type: "spend",
      category_id: idByName.get("Rent"),
      date: dateStr,
      note: "Monthly rent",
    });
  }

  const count = pickWeighted(rng, [0, 1, 2, 3, 4, 5], DAILY_COUNT_WEIGHTS);
  const spendCats = CATEGORIES.filter((c) => c.freq > 0);
  const weights = spendCats.map((c) => c.freq);

  for (let i = 0; i < count; i++) {
    const cat = pickWeighted(rng, spendCats, weights);
    const pool = NOTES[cat.name] ?? [];
    const note = rng() < 0.6 && pool.length > 0
      ? pool[Math.floor(rng() * pool.length)]
      : null;
    rows.push({
      amount: randAmount(rng, cat.min, cat.max),
      type: cat.type,
      category_id: idByName.get(cat.name),
      date: dateStr,
      note,
    });
  }

  return rows;
}

async function bulkInsert(client, table, columns, rows) {
  if (rows.length === 0) return;
  const placeholders = rows
    .map((_, ri) => `(${columns.map((_, ci) => `$${ri * columns.length + ci + 1}`).join(", ")})`)
    .join(", ");
  const values = rows.flatMap((r) => columns.map((c) => r[c]));
  await client.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`,
    values
  );
}

// Give every owner transaction lacking products a default 'other' product whose
// cost mirrors the amount — mirrors migration 007's backfill and createTransaction's
// default, so seeded data matches what the app produces. Idempotent via NOT EXISTS.
async function backfillOtherProducts(db, ownerUserId) {
  await db.query(
    `INSERT INTO products (transaction_id, user_id, name, cost)
     SELECT t.id, t.user_id, 'other', t.amount
     FROM transactions t
     WHERE t.user_id = $1
       AND NOT EXISTS (SELECT 1 FROM products p WHERE p.transaction_id = t.id)`,
    [ownerUserId]
  );
}

async function runInit(pool) {
  const ownerUserId = process.env.OWNER_USER_ID;
  if (!ownerUserId) {
    console.error("OWNER_USER_ID env var required (matches migration 006).");
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM transactions WHERE user_id = $1", [ownerUserId]);
    await client.query("DELETE FROM plans WHERE user_id = $1", [ownerUserId]);
    await client.query("DELETE FROM categories WHERE user_id = $1", [ownerUserId]);

    const catPlaceholders = CATEGORIES
      .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
      .join(", ");
    const catValues = CATEGORIES.flatMap((c) => [c.name, c.priority, ownerUserId]);
    const { rows: catRows } = await client.query(
      `INSERT INTO categories (name, priority, user_id) VALUES ${catPlaceholders} RETURNING id, name`,
      catValues
    );
    const idByName = new Map(catRows.map((r) => [r.name, r.id]));

    const rng = mulberry32(SEED_INIT);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 90);

    const transactions = [];
    for (const day of eachDay(start, today)) {
      transactions.push(
        ...generateDayTransactions(rng, day, idByName).map((r) => ({ ...r, user_id: ownerUserId })),
      );
    }

    const planRows = [];
    const monthsSeen = new Set();
    for (let i = 0; i <= 2; i++) {
      const d = new Date(today);
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - i);
      monthsSeen.add(formatMonth(d));
    }
    for (const month of monthsSeen) {
      for (const cat of CATEGORIES) {
        if (cat.type !== "spend") continue;
        const amount = PLAN_AMOUNTS[cat.name];
        if (amount == null) continue;
        planRows.push({ category_id: idByName.get(cat.name), month, amount, user_id: ownerUserId });
      }
    }

    await bulkInsert(
      client,
      "transactions",
      ["amount", "type", "category_id", "date", "note", "user_id"],
      transactions
    );
    await bulkInsert(client, "plans", ["category_id", "month", "amount", "user_id"], planRows);
    await backfillOtherProducts(client, ownerUserId);

    await client.query("COMMIT");
    console.log(
      `Seeded: ${CATEGORIES.length} categories, ${transactions.length} transactions, ${planRows.length} plans.`
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function runMonth(pool, monthArg) {
  const n = parseInt(monthArg, 10);
  if (Number.isNaN(n) || n < 1 || n > 12) {
    console.error("Usage: npm run db:seed:month -- <1-12>");
    process.exit(1);
  }

  const ownerUserId = process.env.OWNER_USER_ID;
  if (!ownerUserId) {
    console.error("OWNER_USER_ID env var required.");
    process.exit(1);
  }

  const { rows: catRows } = await pool.query(
    "SELECT id, name FROM categories WHERE user_id = $1",
    [ownerUserId]
  );
  if (catRows.length === 0) {
    console.error("No categories found. Run 'npm run db:seed:init' first.");
    process.exit(1);
  }
  const idByName = new Map(catRows.map((r) => [r.name, r.id]));

  for (const c of CATEGORIES) {
    if (!idByName.has(c.name)) {
      console.error(
        `Category '${c.name}' missing in DB. Run 'npm run db:seed:init' to align categories.`
      );
      process.exit(1);
    }
  }

  const rng = mulberry32(n * 1000003);
  const year = new Date().getUTCFullYear();
  const lastDay = new Date(Date.UTC(year, n, 0)).getUTCDate();

  const transactions = [];
  for (let day = 1; day <= lastDay; day++) {
    const d = new Date(Date.UTC(year, n - 1, day));
    transactions.push(
      ...generateDayTransactions(rng, d, idByName).map((r) => ({ ...r, user_id: ownerUserId })),
    );
  }

  await bulkInsert(
    pool,
    "transactions",
    ["amount", "type", "category_id", "date", "note", "user_id"],
    transactions
  );
  await backfillOtherProducts(pool, ownerUserId);

  const mm = String(n).padStart(2, "0");
  console.log(
    `Appended ${transactions.length} transactions to ${year}-${mm}. Re-running this command will append duplicates.`
  );
}

async function main() {
  const sub = process.argv[2];
  const pool = new pg.Pool({
    host: process.env.SQL_DB_HOST,
    port: Number(process.env.SQL_DB_PORT),
    database: process.env.SQL_DB_NAME,
    user: process.env.SQL_DB_USER,
    password: process.env.SQL_DB_PASSWORD,
    ssl: process.env.SQL_DB_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  try {
    if (sub === "init") {
      await runInit(pool);
    } else if (sub === "month") {
      await runMonth(pool, process.argv[3]);
    } else {
      console.error("Usage: node scripts/seed.mjs <init|month [1-12]>");
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

await main();
