import pg from "pg";

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
