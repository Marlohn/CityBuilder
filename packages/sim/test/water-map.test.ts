/** Rio e lagos no mapa (issue #16). */
import { describe, expect, it } from "vitest";
import { checkInvariants } from "../src/debug/invariants";
import { createGame } from "../src/game";
import { Simulation } from "../src/sim";
import { loadDefaults } from "./helpers";

const { config, data } = loadDefaults();

function waterOf(seed: string) {
  return new Simulation({ config, data, seed }).world;
}

describe("água no mapa", () => {
  it("o rio atravessa o mapa de norte a sul e há lagos; a estrada de acesso fica seca", () => {
    const w = waterOf("rio");
    const cfg = config.world.water;
    for (let y = 0; y < w.height; y++) {
      let row = 0;
      for (let x = Math.floor(w.width * cfg.riverX[0]) - 1; x < w.width; x++) row += w.water[w.idx(x, y)]!;
      expect(row, `linha ${y} sem rio`).toBeGreaterThanOrEqual(cfg.riverWidth);
    }
    // Água fora da faixa do rio = lagos.
    let lakes = 0;
    for (let i = 0; i < w.size; i++) if (w.water[i] && w.xOf(i) < w.width * cfg.riverX[0] - 2) lakes++;
    expect(lakes).toBeGreaterThan(0);
    const mid = Math.floor(w.height / 2);
    for (let x = 0; x < config.world.startingRoad.length + 6; x++) expect(w.water[w.idx(x, mid)]).toBe(0);
    // Sem árvore dentro da água.
    for (let i = 0; i < w.size; i++) if (w.water[i]) expect(w.trees[i]).toBe(0);
  });

  it("mesma semente = mesmo rio; semente diferente = outro rio", () => {
    expect(Array.from(waterOf("a").water)).toEqual(Array.from(waterOf("a").water));
    expect(Array.from(waterOf("a").water)).not.toEqual(Array.from(waterOf("b").water));
  });

  it("não dá para abrir via, zonear nem construir serviço na água", () => {
    const sim = new Simulation({ config, data, seed: "rio" });
    const w = sim.world;
    const i = w.water.indexOf(1);
    const x = w.xOf(i);
    const y = w.yOf(i);
    sim.enqueue({ type: "buildRoad", kind: "street", x0: x, y0: y, x1: x, y1: y });
    sim.enqueue({ type: "zone", zone: "residential_low", x0: x, y0: y, x1: x, y1: y });
    sim.enqueue({ type: "placeService", service: "ubs", x, y });
    sim.step();
    const [road, zone, ubs] = sim.drainResults();
    expect(road?.ok).toBe(false);
    expect(road?.reason).toMatch(/água/);
    expect(w.zones[i]).toBe(0);
    expect(zone?.ok).toBe(true);
    expect(ubs?.ok).toBe(false);
  });

  it("zona que encosta na água cresce sem pôr prédio na água", () => {
    const game = createGame({ config, data, seed: "rio-bot" });
    const w = game.sim.world;
    const mid = Math.floor(w.height / 2);
    game.sim.enqueue({ type: "buildRoad", kind: "avenue", x0: 47, y0: mid, x1: 120, y1: mid });
    game.sim.enqueue({ type: "zone", zone: "residential_low", x0: 48, y0: mid - 6, x1: 120, y1: mid - 1 });
    game.sim.step(4 * game.sim.clock.ticksPerDay);
    for (let i = 0; i < w.size; i++) if (w.water[i]) expect(w.buildingAt[i]).toBe(-1);
    expect(checkInvariants(game.city)).toEqual([]);
  });
});
