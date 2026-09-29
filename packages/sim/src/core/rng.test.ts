import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hashString, Rng } from "./rng";

describe("Rng", () => {
  it("repete exatamente a mesma sequência com a mesma semente", () => {
    const a = new Rng("cidade-1");
    const b = new Rng("cidade-1");
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it("sementes diferentes geram sequências diferentes", () => {
    const a = new Rng("cidade-1");
    const b = new Rng("cidade-2");
    const sa = Array.from({ length: 10 }, () => a.nextU32());
    const sb = Array.from({ length: 10 }, () => b.nextU32());
    expect(sa).not.toEqual(sb);
  });

  it("float fica sempre em [0, 1)", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const r = new Rng(seed);
        for (let i = 0; i < 50; i++) {
          const f = r.float();
          if (f < 0 || f >= 1) return false;
        }
        return true;
      }),
    );
  });

  it("int(n) fica sempre em [0, n)", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 1_000_000 }), (seed, n) => {
        const r = new Rng(seed);
        for (let i = 0; i < 20; i++) {
          const v = r.int(n);
          if (v < 0 || v >= n || !Number.isInteger(v)) return false;
        }
        return true;
      }),
    );
  });

  it("fluxos (streams) de sistemas diferentes são independentes", () => {
    // Adicionar um sistema novo não pode mudar o sorteio dos outros.
    const base = new Rng("seed");
    const life1 = base.stream("life");
    const lifeSeq = Array.from({ length: 5 }, () => life1.nextU32());

    const base2 = new Rng("seed");
    const traffic = base2.stream("traffic");
    traffic.nextU32();
    traffic.nextU32();
    const life2 = base2.stream("life");
    expect(Array.from({ length: 5 }, () => life2.nextU32())).toEqual(lifeSeq);
  });

  it("salva e restaura o estado", () => {
    const r = new Rng("x");
    r.nextU32();
    const state = r.getState();
    const next = [r.nextU32(), r.nextU32()];
    const r2 = Rng.fromState(state);
    expect([r2.nextU32(), r2.nextU32()]).toEqual(next);
  });

  it("distribuição de float é razoavelmente uniforme", () => {
    const r = new Rng("uniforme");
    const buckets = new Array(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r.float() * 10)]++;
    for (const b of buckets) expect(Math.abs(b - n / 10)).toBeLessThan(n / 100);
  });

  it("hashString é estável", () => {
    expect(hashString("abc")).toEqual(hashString("abc"));
    expect(hashString("abc")).not.toEqual(hashString("abd"));
  });
});
