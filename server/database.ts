import { PGlite } from "@electric-sql/pglite";
import { Pool, types } from "pg";

export type Queries = {
  query<T = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
};
export type Database = Queries & {
  exec(sql: string): Promise<unknown>;
  transaction<T>(action: (transaction: Queries) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export async function openDatabase(dataDir?: string, databaseUrl?: string): Promise<Database> {
  if (!databaseUrl) {
    const database = new PGlite(dataDir);
    return {
      query: (sql, parameters) => database.query(sql, parameters),
      exec: (sql) => database.exec(sql),
      transaction: (action) => database.transaction(action),
      close: () => database.close(),
    };
  }
  // Millisecond timestamps and counts have the same numeric representation as PGlite.
  types.setTypeParser(20, Number);
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 });
  // An idle connection failure must not crash the HTTP process; the next query reconnects.
  pool.on("error", () => console.error("PostgreSQL connection interrupted"));
  const query: Queries["query"] = async (sql, parameters) => {
    const result = await pool.query(sql, parameters);
    return { rows: result.rows };
  };
  await query("SELECT 1");
  return {
    query,
    exec: (sql) => pool.query(sql),
    async transaction(action) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await action({ query: async (sql, parameters) => ({ rows: (await client.query(sql, parameters)).rows }) });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
