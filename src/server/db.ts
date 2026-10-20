import pg from "pg";
import { config } from "./config";
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 12,
});
export type DB = pg.PoolClient;
export async function tx<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const out = await fn(db);
    await db.query("COMMIT");
    return out;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export class Fault extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  ok: unknown,
  status: number,
  code: string,
  message: string,
): asserts ok {
  if (!ok) throw new Fault(status, code, message);
}
export async function lock(db: DB, key: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
}
