/** Continuidade do carro na tela (issue #48): carro dentro do mapa esta sempre desenhado, nunca andando e invisivel. */
import { describe, expect, it } from "vitest";
import { createGame } from "../src/game";
import { VSTATE } from "../src/traffic/vehicles";
import { DEFAULT_TRAFFIC_VISUALS, TrafficVisuals } from "../src/view/trafficVisuals";
import { loadDefaults } from "./helpers";

function cityWithCommuters() {
  const { config, data } = loadDefaults({ world: { width: 128, height: 128 }, economy: { mode: "sandbox" } });
  const game = createGame({ config, data, seed: "transito-visual" });
  const mid = 64;
  const s = game.sim;
  s.enqueue({ type: "buildRoad", kind: "street", x0: 30, y0: mid - 20, x1: 30, y1: mid + 20 });
  s.enqueue({ type: "buildRoad", kind: "street", x0: 30, y0: mid - 20, x1: 60, y1: mid - 20 });
  s.enqueue({ type: "zone", zone: "residential_low", x0: 31, y0: mid - 19, x1: 32, y1: mid - 1 });
  s.enqueue({ type: "zone", zone: "commercial", x0: 28, y0: mid - 19, x1: 29, y1: mid + 19 });
  s.enqueue({ type: "zone", zone: "industrial", x0: 31, y0: mid - 22, x1: 60, y1: mid - 21 });
  s.step(6 * s.clock.ticksPerDay);
  return game;
}

describe("continuidade do carro na tela", () => {
  it("short route car stays on screen", () => {
    const game = cityWithCommuters();
    const visuals = new TrafficVisuals(game);
    const tpd = game.sim.clock.ticksPerDay;
    let invisible = 0;
    let movingTotal = 0;
    let shortFrames = 0;
    // Dois dias, 1 tick por vez, com a tela avancando junto.
    for (let t = 0; t < 2 * tpd; t++) {
      game.sim.step(1);
      visuals.advance(1 / 12, 1);
      const moving = game.traffic.vehicles.moving;
      let shortThisTick = false;
      for (let i = 0; i < moving.size; i++) {
        const v = moving.at(i)!;
        movingTotal++;
        // Todo carro andando tem de estar desenhado.
        if (!visuals.isCarOnScreen(v)) invisible++;
        const route = game.traffic.vehicles.routes[v];
        if (route && route.length === 1 && game.traffic.vehicles.state[v] === VSTATE.moving) {
          shortThisTick = true;
        }
      }
      if (shortThisTick) shortFrames++;
    }
    // Sem ao menos um quadro com rota de 1 quadradinho, o teste nao prova nada.
    expect(shortFrames, "nenhum quadro com rota de 1 quadradinho").toBeGreaterThan(0);
    expect(movingTotal, "nenhum carro andou").toBeGreaterThan(0);
    expect(invisible, `carros andando e invisiveis: total=${movingTotal} invisiveis=${invisible}`).toBe(0);
  });

  it("maxActive cut keeps car on screen", () => {
    const game = cityWithCommuters();
    // Limite de tela bem baixo para forcar o corte a cada quadro.
    const visuals = new TrafficVisuals(game, { ...DEFAULT_TRAFFIC_VISUALS, maxActive: 5 });
    const tpd = game.sim.clock.ticksPerDay;
    let invisible = 0;
    let movingTotal = 0;
    // Dois dias, 1 tick por vez, com a tela avancando junto.
    for (let t = 0; t < 2 * tpd; t++) {
      game.sim.step(1);
      visuals.advance(1 / 12, 1);
      const moving = game.traffic.vehicles.moving;
      for (let i = 0; i < moving.size; i++) {
        const v = moving.at(i)!;
        movingTotal++;
        // O corte nao pode tirar o carro de cena.
        if (!visuals.isCarOnScreen(v)) invisible++;
      }
    }
    expect(movingTotal, "nenhum carro andou").toBeGreaterThan(0);
    expect(invisible, `corte tirou carro de cena: total=${movingTotal} invisiveis=${invisible}`).toBe(0);
  });
});
