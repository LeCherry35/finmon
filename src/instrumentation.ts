import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { pool } = await import("@/db");

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
}
