import { describe, it, expect } from "vitest";
import type { StoredEvent } from "./accumulator";
import {
  buildTimeSeries,
  computeBaseline,
  computeSeasonalBaseline,
  correlateProblems,
  detectAnomalies,
  detectAuthBurst,
  detectErrorRatePerEndpoint,
  detectErrorRatePerService,
  detectNewMessage,
  detectOffHoursVolume,
  detectSeasonalAnomalies,
  percentile,
  seasonalSlot,
  thresholdFor,
  MS_PER_MINUTE,
  REFERENCE_WINDOW_MIN,
  type AnomalyEvent,
  type TimeSeries,
} from "./anomaly";

function ev(overrides: Partial<StoredEvent>): StoredEvent {
  return {
    event_id: "id",
    timestamp: new Date(0).toISOString(),
    message: "",
    level: "Error",
    trace_id: null,
    user_id: null,
    guid_cotacao: null,
    service: null,
    environment: null,
    request_path: null,
    source_context: null,
    raw_data: { Properties: [] },
    ...overrides,
  };
}

function tsAt(min: number): string {
  return new Date(min * MS_PER_MINUTE).toISOString();
}

describe("percentile", () => {
  it("retorna 0 para array vazio", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("retorna o único valor para array de 1", () => {
    expect(percentile([42], 0.99)).toBe(42);
  });

  it("interpola linearmente entre vizinhos", () => {
    const v = [0, 10, 20, 30, 40];
    expect(percentile(v, 0)).toBe(0);
    expect(percentile(v, 1)).toBe(40);
    expect(percentile(v, 0.5)).toBe(20);
    expect(percentile(v, 0.25)).toBe(10);
    expect(percentile(v, 0.75)).toBe(30);
  });

  it("calcula P99 corretamente em série conhecida", () => {
    const v = Array.from({ length: 100 }, (_, i) => i);
    expect(percentile(v, 0.99)).toBeCloseTo(98.01, 1);
  });
});

describe("buildTimeSeries", () => {
  it("bucketiza eventos por minuto e dimensão", () => {
    const events = [
      ev({ timestamp: tsAt(100), service: "a" }),
      ev({ timestamp: tsAt(100), service: "a" }),
      ev({ timestamp: tsAt(101), service: "a" }),
      ev({ timestamp: tsAt(100), service: "b" }),
    ];
    const result = buildTimeSeries(events, (e) => e.service);
    expect(result.size).toBe(2);
    expect(result.get("a")?.buckets.get(100)).toBe(2);
    expect(result.get("a")?.buckets.get(101)).toBe(1);
    expect(result.get("b")?.buckets.get(100)).toBe(1);
  });

  it("descarta eventos cujo extractor retorna null", () => {
    const events = [
      ev({ timestamp: tsAt(100), service: null }),
      ev({ timestamp: tsAt(100), service: "x" }),
    ];
    const result = buildTimeSeries(events, (e) => e.service);
    expect(result.size).toBe(1);
    expect(result.get("x")?.buckets.get(100)).toBe(1);
  });

  it("colapsa eventos do mesmo segundo no mesmo bucket", () => {
    const events = [
      ev({ timestamp: new Date(100 * MS_PER_MINUTE + 1000).toISOString(), service: "a" }),
      ev({ timestamp: new Date(100 * MS_PER_MINUTE + 30_000).toISOString(), service: "a" }),
    ];
    const result = buildTimeSeries(events, (e) => e.service);
    expect(result.get("a")?.buckets.get(100)).toBe(2);
  });
});

describe("computeBaseline", () => {
  it("inclui zeros para minutos sem evento (série esparsa)", () => {
    // 1 evento por dia em 7 dias = janela 10080 min, 7 valores=1, resto=0
    const series: TimeSeries = { dimension: "x", buckets: new Map() };
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    for (let d = 0; d < 7; d++) series.buckets.set(nowMin - 1440 * d - 100, 1);

    const baseline = computeBaseline(series, nowMin);
    // sampleCount = REFERENCE_WINDOW_MIN - 1 (excluído nowMin) - 5 (holdout)
    expect(baseline.sampleCount).toBe(REFERENCE_WINDOW_MIN - 1 - 5);
    expect(baseline.p99).toBeLessThanOrEqual(1);
  });

  it("P99 reflete cauda alta em série constante", () => {
    const series: TimeSeries = { dimension: "x", buckets: new Map() };
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    // todos os minutos da janela = 5
    for (let m = nowMin - REFERENCE_WINDOW_MIN + 1; m < nowMin; m++) {
      series.buckets.set(m, 5);
    }
    const baseline = computeBaseline(series, nowMin);
    expect(baseline.p99).toBe(5);
    expect(baseline.iqr).toBe(0);
  });

  it("não vaza minuto atual no baseline (evita threshold = própria observação)", () => {
    const series: TimeSeries = { dimension: "x", buckets: new Map() };
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    for (let m = nowMin - REFERENCE_WINDOW_MIN + 1; m < nowMin; m++) {
      series.buckets.set(m, 1);
    }
    series.buckets.set(nowMin, 1000);
    const baseline = computeBaseline(series, nowMin);
    expect(baseline.p99).toBe(1);
  });
});

describe("thresholdFor", () => {
  it("retorna baseline + n * IQR", () => {
    const baseline = { dimension: "x", p99: 10, iqr: 4, sampleCount: 10000 };
    expect(thresholdFor(baseline, 3)).toBe(22);
  });

  it("usa fluctuation=1 quando IQR=0 (série constante)", () => {
    const baseline = { dimension: "x", p99: 5, iqr: 0, sampleCount: 10000 };
    expect(thresholdFor(baseline, 3)).toBe(8);
  });
});

describe("detectAnomalies", () => {
  const baselineFor = (p99: number, iqr: number) => ({
    dimension: "x",
    p99,
    iqr,
    sampleCount: 10000,
  });

  function seriesWith(buckets: [number, number][]): TimeSeries {
    return { dimension: "x", buckets: new Map(buckets) };
  }

  it("dispara quando 3 de 5 minutos violam threshold", () => {
    const baseline = baselineFor(2, 1);
    const series = seriesWith([
      [100, 10], [101, 0], [102, 10], [103, 1], [104, 10],
    ]);
    const result = detectAnomalies(series, baseline, 104, { detector: "ERROR_RATE_SERVICE" });
    expect(result).toHaveLength(1);
    expect(result[0].violationsInWindow).toBe(3);
    expect(result[0].metric).toBe(10);
  });

  it("não dispara com 2 violações em 5 minutos", () => {
    const baseline = baselineFor(2, 1);
    const series = seriesWith([
      [100, 10], [101, 0], [102, 0], [103, 10], [104, 0],
    ]);
    expect(detectAnomalies(series, baseline, 104, { detector: "ERROR_RATE_SERVICE" })).toEqual([]);
  });

  it("silencia quando sampleCount < 3 dias", () => {
    const baseline = { dimension: "x", p99: 0, iqr: 0, sampleCount: 100 };
    const series = seriesWith([[100, 999], [101, 999], [102, 999]]);
    expect(detectAnomalies(series, baseline, 102, { detector: "ERROR_RATE_SERVICE" })).toEqual([]);
  });

  it("severidade CRITICAL quando metric ≥ baseline + 6*IQR", () => {
    const baseline = baselineFor(10, 2);
    const series = seriesWith([
      [100, 30], [101, 30], [102, 30],
    ]);
    const result = detectAnomalies(series, baseline, 102, { detector: "ERROR_RATE_SERVICE" });
    expect(result[0].severity).toBe("CRITICAL");
  });

  it("severidade HIGH entre 4*IQR e 6*IQR", () => {
    const baseline = baselineFor(10, 2);
    const series = seriesWith([
      [100, 20], [101, 20], [102, 20],
    ]);
    const result = detectAnomalies(series, baseline, 102, { detector: "ERROR_RATE_SERVICE" });
    expect(result[0].severity).toBe("HIGH");
  });

  it("severidade MEDIUM logo acima do threshold", () => {
    const baseline = baselineFor(10, 2);
    const series = seriesWith([
      [100, 17], [101, 17], [102, 17],
    ]);
    const result = detectAnomalies(series, baseline, 102, { detector: "ERROR_RATE_SERVICE" });
    expect(result[0].severity).toBe("MEDIUM");
  });
});

describe("correlateProblems", () => {
  function anomaly(detector: AnomalyEvent["detector"], dim: string, min: number, severity: AnomalyEvent["severity"] = "MEDIUM"): AnomalyEvent {
    return {
      detector,
      dimension: dim,
      metric: 10,
      baseline: 1,
      threshold: 5,
      violationsInWindow: 3,
      windowSize: 5,
      severity,
      detectedAt: tsAt(min),
      evidence: [],
    };
  }

  it("agrupa anomalias do mesmo (detector,dimension)", () => {
    const a = [
      anomaly("ERROR_RATE_SERVICE", "service:a", 100),
      anomaly("ERROR_RATE_SERVICE", "service:a", 200),
    ];
    const problems = correlateProblems(a);
    expect(problems).toHaveLength(1);
    expect(problems[0].anomalies).toHaveLength(2);
  });

  it("agrupa anomalias dentro de janela ±2 min", () => {
    const a = [
      anomaly("ERROR_RATE_SERVICE", "service:a", 100),
      anomaly("AUTH_BURST", "auth_failures", 101),
    ];
    const problems = correlateProblems(a);
    expect(problems).toHaveLength(1);
    expect(problems[0].anomalies).toHaveLength(2);
  });

  it("não agrupa anomalias distantes no tempo e diferentes", () => {
    const a = [
      anomaly("ERROR_RATE_SERVICE", "service:a", 100),
      anomaly("AUTH_BURST", "auth_failures", 200),
    ];
    const problems = correlateProblems(a);
    expect(problems).toHaveLength(2);
  });

  it("agrupa anomalias em services relacionados via topologia", () => {
    const a = [
      anomaly("ERROR_RATE_SERVICE", "service:customer360", 100, "MEDIUM"),
      anomaly("ERROR_RATE_SERVICE", "service:integra", 500, "HIGH"),
    ];
    const problems = correlateProblems(a);
    // customer360 → integra (relacionados via topologia, mesmo distantes no tempo)
    expect(problems).toHaveLength(1);
    // Causa raiz inferida: o mais upstream
    expect(problems[0].rootDimension).toBe("service:integra");
  });

  it("escolhe service mais upstream em cadeia de 3", () => {
    const a = [
      anomaly("ERROR_RATE_SERVICE", "service:customer360", 100, "MEDIUM"),
      anomaly("ERROR_RATE_SERVICE", "service:integra", 200, "MEDIUM"),
      anomaly("ERROR_RATE_SERVICE", "service:identity", 300, "MEDIUM"),
    ];
    const problems = correlateProblems(a);
    expect(problems).toHaveLength(1);
    expect(problems[0].rootDimension).toBe("service:identity");
  });

  it("não agrupa services sem relação topológica e distantes no tempo", () => {
    // 2 anomalias em services diferentes, sem relação topológica, distantes no tempo.
    // 'unknown' é um service sem deps declaradas — não deve relacionar com salesbo.
    const a = [
      anomaly("ERROR_RATE_SERVICE", "service:salesbo", 100),
      anomaly("ERROR_RATE_SERVICE", "service:unknown", 500),
    ];
    const problems = correlateProblems(a);
    expect(problems).toHaveLength(2);
  });

  it("ordena problemas por severidade desc", () => {
    const a = [
      anomaly("ERROR_RATE_SERVICE", "x", 100, "MEDIUM"),
      anomaly("ERROR_RATE_SERVICE", "y", 500, "CRITICAL"),
      anomaly("ERROR_RATE_SERVICE", "z", 1000, "HIGH"),
    ];
    const problems = correlateProblems(a);
    expect(problems.map(p => p.severity)).toEqual(["CRITICAL", "HIGH", "MEDIUM"]);
  });

  it("severidade do problema = max das anomalias agrupadas", () => {
    const a = [
      anomaly("ERROR_RATE_SERVICE", "service:a", 100, "MEDIUM"),
      anomaly("ERROR_RATE_SERVICE", "service:a", 101, "CRITICAL"),
    ];
    const problems = correlateProblems(a);
    expect(problems[0].severity).toBe("CRITICAL");
  });
});

describe("seasonalSlot", () => {
  it("retorna slot consistente para mesmo (dow,hour)", () => {
    // 2026-05-04 é segunda-feira. UTC 14:00 → slot = 1*24 + 14 = 38
    const ts = Math.floor(Date.UTC(2026, 4, 4, 14, 0, 0) / MS_PER_MINUTE);
    expect(seasonalSlot(ts)).toBe(1 * 24 + 14);
  });

  it("dois minutos no mesmo slot retornam mesmo valor", () => {
    const a = Math.floor(Date.UTC(2026, 4, 4, 14, 5, 0) / MS_PER_MINUTE);
    const b = Math.floor(Date.UTC(2026, 4, 4, 14, 55, 0) / MS_PER_MINUTE);
    expect(seasonalSlot(a)).toBe(seasonalSlot(b));
  });

  it("hora seguinte = slot+1", () => {
    const a = Math.floor(Date.UTC(2026, 4, 4, 14, 0, 0) / MS_PER_MINUTE);
    const b = Math.floor(Date.UTC(2026, 4, 4, 15, 0, 0) / MS_PER_MINUTE);
    expect(seasonalSlot(b)).toBe(seasonalSlot(a) + 1);
  });
});

describe("computeSeasonalBaseline", () => {
  it("calcula slots separados para cada hora-do-dia", () => {
    const series: TimeSeries = { dimension: "x", buckets: new Map() };
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    // Carrega 7d com volume diferente entre madrugada e tarde
    for (let m = nowMin - REFERENCE_WINDOW_MIN + 1; m < nowMin; m++) {
      const slot = seasonalSlot(m);
      const hour = slot % 24;
      // madrugada: 0 eventos. tarde (12-18): 10 eventos.
      series.buckets.set(m, hour >= 12 && hour < 18 ? 10 : 0);
    }
    const baseline = computeSeasonalBaseline(series, nowMin);
    const morningSlot = baseline.slots.get(2)!; // 02h UTC
    const afternoonSlot = baseline.slots.get(14)!; // 14h UTC
    expect(morningSlot.p99).toBe(0);
    expect(afternoonSlot.p99).toBe(10);
  });
});

describe("detectSeasonalAnomalies", () => {
  it("dispara quando volume excede baseline do slot atual", () => {
    const series: TimeSeries = { dimension: "x", buckets: new Map() };
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    // baseline carregada — 1 evento/min em todos os slots
    for (let m = nowMin - REFERENCE_WINDOW_MIN + 1; m < nowMin - 4; m++) {
      series.buckets.set(m, 1);
    }
    // pico nos últimos 5 min
    for (let m = nowMin - 4; m <= nowMin; m++) series.buckets.set(m, 30);
    const baseline = computeSeasonalBaseline(series, nowMin);
    const result = detectSeasonalAnomalies(series, baseline, nowMin, { detector: "OFF_HOURS" });
    expect(result).toHaveLength(1);
    expect(result[0].metric).toBe(30);
  });

  it("silencia se slot tiver <30 amostras (refWindow curta artificialmente)", () => {
    // Com REFERENCE_WINDOW_MIN=10080, todo slot sempre recebe ~60 amostras (uma
    // ocorrência por semana × 60 min). Esse caso só dispara em produção quando
    // o accumulator tem <3 dias de histórico. Aqui validamos via baseline com
    // sampleCount artificialmente baixo.
    const series: TimeSeries = { dimension: "x", buckets: new Map() };
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    for (let m = nowMin - 4; m <= nowMin; m++) series.buckets.set(m, 100);
    const slot = seasonalSlot(nowMin);
    const baseline = {
      dimension: "x",
      slots: new Map([[slot, { p99: 0, iqr: 0, sampleCount: 5 }]]),
    };
    expect(detectSeasonalAnomalies(series, baseline, nowMin, { detector: "OFF_HOURS" })).toEqual([]);
  });
});

describe("detectOffHoursVolume", () => {
  it("não dispara fora do horário 0h-6h UTC", () => {
    // 2026-05-04 14:00 UTC = horário comercial
    const nowMin = Math.floor(Date.UTC(2026, 4, 4, 14, 0, 0) / MS_PER_MINUTE);
    const events = Array.from({ length: 10 }, (_, i) =>
      ev({ timestamp: tsAt(nowMin - i), service: "x", level: "Error" }),
    );
    expect(detectOffHoursVolume(events, nowMin)).toEqual([]);
  });
});

describe("detectErrorRatePerService", () => {
  it("dispara quando service específico tem pico sustentado", () => {
    const events: StoredEvent[] = [];
    const nowMin = REFERENCE_WINDOW_MIN + 100;

    // baseline: 1 erro/min em "stable" durante toda a janela
    for (let m = nowMin - REFERENCE_WINDOW_MIN + 1; m < nowMin; m++) {
      events.push(ev({ timestamp: tsAt(m), service: "stable", level: "Error" }));
    }
    // pico: 50 erros/min nos últimos 5 minutos em "spiky"
    for (let m = nowMin - 4; m <= nowMin; m++) {
      for (let i = 0; i < 50; i++) {
        events.push(ev({ timestamp: tsAt(m), service: "spiky", level: "Error" }));
      }
    }
    // baseline para "spiky": 0 (vai usar fluctuation=1, threshold=3)
    for (let m = nowMin - REFERENCE_WINDOW_MIN + 1; m < nowMin - 4; m++) {
      events.push(ev({ timestamp: tsAt(m), service: "spiky", level: "Error" }));
    }

    const result = detectErrorRatePerService(events, nowMin);
    const spiky = result.find(a => a.dimension === "service:spiky");
    expect(spiky).toBeDefined();
    expect(spiky?.metric).toBe(50);
  });

  it("ignora eventos não-error", () => {
    const events: StoredEvent[] = [];
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    for (let m = nowMin - 4; m <= nowMin; m++) {
      events.push(ev({ timestamp: tsAt(m), service: "x", level: "Warning" }));
    }
    const result = detectErrorRatePerService(events, nowMin);
    expect(result).toEqual([]);
  });
});

describe("detectErrorRatePerEndpoint", () => {
  it("dispara em endpoint com pico sustentado e tráfego histórico significativo", () => {
    const events: StoredEvent[] = [];
    const nowMin = REFERENCE_WINDOW_MIN + 100;

    // Endpoint /a com tráfego histórico (~1/min em toda a janela = 10k eventos)
    for (let m = nowMin - REFERENCE_WINDOW_MIN + 1; m < nowMin - 4; m++) {
      events.push(ev({ timestamp: tsAt(m), request_path: "/a", level: "Error" }));
    }
    // Pico nos últimos 5 min em /a
    for (let m = nowMin - 4; m <= nowMin; m++) {
      for (let i = 0; i < 30; i++) {
        events.push(ev({ timestamp: tsAt(m), request_path: "/a", level: "Error" }));
      }
    }
    const result = detectErrorRatePerEndpoint(events, nowMin);
    const a = result.find(r => r.dimension === "endpoint:/a");
    expect(a).toBeDefined();
  });

  it("ignora endpoints com menos de 50 eventos históricos (filtro de cardinalidade)", () => {
    const events: StoredEvent[] = [];
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    // /raro só apareceu 3 vezes nos últimos 5 min — sem histórico
    for (let m = nowMin - 4; m <= nowMin; m++) {
      events.push(ev({ timestamp: tsAt(m), request_path: "/raro", level: "Error" }));
    }
    const result = detectErrorRatePerEndpoint(events, nowMin);
    expect(result).toEqual([]);
  });

  it("normaliza query string (remove ?qs)", () => {
    const events: StoredEvent[] = [];
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    for (let m = nowMin - REFERENCE_WINDOW_MIN + 1; m < nowMin - 4; m++) {
      events.push(ev({ timestamp: tsAt(m), request_path: "/x?id=1", level: "Error" }));
    }
    for (let m = nowMin - 4; m <= nowMin; m++) {
      for (let i = 0; i < 30; i++) {
        events.push(ev({ timestamp: tsAt(m), request_path: `/x?id=${i}`, level: "Error" }));
      }
    }
    const result = detectErrorRatePerEndpoint(events, nowMin);
    expect(result.find(r => r.dimension === "endpoint:/x")).toBeDefined();
  });
});

describe("detectAuthBurst", () => {
  it("detecta burst de mensagens de erro de autenticação", () => {
    const events: StoredEvent[] = [];
    const nowMin = REFERENCE_WINDOW_MIN + 100;

    // baseline: 1 falha/min ao longo da janela
    for (let m = nowMin - REFERENCE_WINDOW_MIN + 1; m < nowMin; m++) {
      events.push(ev({ timestamp: tsAt(m), message: "Erro autenticação genérico" }));
    }
    // burst: 30 falhas/min nos últimos 5 minutos
    for (let m = nowMin - 4; m <= nowMin; m++) {
      for (let i = 0; i < 30; i++) {
        events.push(ev({ timestamp: tsAt(m), message: "Erro autenticação user@x" }));
      }
    }

    const result = detectAuthBurst(events, nowMin);
    expect(result).toHaveLength(1);
    expect(result[0].dimension).toBe("auth_failures");
  });

  it("não dispara sem mensagens de auth", () => {
    const events: StoredEvent[] = [];
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    for (let m = nowMin - 4; m <= nowMin; m++) {
      events.push(ev({ timestamp: tsAt(m), message: "Database error" }));
    }
    expect(detectAuthBurst(events, nowMin)).toEqual([]);
  });
});

describe("detectNewMessage", () => {
  it("detecta mensagem inédita com reincidência", () => {
    const events: StoredEvent[] = [];
    const nowMin = REFERENCE_WINDOW_MIN + 100;

    // mensagem antiga conhecida
    for (let d = 1; d <= 5; d++) {
      events.push(ev({ timestamp: tsAt(nowMin - d * 1440), message: "Erro conhecido X", level: "Error" }));
    }
    // mensagem nova: 5 ocorrências na última hora
    for (let i = 0; i < 5; i++) {
      events.push(ev({ timestamp: tsAt(nowMin - i), message: "NullReferenceException at FooService", level: "Error" }));
    }

    const result = detectNewMessage(events, nowMin);
    expect(result).toHaveLength(1);
    expect(result[0].metric).toBe(5);
    expect(result[0].dimension).toContain("message:");
  });

  it("ignora mensagens novas com <3 ocorrências", () => {
    const events: StoredEvent[] = [];
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    events.push(ev({ timestamp: tsAt(nowMin - 1), message: "Mensagem nova rara", level: "Error" }));
    expect(detectNewMessage(events, nowMin)).toEqual([]);
  });

  it("ignora mensagem se já existia no histórico", () => {
    const events: StoredEvent[] = [];
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    // histórico: já viu antes
    for (let d = 1; d <= 5; d++) {
      events.push(ev({ timestamp: tsAt(nowMin - d * 1440), message: "Mensagem comum", level: "Error" }));
    }
    // 5 ocorrências recentes da mesma mensagem
    for (let i = 0; i < 5; i++) {
      events.push(ev({ timestamp: tsAt(nowMin - i), message: "Mensagem comum", level: "Error" }));
    }
    expect(detectNewMessage(events, nowMin)).toEqual([]);
  });

  it("normaliza dígitos no clusterKey (não vê IDs como mensagens distintas)", () => {
    const events: StoredEvent[] = [];
    const nowMin = REFERENCE_WINDOW_MIN + 100;
    // já viu padrão no histórico, com IDs diferentes
    events.push(ev({ timestamp: tsAt(nowMin - 5000), message: "User 12345 not found", level: "Error" }));
    // recente mesmo padrão com IDs diferentes — não deve disparar
    for (let i = 0; i < 5; i++) {
      events.push(ev({ timestamp: tsAt(nowMin - i), message: "User 99999 not found", level: "Error" }));
    }
    expect(detectNewMessage(events, nowMin)).toEqual([]);
  });
});
