import { describe, expect, it } from "vitest";
import { World } from "../world/world";
import { Pathfinder, tileCostDs } from "./pathfinder";

function world(): World {
  const w = new World(20, 20, 16);
  // Rua em "U": de (1,1) desce até (1,10), vai até (10,10) e sobe até (10,1).
  for (let y = 1; y <= 10; y++) w.roads[w.idx(1, y)] = 1;
  for (let x = 1; x <= 10; x++) w.roads[w.idx(x, 10)] = 1;
  for (let y = 1; y <= 10; y++) w.roads[w.idx(10, y)] = 1;
  return w;
}

const speeds = { tileCost: [0, tileCostDs(16, 30), tileCostDs(16, 60)] };

describe("Pathfinder", () => {
  it("acha o caminho pela única ligação", () => {
    const w = world();
    const pf = new Pathfinder(w, speeds);
    const path = pf.find(w.idx(1, 1), w.idx(10, 1))!;
    expect(path[0]).toBe(w.idx(1, 1));
    expect(path[path.length - 1]).toBe(w.idx(10, 1));
    expect(path.length).toBe(10 + 9 + 9);
  });

  it("devolve null quando não há ligação", () => {
    const w = world();
    w.roads[w.idx(15, 15)] = 1;
    expect(new Pathfinder(w, speeds).find(w.idx(1, 1), w.idx(15, 15))).toBeNull();
  });

  it("prefere a avenida quando é mais rápida", () => {
    const w = world();
    // Atalho de rua (lenta) direto no topo vs caminho em U. Com avenida no U, o U pode ganhar.
    for (let x = 1; x <= 10; x++) w.roads[w.idx(x, 1)] = 1;
    const pf = new Pathfinder(w, speeds);
    expect(pf.find(w.idx(1, 1), w.idx(10, 1))!.length).toBe(10);
  });

  it("é determinístico (mesmo resultado sempre)", () => {
    const w = world();
    for (let x = 1; x <= 10; x++) w.roads[w.idx(x, 5)] = 1;
    const a = new Pathfinder(w, speeds).find(w.idx(1, 1), w.idx(10, 10))!;
    const b = new Pathfinder(w, speeds).find(w.idx(1, 1), w.idx(10, 10))!;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("30 km/h em 16 m = 1,92 s por quadradinho", () => {
    expect(tileCostDs(16, 30)).toBe(19);
  });
});
