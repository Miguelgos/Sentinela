import { httpsGetJson, upsertEvents, saveConfig, deleteOldEvents } from "./sync-core";
import { parseSeqApiEvent, SeqApiEvent } from "./types";

const RETENTION_HOURS = 6;

interface AutoSyncState {
  running: boolean;
  intervalMs: number;
  seqUrl: string;
  signal: string;
  apiKey?: string;
  lastRun: string | null;
  lastImported: number;
  lastTotal: number;
  totalImported: number;
  runs: number;
  error: string | null;
  timer: ReturnType<typeof setInterval> | null;
  newestEventId: string | undefined;
}

const state: AutoSyncState = {
  running: false,
  intervalMs: 60_000,
  seqUrl: "https://seq-prd.ituran.sp",
  signal: "",
  apiKey: undefined,
  lastRun: null,
  lastImported: 0,
  lastTotal: 0,
  totalImported: 0,
  runs: 0,
  error: null,
  timer: null,
  newestEventId: undefined,
};

async function runSync() {
  try {
    const PAGE_SIZE = 1000;
    const baseUrl = state.seqUrl.replace(/\/$/, "");
    const headers: Record<string, string> = {};
    if (state.apiKey) headers["X-Seq-ApiKey"] = state.apiKey;

    let imported = 0;
    let total = 0;
    let afterId: string | undefined;
    let firstEventIdThisRun: string | undefined;

    // On first run, limit to the retention window so we don't re-import all Seq history
    const fromDate = state.newestEventId === undefined
      ? new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString()
      : undefined;

    while (true) {
      let url = `${baseUrl}/api/events/?count=${PAGE_SIZE}&render=true`;
      if (state.signal) url += `&signal=${encodeURIComponent(state.signal)}`;
      if (fromDate && !afterId) url += `&fromDateUtc=${encodeURIComponent(fromDate)}`;
      if (afterId) url += `&afterId=${encodeURIComponent(afterId)}`;

      const { status, data } = await httpsGetJson(url, headers);
      if (status !== 200) break;

      const rawEvents = data as SeqApiEvent[];
      if (rawEvents.length === 0) break;

      // Track the newest event ID (first page, first event)
      if (!firstEventIdThisRun) firstEventIdThisRun = rawEvents[0].Id ?? undefined;

      // Stop when we reach events already seen in a previous run
      if (state.newestEventId) {
        const cutoffIdx = rawEvents.findIndex((e) => e.Id === state.newestEventId);
        if (cutoffIdx !== -1) {
          const newRaw = rawEvents.slice(0, cutoffIdx);
          if (newRaw.length > 0) {
            const events = newRaw.map(parseSeqApiEvent);
            const { imported: imp } = await upsertEvents(events);
            imported += imp;
            total += newRaw.length;
          }
          break;
        }
      }

      const events = rawEvents.map(parseSeqApiEvent);
      const { imported: imp } = await upsertEvents(events);
      imported += imp;
      total += events.length;

      if (events.length < PAGE_SIZE) break;
      afterId = rawEvents[rawEvents.length - 1].Id ?? undefined;
    }

    if (firstEventIdThisRun) state.newestEventId = firstEventIdThisRun;

    state.lastRun = new Date().toISOString();
    state.lastImported = imported;
    state.lastTotal = total;
    state.totalImported += imported;
    state.runs++;
    state.error = null;

    if (imported > 0) {
      await saveConfig(state.seqUrl, state.apiKey, state.signal, imported);
    }

    const deleted = await deleteOldEvents(RETENTION_HOURS);
    if (deleted > 0) console.log(`[auto-sync] retenção: ${deleted} eventos removidos (>${RETENTION_HOURS}h)`);

    console.log(`[auto-sync] run #${state.runs} — ${imported} novos de ${total} recebidos`);
  } catch (err) {
    state.error = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[auto-sync] erro:", state.error);
  }
}

export function startAutoSync(opts?: { seqUrl?: string; signal?: string; apiKey?: string; intervalMs?: number }) {
  if (opts?.seqUrl) state.seqUrl = opts.seqUrl;
  if (opts?.signal !== undefined) state.signal = opts.signal;
  if (opts?.apiKey !== undefined) state.apiKey = opts.apiKey;
  if (opts?.intervalMs) state.intervalMs = opts.intervalMs;

  if (state.timer) clearInterval(state.timer);

  // Reset incremental tracking on restart so first run is always a full pull
  state.newestEventId = undefined;

  runSync();
  state.timer = setInterval(runSync, state.intervalMs);
  state.running = true;
  state.runs = 0;
  state.totalImported = 0;
  console.log(`[auto-sync] iniciado — intervalo ${state.intervalMs / 1000}s, retenção ${RETENTION_HOURS}h`);
}

export function stopAutoSync() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.running = false;
  console.log("[auto-sync] parado");
}

export function getAutoSyncStatus() {
  return {
    running: state.running,
    intervalMs: state.intervalMs,
    seqUrl: state.seqUrl,
    signal: state.signal,
    lastRun: state.lastRun,
    lastImported: state.lastImported,
    lastTotal: state.lastTotal,
    totalImported: state.totalImported,
    runs: state.runs,
    error: state.error,
  };
}
