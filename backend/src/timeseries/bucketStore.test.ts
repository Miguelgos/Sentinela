import { describe, it, expect } from "vitest";
import { BucketStore } from "./bucketStore";
import { REFERENCE_WINDOW_MIN } from "./types";

describe("BucketStore.bump / getSeries", () => {
  it("incrementa minuto no bucket correto", () => {
    const store = new BucketStore();
    store.bump("seq", "service:api", 1000, 5);
    const series = store.getSeries("seq", "service:api", 1000);
    expect(series.buckets.get(1000)).toBe(5);
  });

  it("acumula múltiplos bumps no mesmo (source, dim, minute)", () => {
    const store = new BucketStore();
    store.bump("seq", "service:api", 1000);
    store.bump("seq", "service:api", 1000, 3);
    store.bump("seq", "service:api", 1000);
    const series = store.getSeries("seq", "service:api", 1000);
    expect(series.buckets.get(1000)).toBe(5);
  });

  it("dimensões diferentes ficam isoladas", () => {
    const store = new BucketStore();
    store.bump("seq", "service:a", 100, 7);
    store.bump("seq", "service:b", 100, 3);
    expect(store.getSeries("seq", "service:a", 100).buckets.get(100)).toBe(7);
    expect(store.getSeries("seq", "service:b", 100).buckets.get(100)).toBe(3);
  });

  it("sources diferentes ficam isolados", () => {
    const store = new BucketStore();
    store.bump("seq", "x", 100, 5);
    store.bump("waf", "x", 100, 9);
    expect(store.getSeries("seq", "x", 100).buckets.get(100)).toBe(5);
    expect(store.getSeries("waf", "x", 100).buckets.get(100)).toBe(9);
  });
});

describe("BucketStore.bumpMany", () => {
  it("aplica múltiplas dimensões num único minuto", () => {
    const store = new BucketStore();
    store.bumpMany("waf", 1000, { "attack:SQLi": 5, "country:BR": 3, "total": 8 });
    expect(store.getSeries("waf", "attack:SQLi", 1000).buckets.get(1000)).toBe(5);
    expect(store.getSeries("waf", "country:BR", 1000).buckets.get(1000)).toBe(3);
    expect(store.getSeries("waf", "total", 1000).buckets.get(1000)).toBe(8);
  });

  it("ignora incrementos zero", () => {
    const store = new BucketStore();
    store.bumpMany("seq", 1000, { a: 5, b: 0, c: 1 });
    expect(store.getDimensions("seq").sort()).toEqual(["a", "c"]);
  });
});

describe("BucketStore — janela e índice circular", () => {
  it("getSeries retorna apenas slots não-zero", () => {
    const store = new BucketStore();
    store.bump("seq", "x", 1000);
    store.bump("seq", "x", 1005);
    const series = store.getSeries("seq", "x", 1010);
    expect([...series.buckets.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [1000, 1],
      [1005, 1],
    ]);
  });

  it("retorna série vazia para dimensão inexistente", () => {
    const store = new BucketStore();
    const series = store.getSeries("seq", "missing", 1000);
    expect(series.buckets.size).toBe(0);
  });

  it("dado mais antigo que LEN é descartado quando minuto avança LEN slots", () => {
    const store = new BucketStore();
    store.bump("seq", "x", 100, 5);
    // pula adiante além de uma janela completa
    store.bump("seq", "x", 100 + REFERENCE_WINDOW_MIN + 1, 9);
    // o slot do minuto 100 foi reaproveitado pelo minuto 100 + LEN; então
    // bump em 100+LEN+1 fica num slot diferente. Mas por causa do reset
    // (minute > newestMinute + LEN), o array foi zerado antes do segundo bump.
    const series = store.getSeries("seq", "x", 100 + REFERENCE_WINDOW_MIN + 1);
    expect(series.buckets.get(100)).toBeUndefined();
    expect(series.buckets.get(100 + REFERENCE_WINDOW_MIN + 1)).toBe(9);
  });
});

describe("BucketStore.rotateTo", () => {
  it("zera séries cujo newestMinute está fora da janela", () => {
    const store = new BucketStore();
    store.bump("seq", "stale", 100);
    store.bump("seq", "fresh", 100 + REFERENCE_WINDOW_MIN);
    // nowMin avança além da janela do "stale"
    store.rotateTo("seq", 100 + REFERENCE_WINDOW_MIN + 100);
    const stale = store.getSeries("seq", "stale", 100 + REFERENCE_WINDOW_MIN + 100);
    expect(stale.buckets.size).toBe(0);
  });
});

describe("BucketStore.getStats", () => {
  it("conta dimensões e slots usados", () => {
    const store = new BucketStore();
    store.bump("seq", "a", 100);
    store.bump("seq", "a", 101);
    store.bump("seq", "b", 100);
    const stats = store.getStats("seq");
    expect(stats.dimensions).toBe(2);
    expect(stats.totalSlotsUsed).toBe(3);
  });
});
