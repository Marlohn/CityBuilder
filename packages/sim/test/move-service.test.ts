/** Mudar escola e UBS de lugar (issue #13). */
import { describe, expect, it } from "vitest";
import { createGame } from "../src/game";
import { loadDefaults } from "./helpers";

function cityWithSchool() {
  // Limite de 1 km (em vez de 2) só neste teste, para "longe" ficar bem claro no mapa pequeno.
  const { config, data } = loadDefaults({
    world: { width: 160, height: 160, water: { enabled: false } },
    economy: { mode: "sandbox" },
    education: { maxDistanceMeters: 1000 },
  });
  const game = createGame({ config, data, seed: "mover-servico" });
  const s = game.sim;
  const mid = 80;
  s.enqueue({ type: "buildRoad", kind: "street", x0: 40, y0: mid - 30, x1: 40, y1: mid });
  s.enqueue({ type: "buildRoad", kind: "avenue", x0: 40, y0: mid - 30, x1: 150, y1: mid - 30 });
  s.enqueue({ type: "zone", zone: "residential_low", x0: 41, y0: mid - 29, x1: 42, y1: mid - 1 });
  s.enqueue({ type: "zone", zone: "commercial", x0: 38, y0: mid - 29, x1: 39, y1: mid - 1 });
  // Rua do outro lado da escola (a escola de 5 x 6 fica entre as casas e esta rua).
  s.enqueue({ type: "buildRoad", kind: "street", x0: 48, y0: mid - 30, x1: 48, y1: mid });
  s.enqueue({ type: "placeService", service: "escola", x: 43, y: mid - 20 });
  s.step(8 * s.clock.ticksPerDay);
  s.drainResults();
  const school = [...Array(s.buildings.count).keys()].find(
    (b) => s.buildings.typeOf(b).service === "school",
  )!;
  return { game, school, mid };
}

function students(game: ReturnType<typeof createGame>, school: number) {
  let n = 0;
  for (let p = 0; p < game.city.pop.count; p++)
    if (game.city.pop.isAlive(p) && game.city.pop.school[p] === school) n++;
  return n;
}

describe("mover serviço", () => {
  it("perto: mesmos alunos, cobra a mudança; longe: quem ficou além do limite procura outra", () => {
    const { game, school, mid } = cityWithSchool();
    const s = game.sim;
    const before = students(game, school);
    expect(before, "a escola precisa ter alunos para o teste valer").toBeGreaterThan(0);
    const money0 = s.treasury.money;
    // Perto (do outro lado da rua): continua todo mundo.
    s.enqueue({ type: "moveService", building: school, x: 43, y: mid - 12 });
    s.step(1);
    const [near] = s.drainResults();
    expect(near?.ok, near?.reason).toBe(true);
    expect(near?.cost).toBe(Math.round(9_000_000 * s.config.economy.serviceMoveCostShare));
    expect(s.buildings.y[school]).toBe(mid - 12);
    expect(students(game, school)).toBe(before);
    expect(s.treasury.money).toBe(money0); // modo livre: não desconta
    // Longe (no fim da avenida, > 2 km): os alunos saem e procuram outra escola.
    s.enqueue({ type: "moveService", building: school, x: 140, y: mid - 29 });
    s.step(1);
    const [far] = s.drainResults();
    expect(far?.ok, far?.reason).toBe(true);
    expect(students(game, school)).toBe(0);
    // Os quadradinhos antigos ficaram livres.
    expect(s.world.buildingAt[s.world.idx(43, mid - 12)]).toBe(-1);
  });

  it("recusa mover casa, mover para cima de via e mover para longe de via", () => {
    const { game, school, mid } = cityWithSchool();
    const s = game.sim;
    const house = [...Array(s.buildings.count).keys()].find((b) => s.buildings.typeOf(b).id === "casa")!;
    s.enqueue({ type: "moveService", building: house, x: 60, y: 60 });
    s.enqueue({ type: "moveService", building: school, x: 38, y: mid - 29 });
    s.enqueue({ type: "moveService", building: school, x: 100, y: 120 });
    s.step(1);
    const [a, b, c] = s.drainResults();
    expect(a?.reason).toMatch(/só serviços/);
    expect(b?.reason).toMatch(/via|prédio/);
    expect(c?.reason).toMatch(/encostar numa via/);
  });
});
