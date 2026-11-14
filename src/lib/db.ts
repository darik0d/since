import fs from "node:fs";
import pg from "pg";

// Aiven PostgreSQL (or any Postgres) via DATABASE_URL.
// Timestamps come back as ISO strings and bigints as numbers, so callers get plain JSON-able rows.
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz
pg.types.setTypeParser(20, (v) => Number(v)); // int8 / bigserial ids, COUNT(*)

declare global {
  // eslint-disable-next-line no-var
  var __sincePool: pg.Pool | undefined;
}

function sslConfig(sslmode: string | null): pg.PoolConfig["ssl"] {
  if (!sslmode || sslmode === "disable") return false;
  // Aiven: pass the project CA (Service page -> "CA certificate") as DATABASE_CA_CERT for full verification.
  const ca = process.env.DATABASE_CA_CERT || (process.env.DATABASE_CA_FILE && fs.readFileSync(process.env.DATABASE_CA_FILE, "utf8"));
  return ca ? { ca: ca.replace(/\\n/g, "\n"), rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export function pool(): pg.Pool {
  if (!globalThis.__sincePool) {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new Error("DATABASE_URL is not set");
    const url = new URL(raw);
    const sslmode = url.searchParams.get("sslmode");
    url.searchParams.delete("sslmode"); // handled explicitly; pg's own parsing would demand a CA for "require"
    globalThis.__sincePool = new pg.Pool({
      connectionString: url.toString(),
      ssl: sslConfig(sslmode),
      max: Number(process.env.DATABASE_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
    });
  }
  return globalThis.__sincePool;
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query(sql, params);
  return res.rows as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(sql, params))[0];
}

export type WebhookEventRow = {
  id: number;
  context_id: string | null;
  delivery_id: string | null;
  attempt: number | null;
  event: string | null;
  monitor_id: string | null;
  signature_ok: boolean;
  signature_note: string | null;
  headers_json: Record<string, string>;
  body_raw: string;
  received_at: string;
  processed_at: string | null;
};
