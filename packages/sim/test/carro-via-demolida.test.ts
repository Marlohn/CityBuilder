/**
 * Carro que sobra "estacionado" numa via que o próprio bulldoze demoliu.
 *
 * Regra do projeto: nada some do nada, e todo carro está sempre em algum lugar de verdade
 * (docs/VISAO.md). Um carro "parado na rua" aponta para um quadradinho de via; se essa via
 * deixa de existir no mesmo comando que derrubou o prédio, o carro precisa ir para a casa da
 * família, que ainda tem via, ou ser vendido. Hoje ele fica apontando para o vazio para sempre,
 * e a tela o desenharia em cima do terreno sem rua embaixo.
 */
import { describe, expect, it } from "vitest";
import { createGame } from "../src/game";
import { VSTATE } from "../src/traffic/vehicles";
import { loadDefaults } from "./helpers";

/** Carros parados "na rua" cujo quadradinho não tem mais via. */
function carsOnMissingRoad(game: ReturnType<typeof createGame>): number[] {
  const veh = game.city.traffic!.vehicles;
  const world = game.sim.world;
  const out: number[] = [];
  for (let v = 0; v < veh.count; v++) {
    if (veh.state[v] !== VSTATE.parked || veh.parkedAt[v]! >= 0) continue;
    const t = veh.streetTile[v]!;
    if (t >= 0 && world.roads[t] === 0) out.push(v);
  }
  return out;
}

function cityWithStreet() {
  const { config, data } = loadDefaults({ economy: { mode: "sandbox" } });
  const game = createGame({ config, data, seed: "carro-via-demolida" });
  const sim = game.sim;
  const mid = 128;
  sim.enqueue({ type: "buildRoad", kind: "street", x0: 0, y0: mid, x1: 200, y1: mid });
  sim.enqueue({ type: "zone", zone: "residential_low", x0: 61, y0: mid - 20, x1: 160, y1: mid - 1 });
  sim.enqueue({ type: "zone", zone: "commercial", x0: 61, y0: mid + 1, x1: 160, y1: mid + 20 });
  sim.step(sim.clock.ticksPerDay * 12);
  sim.drainResults();
  return { game, mid };
}

describe("carro em via demolida", () => {
  it("não fica apontando para um quadradinho que não tem mais via", () => {
    const { game } = cityWithStreet();
    const sim = game.sim;
    const veh = game.city.traffic!.vehicles;
    const bs = sim.buildings;
    const world = sim.world;

    // Espera um carro chegar ao trabalho e ficar na garagem de um prédio.
    let v = -1;
    for (let t = 0; t < sim.clock.ticksPerDay * 6 && v < 0; t++) {
      v =
        [...Array(veh.count).keys()].find(
          (x) =>
            veh.state[x] === VSTATE.moving &&
            veh.destBuilding[x]! >= 0 &&
            bs.typeOf(veh.destBuilding[x]!).jobs > 0,
        ) ?? -1;
      if (v < 0) {
        sim.step(1);
        sim.drainResults();
      }
    }
    expect(v, "a cidade precisa ter carro indo ao trabalho para o teste valer").toBeGreaterThanOrEqual(0);
    while (veh.state[v] === VSTATE.moving) {
      sim.step(1);
      sim.drainResults();
    }
    const alvo = veh.parkedAt[v]!;
    expect(alvo, "o carro precisa ter estacionado num prédio para o teste valer").toBeGreaterThanOrEqual(0);

    // O jogador derruba o bloco inteiro: prédio e a via de acesso, num comando só.
    const ax = bs.access[alvo]!;
    const x0 = Math.min(bs.x[alvo]!, world.xOf(ax));
    const y0 = Math.min(bs.y[alvo]!, world.yOf(ax));
    const x1 = Math.max(bs.x[alvo]! + bs.w[alvo]! - 1, world.xOf(ax));
    const y1 = Math.max(bs.y[alvo]! + bs.h[alvo]! - 1, world.yOf(ax));
    sim.enqueue({ type: "bulldoze", x0, y0, x1, y1 });
    sim.step(1);
    sim.drainResults();
    expect(world.roads[ax], "o bulldoze tinha de derrubar a via de acesso junto").toBe(0);

    // Deixa a cidade rodar: ninguém vem consertar o carro.
    sim.step(sim.clock.ticksPerDay * 6);
    sim.drainResults();

    expect(
      carsOnMissingRoad(game),
      "carro parado na rua tem de apontar para uma via de verdade, ou ir para a casa da família / ser vendido",
    ).toEqual([]);
  });
});
