import { Pool, types } from "pg";

// NUMERIC (OID 1700) comes back as string by default — parse to float
types.setTypeParser(1700, parseFloat);

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  return new Pool({
    host: process.env.SQL_DB_HOST,
    port: Number(process.env.SQL_DB_PORT),
    database: process.env.SQL_DB_NAME,
    user: process.env.SQL_DB_USER,
    password: process.env.SQL_DB_PASSWORD,
    ssl: process.env.SQL_DB_SSL === "false" ? false : { rejectUnauthorized: false },
  });
}

export const pool: Pool =
  process.env.NODE_ENV === "production"
    ? createPool()
    : (globalThis.__pgPool ??= createPool());
