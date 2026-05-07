import { describe, it, expect } from "vitest";
import { EventStore } from "./eventStore";

interface FakeEvent {
  id: string;
  payload: string;
}

describe("EventStore", () => {
  it("put + get retorna o evento", () => {
    const store = new EventStore<FakeEvent>();
    store.put("seq", "e1", { id: "e1", payload: "hello" }, 1000);
    expect(store.get("seq", "e1")).toEqual({ id: "e1", payload: "hello" });
  });

  it("get retorna undefined para evento inexistente", () => {
    const store = new EventStore<FakeEvent>();
    expect(store.get("seq", "missing")).toBeUndefined();
  });

  it("put sobrescreve evento existente com mesmo eventId", () => {
    const store = new EventStore<FakeEvent>();
    store.put("seq", "e1", { id: "e1", payload: "v1" }, 1000);
    store.put("seq", "e1", { id: "e1", payload: "v2" }, 1100);
    expect(store.get("seq", "e1")?.payload).toBe("v2");
  });

  it("sources diferentes ficam isolados", () => {
    const store = new EventStore<FakeEvent>();
    store.put("seq", "id", { id: "id", payload: "seq" }, 1000);
    store.put("waf", "id", { id: "id", payload: "waf" }, 1000);
    expect(store.get("seq", "id")?.payload).toBe("seq");
    expect(store.get("waf", "id")?.payload).toBe("waf");
  });

  it("putMany aplica em batch", () => {
    const store = new EventStore<FakeEvent>();
    store.putMany("seq", [
      { eventId: "a", event: { id: "a", payload: "1" }, timestamp: 1000 },
      { eventId: "b", event: { id: "b", payload: "2" }, timestamp: 1001 },
    ]);
    expect(store.size("seq")).toBe(2);
  });

  it("list ordena por timestamp desc (mais recente primeiro)", () => {
    const store = new EventStore<FakeEvent>();
    store.put("seq", "a", { id: "a", payload: "old" }, 1000);
    store.put("seq", "c", { id: "c", payload: "newest" }, 1200);
    store.put("seq", "b", { id: "b", payload: "mid" }, 1100);
    const events = store.list("seq");
    expect(events.map(e => e.id)).toEqual(["c", "b", "a"]);
  });

  it("list filtra por sinceMinute", () => {
    const store = new EventStore<FakeEvent>();
    store.put("seq", "a", { id: "a", payload: "old" }, 100);
    store.put("seq", "b", { id: "b", payload: "new" }, 500);
    expect(store.list("seq", 200).map(e => e.id)).toEqual(["b"]);
  });
});

describe("EventStore.prune", () => {
  it("remove eventos com timestamp < oldestMinuteToKeep", () => {
    const store = new EventStore<FakeEvent>();
    store.put("seq", "old", { id: "old", payload: "x" }, 100);
    store.put("seq", "new", { id: "new", payload: "y" }, 500);
    const removed = store.prune("seq", 300);
    expect(removed).toBe(1);
    expect(store.get("seq", "old")).toBeUndefined();
    expect(store.get("seq", "new")).toBeDefined();
  });

  it("retorna 0 se source não existe", () => {
    const store = new EventStore<FakeEvent>();
    expect(store.prune("missing", 100)).toBe(0);
  });

  it("pruneToWindow usa janela default 2h relativa ao nowMin", () => {
    const store = new EventStore<FakeEvent>();
    const nowMin = 10000;
    store.put("seq", "ancient", { id: "ancient", payload: "x" }, nowMin - 200); // 3h+ atrás
    store.put("seq", "recent", { id: "recent", payload: "y" }, nowMin - 30);    // 30min atrás
    store.pruneToWindow("seq", nowMin);
    expect(store.get("seq", "ancient")).toBeUndefined();
    expect(store.get("seq", "recent")).toBeDefined();
  });
});
