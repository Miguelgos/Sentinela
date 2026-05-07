// eventStore — buffer rolante de eventos brutos por fonte (~últimas 2h).
// Alimenta UI (LogsTable, EventDetail). Detector NÃO depende disso.
//
// Cada (source, eventId) → evento. prune() periódico remove eventos com
// timestamp fora da janela.

import { EVENT_STORE_WINDOW_MIN, MS_PER_MINUTE } from "./types";

interface Slot<T> {
  event: T;
  timestamp: number; // minuto-epoch
}

export class EventStore<T> {
  private readonly _store = new Map<string, Map<string, Slot<T>>>();

  put(source: string, eventId: string, event: T, timestamp: number): void {
    let bySource = this._store.get(source);
    if (!bySource) {
      bySource = new Map();
      this._store.set(source, bySource);
    }
    bySource.set(eventId, { event, timestamp });
  }

  putMany(source: string, items: { eventId: string; event: T; timestamp: number }[]): void {
    if (items.length === 0) return;
    let bySource = this._store.get(source);
    if (!bySource) {
      bySource = new Map();
      this._store.set(source, bySource);
    }
    for (const it of items) bySource.set(it.eventId, { event: it.event, timestamp: it.timestamp });
  }

  get(source: string, eventId: string): T | undefined {
    return this._store.get(source)?.get(eventId)?.event;
  }

  // Lista eventos do source, ordenado timestamp desc (mais recente primeiro).
  // Filtra opcionalmente por minuto mínimo.
  list(source: string, sinceMinute?: number): T[] {
    const bySource = this._store.get(source);
    if (!bySource) return [];
    const out: Slot<T>[] = [];
    for (const slot of bySource.values()) {
      if (sinceMinute === undefined || slot.timestamp >= sinceMinute) out.push(slot);
    }
    out.sort((a, b) => b.timestamp - a.timestamp);
    return out.map(s => s.event);
  }

  size(source: string): number {
    return this._store.get(source)?.size ?? 0;
  }

  // Remove eventos com timestamp < oldestMinuteToKeep. Idempotente.
  prune(source: string, oldestMinuteToKeep: number): number {
    const bySource = this._store.get(source);
    if (!bySource) return 0;
    let removed = 0;
    for (const [id, slot] of bySource) {
      if (slot.timestamp < oldestMinuteToKeep) {
        bySource.delete(id);
        removed++;
      }
    }
    return removed;
  }

  // Conveniência: prune com janela default de 2h relativa ao nowMin.
  pruneToWindow(source: string, nowMin: number): number {
    return this.prune(source, nowMin - EVENT_STORE_WINDOW_MIN);
  }
}

export function tsToMinute(timestamp: string): number {
  return Math.floor(new Date(timestamp).getTime() / MS_PER_MINUTE);
}
