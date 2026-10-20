import { reconcile } from "../src/server/casdoor";
import { pool } from "../src/server/db";
console.log(await reconcile());
await pool.end();
