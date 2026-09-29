/** Trânsito na tela (issue #11): cada viagem real aparece andando, e a cidade não muda por isso. */
import { describe, expect, it } from "vitest";
import { createGame } from "../src/game";
import { statsView } from "../src/view/stats";
import { TrafficVisuals } from "../src/view/trafficVisuals";
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

describe("trânsito na tela", () => {
  it("de manhã aparecem carros e pessoas andando pelas vias", () => {
    const game = cityWithCommuters();
    const visuals = new TrafficVisuals(game);
    const tpd = game.sim.clock.ticksPerDay;
    let maxCars = 0;
    let maxWalking = 0;
    let maxSimMoving = 0;
    const world = game.sim.world;
    // Um dia inteiro, 1 tick por vez, com 1/12 s real por tick (velocidade 1x).
    for (let t = 0; t < tpd; t++) {
      game.sim.step(1);
      visuals.advance(1 / 12, 1);
      maxCars = Math.max(maxCars, visuals.carsMoving);
      maxSimMoving = Math.max(maxSimMoving, game.traffic.vehicles.moving.size);
      maxWalking = Math.max(maxWalking, visuals.peopleWalking);
      if (t % 60 === 0) {
        const pos = visuals.positions({ x0: 0, y0: 0, x1: 128, y1: 128 });
        for (let k = 0; k < pos.length; k += 4) {
          // Todo mundo está numa via (ou na calçada dela), nunca no meio de um lote.
          const x = Math.floor(pos[k]!);
          const y = Math.floor(pos[k + 1]!);
          const nearRoad = [-1, 0, 1].some((dx) =>
            [-1, 0, 1].some(
              (dy) => world.inBounds(x + dx, y + dy) && world.roads[world.idx(x + dx, y + dy)] !== 0,
            ),
          );
          expect(nearRoad).toBe(true);
        }
      }
    }
    const s = statsView(game);
    expect(s.population).toBeGreaterThan(0);
    const msg = `na tela: ${maxCars} carros e ${maxWalking} a pé; no motor: ${maxSimMoving} carros`;
    // Antes a tela mostrava só o que o motor tinha andando naquele minuto (quase nada).
    expect(maxCars, msg).toBeGreaterThan(maxSimMoving * 2);
    expect(maxWalking, msg).toBeGreaterThan(0);
  });

  it("parado (pausa) ninguém anda na tela", () => {
    const game = cityWithCommuters();
    const visuals = new TrafficVisuals(game);
    game.sim.step(game.sim.clock.ticksPerDay / 3);
    visuals.advance(0.1, 1);
    const before = visuals.positions({ x0: 0, y0: 0, x1: 128, y1: 128 });
    visuals.advance(5, 0);
    const after = visuals.positions({ x0: 0, y0: 0, x1: 128, y1: 128 });
    expect(Array.from(after)).toEqual(Array.from(before));
  });
});
