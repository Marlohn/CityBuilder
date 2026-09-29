/** Água e luz (issue #15). */
import { describe, expect, it } from "vitest";
import { createGame, type Game } from "../src/game";
import { statsView } from "../src/view/stats";
import { BSTATE } from "../src/world/buildings";
import { loadDefaults } from "./helpers";

// Pequena de propósito: acaba antes dos lotes (a rua tem 40 lotes de casa).
const REGIONAL = 60;

function newCity(seed = "agua-luz") {
  const { config, data } = loadDefaults({
    world: { width: 128, height: 128, water: { enabled: false } },
    economy: { mode: "sandbox" },
    utilities: { regionalWater: REGIONAL, regionalPower: REGIONAL },
  });
  const game = createGame({ config, data, seed });
  const s = game.sim;
  const mid = 64;
  s.enqueue({ type: "buildRoad", kind: "street", x0: 30, y0: mid - 40, x1: 30, y1: mid });
  s.enqueue({ type: "zone", zone: "residential_low", x0: 31, y0: mid - 40, x1: 32, y1: mid - 1 });
  s.enqueue({ type: "zone", zone: "commercial", x0: 28, y0: mid - 40, x1: 29, y1: mid - 1 });
  // Rua de serviço (onde vão o poço e a subestação), ligada à rua principal.
  s.enqueue({ type: "buildRoad", kind: "street", x0: 30, y0: mid - 41, x1: 36, y1: mid - 41 });
  s.enqueue({ type: "buildRoad", kind: "street", x0: 36, y0: mid - 41, x1: 36, y1: mid - 30 });
  return game;
}

/** Consumo reservado por todos os prédios (pessoas equivalentes). */
function reserved(game: Game): number {
  const bs = game.sim.buildings;
  let d = 0;
  for (let b = 0; b < bs.count; b++) {
    if (bs.state[b] === BSTATE.demolished) continue;
    const t = bs.typeOf(b);
    if (t.service === "water" || t.service === "power") continue;
    d += game.utilities.demandOf(t.homes, t.jobs);
  }
  return d;
}

describe("água e luz", () => {
  it("a rede da região acaba: a construtora para; com um poço e uma subestação a cidade volta a crescer", () => {
    const game = newCity();
    const s = game.sim;
    s.step(3 * s.clock.ticksPerDay);
    const before = s.buildings.count;
    // Nunca passa da capacidade (no máximo o último prédio que coube).
    expect(reserved(game)).toBeLessThanOrEqual(REGIONAL);
    expect(before).toBeGreaterThan(0);
    s.step(2 * s.clock.ticksPerDay);
    expect(s.buildings.count, "sem água e luz sobrando, nada novo").toBe(before);
    s.drainResults();
    s.enqueue({ type: "placeService", service: "poco", x: 35, y: 26 });
    s.enqueue({ type: "placeService", service: "subestacao", x: 34, y: 28 });
    s.step(1);
    for (const r of s.drainResults()) expect(r.ok, r.reason).toBe(true);
    s.step(3 * s.clock.ticksPerDay);
    expect(s.buildings.count, "com poço e subestação, cresce de novo").toBeGreaterThan(before + 2);
    expect(statsView(game).unmet.water).toBe(0);
  });

  it("sem o poço, quem mora lá fica sem água (desejo não atendido) e o prédio não recebe mais ninguém", () => {
    const game = newCity("sem-agua");
    const s = game.sim;
    s.enqueue({ type: "placeService", service: "poco", x: 35, y: 26 });
    s.enqueue({ type: "placeService", service: "subestacao", x: 34, y: 28 });
    s.step(6 * s.clock.ticksPerDay);
    expect(statsView(game).population).toBeGreaterThan(0);
    // Demole o poço: a demanda passa da rede da região.
    s.enqueue({ type: "bulldoze", x0: 35, y0: 26, x1: 35, y1: 26 });
    s.step(2 * s.clock.ticksPerDay);
    const st = statsView(game);
    expect(st.unmet.water).toBeGreaterThan(0);
    const bs = s.buildings;
    for (let b = 0; b < bs.count; b++)
      if (bs.isActive(b) && !bs.hasWater[b]) expect(game.city.markets.housing.open.has(b)).toBe(false);
  });

  it("a estação de tratamento de água precisa ficar perto de rio ou lago", () => {
    const { config, data } = loadDefaults({ economy: { mode: "sandbox" } });
    const game = createGame({ config, data, seed: "eta" });
    const s = game.sim;
    const w = s.world;
    // Um quadradinho seco a 2 da água: via ao lado e ETA encostada.
    let spot = -1;
    for (let i = 0; i < w.size && spot < 0; i++) {
      const x = w.xOf(i);
      const y = w.yOf(i);
      if (w.water[i] || !w.inBounds(x - 5, y) || y + 4 >= w.height) continue;
      if (w.water[w.idx(x + 1, y)] && !w.water[w.idx(x - 4, y)]) spot = i;
    }
    const x = w.xOf(spot);
    const y = w.yOf(spot);
    s.enqueue({ type: "buildRoad", kind: "street", x0: x - 4, y0: y + 3, x1: x - 4, y1: y + 3 });
    s.enqueue({ type: "placeService", service: "eta", x: x - 3, y: y + 1 });
    s.enqueue({ type: "buildRoad", kind: "street", x0: 60, y0: 20, x1: 60, y1: 30 });
    s.enqueue({ type: "placeService", service: "eta", x: 61, y: 20 });
    s.step();
    const r = s.drainResults();
    const near = r[1]!;
    const far = r[3]!;
    expect(near.ok, near.reason).toBe(true);
    // Longe da água (se o lugar sorteado não cair perto de um lago).
    if (!far.ok) expect(far.reason).toMatch(/rio ou lago/);
  });
});
