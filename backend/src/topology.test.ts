import { describe, it, expect } from "vitest";
import { areRelated, rootCauseService, upstreamOf } from "./topology";

describe("upstreamOf", () => {
  it("retorna deps diretas", () => {
    expect(upstreamOf("salesbo")).toEqual(new Set(["identity"]));
  });

  it("resolve transitivamente", () => {
    // customer360 → integra → identity
    expect(upstreamOf("customer360")).toEqual(new Set(["integra", "identity"]));
  });

  it("retorna set vazio para service sem deps declaradas", () => {
    expect(upstreamOf("identity")).toEqual(new Set());
  });

  it("não loopa em ciclos", () => {
    // identity é folha, não tem deps. Mesmo se tivesse ciclo, visited.has previne loop.
    expect(upstreamOf("identity").size).toBe(0);
  });
});

describe("areRelated", () => {
  it("mesmo service é relacionado", () => {
    expect(areRelated("salesbo", "salesbo")).toBe(true);
  });

  it("relação direta", () => {
    expect(areRelated("salesbo", "identity")).toBe(true);
  });

  it("relação transitiva", () => {
    expect(areRelated("customer360", "identity")).toBe(true);
  });

  it("services não relacionados", () => {
    // salesbo não depende de customer360 (e vice-versa)
    expect(areRelated("salesbo", "customer360")).toBe(false);
  });

  it("simétrico (B upstream de A funciona igual a A upstream de B)", () => {
    expect(areRelated("identity", "salesbo")).toBe(true);
  });
});

describe("rootCauseService", () => {
  it("um único service vira a raiz", () => {
    expect(rootCauseService(["salesbo"])).toBe("salesbo");
  });

  it("retorna null para lista vazia", () => {
    expect(rootCauseService([])).toBeNull();
  });

  it("escolhe o mais upstream da cadeia", () => {
    // identity é upstream de salesbo → identity é a raiz
    expect(rootCauseService(["salesbo", "identity"])).toBe("identity");
  });

  it("escolhe o mais upstream em cadeia transitiva", () => {
    // identity ← integra ← customer360. identity é root.
    expect(rootCauseService(["customer360", "integra", "identity"])).toBe("identity");
  });
});
