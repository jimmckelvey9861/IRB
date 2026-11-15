import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction; services accept either. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

const globalForDb = globalThis as unknown as { irbPool?: Pool };

export function createDb(url: string): { db: DB; pool: Pool } {
  const pool = new Pool({ connectionString: url, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}

function defaultUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://irb@localhost:5433/irb";
}

const pool = globalForDb.irbPool ?? new Pool({ connectionString: defaultUrl(), max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.irbPool = pool;

export const db: DB = drizzle(pool, { schema });
export { schema };
