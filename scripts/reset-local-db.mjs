import pg from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);
const host = process.env.SQL_DB_HOST ?? "";
const override = process.argv.includes("--yes-i-mean-it");

if (!LOCAL_HOSTS.has(host) && !override) {
  console.error(
    `Refusing to drop tables: SQL_DB_HOST is "${host}", which is not local.\n` +
      `This script drops ALL auth + app tables (CASCADE). If you really mean to\n` +
      `reset a non-local database, re-run with --yes-i-mean-it.`
  );
  process.exit(1);
}

const pool = new pg.Pool({
  host: process.env.SQL_DB_HOST,
  port: Number(process.env.SQL_DB_PORT),
  database: process.env.SQL_DB_NAME,
  user: process.env.SQL_DB_USER,
  password: process.env.SQL_DB_PASSWORD,
  ssl: process.env.SQL_DB_SSL === "false" ? false : { rejectUnauthorized: false },
});

await pool.query(`
  DROP TABLE IF EXISTS
    transactions, plans, categories,
    "session", "account", "verification", "user",
    _migrations
  CASCADE
`);
console.log("Local DB tables dropped — fresh start.");
await pool.end();
