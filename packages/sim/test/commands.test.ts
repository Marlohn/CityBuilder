import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim";
import { BSTATE } from "../src/world/buildings";
import { loadDefaults } from "./helpers";

function newSim(overrides?: unknown) {
  const { config, data } = loadDefaults({
    world: { width: 64, height: 64, treeCoverage: 0.2 },
    ...(overrides as object),
  });
  return new Simulation({ config, data, seed: "teste-comandos" });
}

describe("vias", () => {
  it("constrói uma rua reta e cobra o custo por quadradinho", () => {
    const sim = newSim();
    const before = sim.treasury.money;
    sim.enqueue({ type: "buildRoad", kind: "street", x0: 5, y0: 10, x1: 14, y1: 10 });
    sim.step();
    const [r] = sim.drainResults();
    expect(r?.ok).toBe(true);
    for (let x = 5; x <= 14; x++) expect(sim.world.roads[sim.world.idx(x, 10)]).toBe(1);
    expect(before - sim.treasury.money).toBe(10 * sim.config.roads.street.costPerTile);
  });

  it("recusa via em diagonal", () => {
    const sim = newSim();
    sim.enqueue({ type: "buildRoad", kind: "street", x0: 1, y0: 1, x1: 5, y1: 5 });
    sim.step();
    const [r] = sim.drainResults();
    expect(r?.ok).toBe(false);
    expect(r?.reason).toMatch(/reta/);
  });

  it("recusa quando não tem dinheiro (modo orçamento)", () => {
    const sim = newSim({ economy: { startingMoney: 1000 } });
    sim.enqueue({ type: "buildRoad", kind: "street", x0: 0, y0: 0, x1: 20, y1: 0 });
    sim.step();
    const [r] = sim.drainResults();
    expect(r?.ok).toBe(false);
    expect(r?.reason).toMatch(/dinheiro insuficiente/);
    expect(sim.world.roads[0]).toBe(0);
  });

  it("no modo sandbox o dinheiro é infinito", () => {
    const sim = newSim({ economy: { startingMoney: 0, mode: "sandbox" } });
    sim.enqueue({ type: "buildRoad", kind: "avenue", x0: 0, y0: 0, x1: 40, y1: 0 });
    sim.step();
    expect(sim.drainResults()[0]?.ok).toBe(true);
  });

  it("via remove árvores e zona do caminho", () => {
    const sim = newSim();
    sim.enqueue({ type: "zone", zone: "residential_low", x0: 0, y0: 20, x1: 30, y1: 22 });
    sim.enqueue({ type: "buildRoad", kind: "street", x0: 0, y0: 21, x1: 30, y1: 21 });
    sim.step();
    for (let x = 0; x <= 30; x++) {
      const i = sim.world.idx(x, 21);
      expect(sim.world.trees[i]).toBe(0);
      expect(sim.world.zones[i]).toBe(0);
    }
  });
});

describe("serviços", () => {
  it("escola precisa encostar numa via", () => {
    const sim = newSim();
    sim.enqueue({ type: "placeService", service: "escola", x: 20, y: 20 });
    sim.step();
    const [r] = sim.drainResults();
    expect(r?.ok).toBe(false);
    expect(r?.reason).toMatch(/encostar numa via/);
  });

  it("escola ao lado da via fica em obra e depois fica pronta", () => {
    const sim = newSim();
    sim.enqueue({ type: "buildRoad", kind: "street", x0: 0, y0: 30, x1: 40, y1: 30 });
    sim.enqueue({ type: "placeService", service: "escola", x: 10, y: 24 });
    sim.step();
    const results = sim.drainResults();
    expect(results.every((r) => r.ok)).toBe(true);
    const id = 0;
    expect(sim.buildings.state[id]).toBe(BSTATE.constructing);
    // Escola FNDE: 18 meses de obra = 1,5 dia do jogo.
    sim.step(Math.ceil(1.5 * sim.clock.ticksPerDay) + 1);
    expect(sim.buildings.state[id]).toBe(BSTATE.active);
    expect(sim.buildings.access[id]).toBe(sim.world.idx(10, 30));
  });

  it("demolir tira o prédio do mapa", () => {
    const sim = newSim();
    sim.enqueue({ type: "buildRoad", kind: "street", x0: 0, y0: 30, x1: 40, y1: 30 });
    sim.enqueue({ type: "placeService", service: "ubs", x: 5, y: 28 });
    sim.step();
    expect(sim.world.buildingAt[sim.world.idx(5, 28)]).toBe(0);
    sim.enqueue({ type: "bulldoze", x0: 5, y0: 28, x1: 5, y1: 28 });
    sim.step();
    expect(sim.world.buildingAt[sim.world.idx(5, 28)]).toBe(-1);
    expect(sim.world.buildingAt[sim.world.idx(6, 29)]).toBe(-1);
    expect(sim.buildings.state[0]).toBe(BSTATE.demolished);
  });
});

describe("zonas", () => {
  it("zoneia só onde não tem via nem prédio", () => {
    const sim = newSim();
    sim.enqueue({ type: "buildRoad", kind: "street", x0: 0, y0: 5, x1: 20, y1: 5 });
    sim.enqueue({ type: "zone", zone: "commercial", x0: 0, y0: 4, x1: 20, y1: 6 });
    sim.step();
    expect(sim.world.zones[sim.world.idx(3, 5)]).toBe(0);
    expect(sim.world.zones[sim.world.idx(3, 4)]).toBe(3);
  });
});

describe("reprodutibilidade", () => {
  it("mesma semente gera o mesmo terreno", () => {
    const a = newSim();
    const b = newSim();
    expect(Buffer.from(a.world.trees).equals(Buffer.from(b.world.trees))).toBe(true);
  });

  it("cobertura de vegetação respeita a config", () => {
    const sim = newSim();
    const share = sim.world.trees.reduce((s, v) => s + v, 0) / sim.world.size;
    expect(share).toBeGreaterThan(0.17);
    expect(share).toBeLessThan(0.23);
  });
});
