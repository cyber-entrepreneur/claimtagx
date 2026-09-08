import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export { pg };

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 10);
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
});
export const db = drizzle(pool, { schema });

/** Query surface shared by the pool client and transaction callbacks. */
export type DbSession = Pick<typeof db, "insert" | "update" | "select" | "delete" | "execute">;

export * from "./schema";
