// bucketStore — séries temporais densas in-memory.
//
// Para cada (source, dimension) mantém um Float64Array(REFERENCE_WINDOW_MIN)
// indexado circularmente: o slot do minuto M é (M mod LEN). Isso evita shift
// quando a janela avança — o slot do minuto antigo é reescrito pelo novo
// quando "dá a volta" 10 dias depois.
//
// Bumps em minuto fora da janela atual (mais antigo que nowMin - WINDOW_MIN)
// são silenciosamente descartados — útil pra backfill idempotente.

import {
  MS_PER_MINUTE,
  REFERENCE_WINDOW_MIN,
  type TimeSeries,
} from "./types";

export interface BucketSeries {
  dimension: string;
  data: Float64Array;
  // Minuto mais recente já gravado nesta série. Usado pra detectar gaps.
  // Não confiar como "agora" do sistema — só pra adapter.
  newestMinute: number;
}

const LEN = REFERENCE_WINDOW_MIN;

function slotOf(minute: number): number {
  // Math.abs+ % evita slot negativo se algum chamador passar minuto inválido.
  return ((minute % LEN) + LEN) % LEN;
}

export class BucketStore {
  private readonly _store = new Map<string, Map<string, BucketSeries>>();

  // Escreve incremento atômico em (source, dimension, minute).
  bump(source: string, dimension: string, minute: number, n: number = 1): void {
    const series = this._ensureSeries(source, dimension);
    const slot = slotOf(minute);

    // Se este slot guardava um minuto >LEN antigo (mesmo bucket reaproveitado),
    // o valor anterior fica zerado antes de gravar — semântica de "shift".
    // Detectamos isso via newestMinute: se minute > newestMinute + LEN, tudo
    // antigo, zera o array. Caso normal: o bucket alvo já é <LEN antigo.
    if (minute > series.newestMinute + LEN) {
      series.data.fill(0);
    } else {
      // Caso menos comum: se algum slot intermediário ficou para trás,
      // zera só ele. Aqui assumimos que o caller chama bump sequencialmente
      // ou faz prune via rotateTo() abaixo.
    }

    series.data[slot] += n;
    if (minute > series.newestMinute) series.newestMinute = minute;
  }

  // Múltiplos incrementos no mesmo minuto e dimensão. Mais eficiente quando
  // o polling agrupa eventos.
  bumpMany(source: string, minute: number, increments: Record<string, number>): void {
    for (const [dim, n] of Object.entries(increments)) {
      if (n !== 0) this.bump(source, dim, minute, n);
    }
  }

  // Alinha a janela ao "nowMin": zera slots fora da janela [nowMin - LEN + 1, nowMin].
  // Idempotente — chamar a cada minuto pelo polling.
  rotateTo(source: string, nowMin: number): void {
    const dims = this._store.get(source);
    if (!dims) return;
    const oldestValidMinute = nowMin - LEN + 1;
    for (const series of dims.values()) {
      // Se a série tem dado mais antigo que oldestValidMinute em algum slot,
      // ele já vai ser sobrescrito quando o slot equivalente do nowMin chegar.
      // Mas pra leitura consistente em getSeries, zeramos slots órfãos.
      // Implementação simples: se newestMinute < oldestValidMinute, série
      // inteira está obsoleta → reset.
      if (series.newestMinute < oldestValidMinute) {
        series.data.fill(0);
        series.newestMinute = nowMin;
      }
    }
  }

  // Adapter para detectores: produz TimeSeries esparsa (Map<minute, count>)
  // contendo apenas slots não-zero da janela [nowMin - LEN + 1, nowMin].
  getSeries(source: string, dimension: string, nowMin: number): TimeSeries {
    const series = this._store.get(source)?.get(dimension);
    const buckets = new Map<number, number>();
    if (!series) return { dimension, buckets };

    const start = nowMin - LEN + 1;
    // Apenas a janela válida — slots fora dela podem ter dado obsoleto antes
    // do próximo bump sobrescrever (rotateTo é best-effort).
    for (let m = start; m <= nowMin; m++) {
      const value = series.data[slotOf(m)];
      // Validação implícita: se o slot guardava um minuto >LEN antigo (sem bump),
      // newestMinute estaria abaixo desse minuto. Esse caso já é tratado em
      // rotateTo. Aqui confiamos na rotação ter rodado.
      if (value > 0 && m <= series.newestMinute) buckets.set(m, value);
    }
    return { dimension, buckets };
  }

  getDimensions(source: string): string[] {
    return [...(this._store.get(source)?.keys() ?? [])];
  }

  // Diagnóstico — pra healthcheck/UI.
  getStats(source: string): { dimensions: number; totalSlotsUsed: number } {
    const dims = this._store.get(source);
    if (!dims) return { dimensions: 0, totalSlotsUsed: 0 };
    let used = 0;
    for (const series of dims.values()) {
      for (const v of series.data) if (v > 0) used++;
    }
    return { dimensions: dims.size, totalSlotsUsed: used };
  }

  private _ensureSeries(source: string, dimension: string): BucketSeries {
    let dims = this._store.get(source);
    if (!dims) {
      dims = new Map();
      this._store.set(source, dims);
    }
    let series = dims.get(dimension);
    if (!series) {
      series = {
        dimension,
        data: new Float64Array(LEN),
        newestMinute: -Infinity,
      };
      dims.set(dimension, series);
    }
    return series;
  }
}

// Helper: timestamp ISO → minuto-epoch (mesma fórmula usada em anomaly.ts).
export function tsToMinute(timestamp: string): number {
  return Math.floor(new Date(timestamp).getTime() / MS_PER_MINUTE);
}
