import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { pool } from "@/db";

const OWNER_VARS = ["OWNER_USER_ID", "OWNER_EMAIL", "OWNER_NAME", "OWNER_PASSWORD_HASH"] as const;

export async function migrate() {
  const owner: Record<string, string> = {};
  const present = OWNER_VARS.filter((k) => process.env[k]);
  if (present.length > 0 && present.length !== OWNER_VARS.length) {
    throw new Error(
      `OWNER_* env vars must all be set or all unset. Missing: ${OWNER_VARS.filter((k) => !process.env[k]).join(", ")}`,
    );
  }
  if (present.length === OWNER_VARS.length) {
    for (const k of OWNER_VARS) owner[k.toLowerCase()] = process.env[k]!;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name   TEXT PRIMARY KEY,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query<{ name: string }>("SELECT name FROM _migrations");
  const done = new Set(rows.map((r) => r.name));

  const migrationsDir = resolve(process.cwd(), "src/db/migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, value] of Object.entries(owner)) {
        await client.query("SELECT set_config($1, $2, true)", [`app.${key}`, value]);
      }
      await client.query(readFileSync(resolve(migrationsDir, file), "utf8"));
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`[db] migration applied: ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${err}`);
    } finally {
      client.release();
    }
  }
}
