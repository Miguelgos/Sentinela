// Substitui backend/src/accumulator.ts.
//
// Antes: 100k eventos brutos compactos em memória, 7d, ~400MB.
// Agora: bucketStore (10d × dimensões compactas, ~6MB) + eventStore (2h raw, ~17MB).
// Total ~25MB para Seq (vs 400MB antes).

import { fetchSeq, ParsedEvent } from "../seq";
import type { SeqApiEvent } from "../types";
import { BucketStore, tsToMinute } from "../timeseries/bucketStore";
import { EventStore } from "../timeseries/eventStore";
import { REFERENCE_WINDOW_DAYS, EVENT_STORE_WINDOW_MIN } from "../timeseries/types";

// Mantém só o subset de raw_data lido pelos consumidores (Properties via prop()),
// igual ao accumulator antigo. Reduz ~19KB → ~4KB por evento.
type CompactRaw = { Properties: SeqApiEvent["Properties"] };
export type StoredEvent = Omit<ParsedEvent, "raw_data"> & { raw_data: CompactRaw };

function compactEvent(p: ParsedEvent): StoredEvent {
  const raw = p.raw_data as SeqApiEvent;
  return { ...p, raw_data: { Properties: raw.Properties ?? [] } };
}

const LEVEL_FILTER = "@Level in ['Warning', 'Error', 'Fatal']";

const NOISE_SOURCES = new Set([
  "IdentityServer4.AccessTokenValidation.IdentityServerAuthenticationHandler",
  "Microsoft.AspNetCore.HttpOverrides.ForwardedHeadersMiddleware",
  "System.Net.Http.HttpClient.Default.LogicalHandler",
  "System.Net.Http.HttpClient.Default.ClientHandler",
  "Microsoft.AspNetCore.Routing.EndpointMiddleware",
  "Microsoft.AspNetCore.Routing.EndpointRoutingMiddleware",
  "Microsoft.AspNetCore.Hosting.Diagnostics",
]);

const ERROR_LEVELS = new Set(["Error", "Critical", "Fatal"]);
const AUTH_FAIL_PATTERN = /erro\s+autentica|autentic.*fal|invalid_grant|unauthorized/i;
const MESSAGE_PREFIX_LEN = 80;

function shouldStore(e: ParsedEvent): boolean {
  if (e.level === "Error" || e.level === "Critical") return true;
  if (e.source_context && NOISE_SOURCES.has(e.source_context)) return false;
  return true;
}

function isErrorLevel(e: { level: string }): boolean {
  return ERROR_LEVELS.has(e.level);
}

export function clusterKey(message: string | null | undefined): string | null {
  if (!message) return null;
  return message.slice(0, MESSAGE_PREFIX_LEN).replace(/\d+/g, "#").trim();
}

// Stores singleton — uma instância pra Seq, exposta via getters pra detectores.
const _bucketStore = new BucketStore();
const _eventStore = new EventStore<StoredEvent>();
const _historicalClusters = new Set<string>();

const SEQ_SOURCE = "seq";

let _latestSeqId: string | undefined;

export type SyncPhase = "idle" | "syncing" | "done" | "error";
const _syncProgress: {
  phase: SyncPhase;
  daysDone: number;
  daysTotal: number;
  loaded: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
} = {
  phase: "idle",
  daysDone: 0,
  daysTotal: REFERENCE_WINDOW_DAYS,
  loaded: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

// Gera as dimensões a serem incrementadas para um evento. Detectores filtram
// dimensões por prefixo:
//   service:X         → todos eventos do service (off-hours, total)
//   error_service:X   → erros (error/critical/fatal) por service
//   error_endpoint:Y  → erros por request_path
//   auth_failure      → mensagens com padrão de falha de auth
//   total             → contagem geral
export function dimensionsForEvent(e: StoredEvent): Record<string, number> {
  const out: Record<string, number> = { total: 1 };
  if (e.service) out[`service:${e.service}`] = 1;
  const errLevel = isErrorLevel(e);
  if (errLevel) {
    if (e.service) out[`error_service:${e.service}`] = 1;
    if (e.request_path) out[`error_endpoint:${e.request_path.split("?")[0]}`] = 1;
  }
  if (AUTH_FAIL_PATTERN.test(e.message ?? "")) out.auth_failure = 1;
  return out;
}

function ingest(events: ParsedEvent[], nowMin: number): void {
  if (events.length === 0) return;

  // Agrupa incrementos por (minute, dim) pra fazer um único bumpMany por minuto.
  const byMinute = new Map<number, Record<string, number>>();
  const eventBatch: { eventId: string; event: StoredEvent; timestamp: number }[] = [];

  for (const p of events) {
    if (!p.event_id) continue;
    const stored = compactEvent(p);
    const minute = tsToMinute(p.timestamp);

    // bucketStore — incrementa todas dimensões aplicáveis
    const dims = dimensionsForEvent(stored);
    let acc = byMinute.get(minute);
    if (!acc) {
      acc = {};
      byMinute.set(minute, acc);
    }
    for (const [k, n] of Object.entries(dims)) acc[k] = (acc[k] ?? 0) + n;

    // eventStore — só guarda eventos da janela de 2h (resto é descartado já aqui
    // pra não consumir RAM desnecessariamente durante backfill de 10d)
    if (minute >= nowMin - EVENT_STORE_WINDOW_MIN) {
      eventBatch.push({ eventId: p.event_id, event: stored, timestamp: minute });
    }

    // historicalClusters — cluster de mensagens vistas há mais de 1h
    // (usado por detectNewMessage pra distinguir "novo" de "já existia").
    const cluster = clusterKey(stored.message);
    if (cluster && minute < nowMin - 60) _historicalClusters.add(cluster);
  }

  for (const [minute, dims] of byMinute) {
    _bucketStore.bumpMany(SEQ_SOURCE, minute, dims);
  }
  _eventStore.putMany(SEQ_SOURCE, eventBatch);
}

async function refresh(): Promise<void> {
  const raw = await fetchSeq({
    signal: process.env.SEQ_SIGNAL,
    filter: LEVEL_FILTER,
    maxTotal: 500,
    predicate: shouldStore,
    stopAtId: _latestSeqId,
  });

  if (raw.length === 0) return;

  const nowMin = Math.floor(Date.now() / 60_000);
  ingest(raw, nowMin);
  console.log(`[seqAccumulator] +${raw.length} novos (eventStore: ${_eventStore.size(SEQ_SOURCE)})`);

  if (raw[0]?.event_id) _latestSeqId = raw[0].event_id;

  _bucketStore.rotateTo(SEQ_SOURCE, nowMin);
  _eventStore.pruneToWindow(SEQ_SOURCE, nowMin);
}

async function syncDay(d: number): Promise<ParsedEvent[]> {
  const to = new Date(Date.now() - (d - 1) * 86_400_000);
  const from = new Date(Date.now() - d * 86_400_000);
  try {
    const events = await fetchSeq({
      signal: process.env.SEQ_SIGNAL,
      filter: LEVEL_FILTER,
      fromDate: from,
      toDate: to,
      maxTotal: 50_000,
      predicate: shouldStore,
    });
    console.log(`[seqAccumulator] dia ${d}/${REFERENCE_WINDOW_DAYS}: +${events.length} eventos`);
    return events;
  } catch (err) {
    console.error(`[seqAccumulator] erro no dia ${d}:`, err);
    return [];
  } finally {
    _syncProgress.daysDone++;
  }
}

async function syncFullHistory(): Promise<void> {
  _syncProgress.phase = "syncing";
  _syncProgress.startedAt = new Date().toISOString();
  _syncProgress.daysDone = 0;
  _syncProgress.loaded = 0;
  _syncProgress.error = null;

  console.log(`[seqAccumulator] sync inicial: ${REFERENCE_WINDOW_DAYS} dias`);

  // Sequencial — paralelizar causou OOM no accumulator antigo.
  const nowMin = Math.floor(Date.now() / 60_000);
  for (let d = 1; d <= REFERENCE_WINDOW_DAYS; d++) {
    const events = await syncDay(d);
    if (events.length > 0) {
      ingest(events, nowMin);
      _syncProgress.loaded += events.length;

      // Dia 1 traz os eventos mais recentes — usa pra latestSeqId
      if (d === 1 && !_latestSeqId && events[0]?.event_id) {
        _latestSeqId = events[0].event_id;
      }
    }
  }

  _bucketStore.rotateTo(SEQ_SOURCE, nowMin);
  _eventStore.pruneToWindow(SEQ_SOURCE, nowMin);
  _syncProgress.phase = "done";
  _syncProgress.finishedAt = new Date().toISOString();
  const stats = _bucketStore.getStats(SEQ_SOURCE);
  console.log(`[seqAccumulator] sync completo: ${_syncProgress.loaded} eventos | ${stats.dimensions} dims | eventStore: ${_eventStore.size(SEQ_SOURCE)}`);
}

// Boot não-bloqueante: HTTP server e refresh sobem imediatamente, sync de 10d
// roda em background.
export async function initAccumulator(): Promise<void> {
  setInterval(() => {
    refresh().catch((err) => console.error("[seqAccumulator] erro no refresh:", err));
  }, 60_000);

  syncFullHistory().catch((err) => {
    _syncProgress.phase = "error";
    _syncProgress.error = String(err);
    console.error("[seqAccumulator] erro no sync inicial:", err);
  });
}

// ── API pública (compat com accumulator.ts antigo) ───────────────────────────

export function getEvents(): StoredEvent[] {
  // Antes: ordenado por timestamp desc. Mantém comportamento.
  // eventStore.list já retorna ordenado desc.
  return _eventStore.list(SEQ_SOURCE);
}

export function getEventById(id: string): StoredEvent | undefined {
  return _eventStore.get(SEQ_SOURCE, id);
}

export function isReady(): boolean {
  return _syncProgress.phase === "done";
}

export function storeSize(): number {
  return _eventStore.size(SEQ_SOURCE);
}

export function storeCoverage(): { oldest: string | undefined; newest: string | undefined } {
  // Antes calculava sobre o store completo. Agora só temos 2h em eventStore;
  // mais útil reportar a coverage do bucketStore (10d).
  const events = _eventStore.list(SEQ_SOURCE);
  if (events.length === 0) return { oldest: undefined, newest: undefined };
  return {
    oldest: events[events.length - 1].timestamp,
    newest: events[0].timestamp,
  };
}

export function getSyncProgress() {
  return { ..._syncProgress };
}

// ── API nova: expõe stores para detectores Davis ──────────────────────────────

export function getBucketStore(): BucketStore {
  return _bucketStore;
}

export function getEventStore(): EventStore<StoredEvent> {
  return _eventStore;
}

export function getHistoricalClusters(): Set<string> {
  return _historicalClusters;
}

export const SEQ = SEQ_SOURCE;
