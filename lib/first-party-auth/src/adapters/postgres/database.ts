import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * Driver-agnostic Drizzle handle the Postgres adapters operate against.
 *
 * Typed as the base `PgDatabase` (not `NodePgDatabase`/`PostgresJsDatabase`) so
 * the auth package never depends on a specific Postgres driver: the host passes
 * whichever concrete drizzle instance it constructed. Only the core query
 * builder (`select`/`insert`/`update`/`delete`) is used — the relational
 * `db.query.*` API is intentionally avoided so no schema needs to be registered
 * on the drizzle client for these adapters to work.
 */
export type AuthDatabase = PgDatabase<PgQueryResultHKT>;
