// Tipos compartilhados pelos stores de séries temporais.
// bucketStore alimenta detectores (Davis primitives); eventStore alimenta UI.

export const MS_PER_MINUTE = 60_000;
export const REFERENCE_WINDOW_DAYS = 10;
export const REFERENCE_WINDOW_MIN = REFERENCE_WINDOW_DAYS * 24 * 60; // 14400

// Janela do eventStore — buffer rolante de eventos brutos pra drill-down de UI.
// Detector NÃO depende disso; usa só bucketStore.
export const EVENT_STORE_WINDOW_MIN = 120; // 2h

// Adapter: converte representação interna do bucketStore (Float64Array) em
// TimeSeries (Map<minute, count>) consumível pelos detectores existentes.
// Re-exportado de anomaly.ts pra evitar import cycle.
export interface TimeSeries {
  dimension: string;
  buckets: Map<number, number>;
}
