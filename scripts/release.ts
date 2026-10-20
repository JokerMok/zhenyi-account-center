import { releaseExpired } from "../src/server/entitlements";
import { pool } from "../src/server/db";
console.log(await releaseExpired());
await pool.end();
