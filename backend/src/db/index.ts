import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://seq_user:seq_pass@localhost:5432/seq_logs",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

export async function query(text: string, params?: unknown[]) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 500) {
    console.warn("Slow query detected", { text, duration, rows: res.rowCount });
  }
  return res;
}
