import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
export type Database = InstanceType<typeof Pool>;

export function createDatabase(connectionString: string): Database {
  return new Pool({ connectionString, max: 10 });
}

export async function migrate(database: Database): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(734902118)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const exists = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (exists.rowCount) continue;
      await client.query(await readFile(path.join(directory, file), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseReady(database: Database): Promise<boolean> {
  try {
    await database.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
