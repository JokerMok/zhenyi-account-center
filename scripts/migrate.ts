import { pool, tx } from "../src/server/db";
import { readdir, readFile } from "node:fs/promises";
export async function migrate() {
  await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(53105310)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
    );
    for (const name of (await readdir("migrations"))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      if (
        (
          await db.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rowCount
      )
        continue;
      await db.query(await readFile("migrations/" + name, "utf8"));
      await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      console.log("已应用迁移", name);
    }
  });
}
if (process.argv[1]?.endsWith("migrate.ts")) {
  await migrate();
  await pool.end();
}
