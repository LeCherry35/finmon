import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(__dirname, "../src/db/schema.sql"), "utf8");

const pool = new pg.Pool({
  host: process.env.SQL_DB_HOST,
  port: Number(process.env.SQL_DB_PORT),
  database: process.env.SQL_DB_NAME,
  user: process.env.SQL_DB_USER,
  password: process.env.SQL_DB_PASSWORD,
});

await pool.query(sql);
await pool.end();
console.log("Schema applied.");
