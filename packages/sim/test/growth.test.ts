/** Crescimento: construtora só constrói onde a rua chega na estrada de fora do mapa. */
import { describe, expect, it } from "vitest";
import { createGame } from "../src/game";
import { loadDefaults } from "./helpers";

describe("crescimento", () => {
  it("não constrói em rua solta (sem ligação com a estrada); constrói na rua ligada", () => {
    const { config, data } = loadDefaults({ world: { width: 128, height: 128 } });
    const game = createGame({ config, data, seed: "rua-solta" });
    const { sim } = game;
    const mid = Math.floor(config.world.height / 2);
    // Rua ligada: sai da avenida inicial para cima.
    sim.enqueue({ type: "buildRoad", kind: "street", x0: 30, y0: mid - 12, x1: 30, y1: mid });
    sim.enqueue({ type: "zone", zone: "residential_low", x0: 31, y0: mid - 12, x1: 32, y1: mid - 1 });
    // Rua solta, longe de tudo.
    sim.enqueue({ type: "buildRoad", kind: "street", x0: 90, y0: 10, x1: 90, y1: 22 });
    sim.enqueue({ type: "zone", zone: "residential_low", x0: 91, y0: 10, x1: 92, y1: 22 });
    sim.step(2 * sim.clock.ticksPerDay);
    let connected = 0;
    let loose = 0;
    for (let b = 0; b < sim.buildings.count; b++) {
      const x = sim.world.xOf(sim.buildings.access[b]!);
      if (x === 30) connected++;
      if (x === 90) loose++;
    }
    expect(connected).toBeGreaterThan(0);
    expect(loose).toBe(0);
  });
});
