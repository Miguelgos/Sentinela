import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { ParsedEvent } from "../seq";
import { SeqApiEvent } from "../types";

const DB_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), "data", "events.db");

let _db: Database.Database | null = null;

// ── Noise sources descartadas em níveis não-críticos ─────────────────────────
const NOISE_SOURCES = new Set([
  "IdentityServer4.AccessTokenValidation.IdentityServerAuthenticationHandler",
  "Microsoft.AspNetCore.HttpOverrides.ForwardedHeadersMiddleware",
  "System.Net.Http.HttpClient.Default.LogicalHandler",
  "System.Net.Http.HttpClient.Default.ClientHandler",
  "Microsoft.AspNetCore.Routing.EndpointMiddleware",
  "Microsoft.AspNetCore.Routing.EndpointRoutingMiddleware",
  "Microsoft.AspNetCore.Hosting.Diagnostics",
]);

// ── Classifica se o evento deve ser guardado ─────────────────────────────────
export function shouldStore(e: ParsedEvent): boolean {
  if (e.level === "Error" || e.level === "Critical") return true;
  if (e.source_context && NOISE_SOURCES.has(e.source_context)) return false;
  return true;
}

// ── Tier A = 90 dias | Tier B = 7 dias ───────────────────────────────────────
export function tierOf(e: ParsedEvent): "A" | "B" {
  if (e.level === "Error" || e.level === "Critical") return "A";
  if (e.message?.includes("Erro autenticação")) return "A";
  if (e.message === "Kong Auth Request") return "A";
  if (e.source_context?.includes("Sales.Backoffice") || e.source_context?.includes("salesbo")) return "A";
  if (e.request_path?.startsWith("/Quote/")) return "A";
  return "B";
}

// ── Setup do banco ────────────────────────────────────────────────────────────
export function getDb(): Database.Database {
  if (!_db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    _db.pragma("cache_size = -32000");

    migrate(_db);

    _db.exec(`
      CREATE TABLE IF NOT EXISTS seq_events (
        event_id       TEXT PRIMARY KEY,
        timestamp      TEXT NOT NULL,
        level          TEXT NOT NULL,
        message        TEXT,
        trace_id       TEXT,
        user_id        TEXT,
        guid_cotacao   TEXT,
        service        TEXT,
        environment    TEXT,
        request_path   TEXT,
        source_context TEXT,
        tier           TEXT NOT NULL DEFAULT 'B'
      );
      CREATE INDEX IF NOT EXISTS idx_ts   ON seq_events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_lvl  ON seq_events(level);
      CREATE INDEX IF NOT EXISTS idx_tier ON seq_events(tier, timestamp DESC);
    `);
  }
  return _db;
}

function migrate(db: Database.Database): void {
  const cols = (db.pragma("table_info(seq_events)") as { name: string }[]).map(c => c.name);
  if (cols.length === 0) return; // tabela ainda não existe

  // Remove raw_data se ainda existir (schema antigo)
  if (cols.includes("raw_data")) {
    console.log("[sqlite] migrando schema: removendo raw_data, adicionando tier…");
    db.exec("ALTER TABLE seq_events DROP COLUMN raw_data");
  }
  // Adiciona tier se não existir
  if (!cols.includes("tier")) {
    db.exec("ALTER TABLE seq_events ADD COLUMN tier TEXT NOT NULL DEFAULT 'B'");
    db.exec("UPDATE seq_events SET tier='A' WHERE level IN ('Error','Critical')");
  }
}

// ── Retenção: tier A = 90 dias, tier B = 7 dias ───────────────────────────────
export function applyRetention(): { deletedA: number; deletedB: number } {
  const db = getDb();
  const cutA = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const cutB = new Date(Date.now() -  7 * 86_400_000).toISOString();
  const rA   = db.prepare("DELETE FROM seq_events WHERE tier='A' AND timestamp < ?").run(cutA);
  const rB   = db.prepare("DELETE FROM seq_events WHERE tier='B' AND timestamp < ?").run(cutB);
  if (rA.changes + rB.changes > 0) {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  return { deletedA: rA.changes, deletedB: rB.changes };
}

// ── Insert em lote (ignora duplicatas) ────────────────────────────────────────
const INSERT_SQL = `
  INSERT OR IGNORE INTO seq_events
    (event_id, timestamp, level, message, trace_id, user_id, guid_cotacao,
     service, environment, request_path, source_context, tier)
  VALUES
    (@event_id, @timestamp, @level, @message, @trace_id, @user_id, @guid_cotacao,
     @service, @environment, @request_path, @source_context, @tier)
`;

export function bulkInsert(events: ParsedEvent[]): number {
  const db   = getDb();
  const stmt = db.prepare(INSERT_SQL);
  const run  = db.transaction((rows: ParsedEvent[]) => {
    let n = 0;
    for (const e of rows) {
      if (!e.event_id || !shouldStore(e)) continue;
      const info = stmt.run({
        event_id:       e.event_id,
        timestamp:      e.timestamp,
        level:          e.level,
        message:        e.message ?? null,
        trace_id:       e.trace_id ?? null,
        user_id:        e.user_id ?? null,
        guid_cotacao:   e.guid_cotacao ?? null,
        service:        e.service ?? null,
        environment:    e.environment ?? null,
        request_path:   e.request_path ?? null,
        source_context: e.source_context ?? null,
        tier:           tierOf(e),
      });
      n += info.changes;
    }
    return n;
  });
  return run(events) as number;
}

// ── Leitura ───────────────────────────────────────────────────────────────────
export function loadAll(): ParsedEvent[] {
  const db   = getDb();
  const rows = db.prepare("SELECT * FROM seq_events ORDER BY timestamp DESC").all() as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

export function countEvents(): number {
  const r = getDb().prepare("SELECT COUNT(*) as n FROM seq_events").get() as { n: number };
  return r.n;
}

export function oldestTimestamp(): string | null {
  const r = getDb().prepare("SELECT MIN(timestamp) as ts FROM seq_events").get() as { ts: string | null };
  return r.ts;
}

function rowToEvent(row: Record<string, unknown>): ParsedEvent {
  return {
    event_id:       row.event_id as string,
    timestamp:      row.timestamp as string,
    level:          row.level as string,
    message:        (row.message as string | null) ?? "",
    trace_id:       row.trace_id as string | null,
    user_id:        row.user_id as string | null,
    guid_cotacao:   row.guid_cotacao as string | null,
    service:        row.service as string | null,
    environment:    row.environment as string | null,
    request_path:   row.request_path as string | null,
    source_context: row.source_context as string | null,
    // raw_data não é guardado no SQLite — Properties vazio para eventos históricos
    raw_data:       {
      Id: row.event_id as string,
      Timestamp: row.timestamp as string,
      Level: row.level as string,
      RenderedMessage: (row.message as string) ?? "",
      Properties: [],
    } as SeqApiEvent,
  };
}
