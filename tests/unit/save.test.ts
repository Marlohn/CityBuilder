/** Save e replay: abrir um save e continuar = mesma cidade de quem jogou direto. */
import { loadConfigAndData, loadScenario, runGame } from "@city/cli";
import { createGame, makeReplay, parseReplay, replayInto, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";

const scenario = loadScenario("bairro-basico");
const small = { world: { width: 160, height: 256 } };

function fingerprint(g: ReturnType<typeof createGame>) {
  const s = statsView(g);
  return {
    population: s.population,
    money: s.money,
    events: g.city.events.count,
    buildings: g.sim.buildings.count,
    vehicles: g.traffic.vehicles.count,
    tick: g.sim.clock.tick,
  };
}

describe("save e replay", () => {
  it("salvar, abrir e continuar dá a mesma cidade", () => {
    const { config, data } = loadConfigAndData(small);
    // Jogo A: 6 dias direto.
    const a = runGame({ config, data, seed: "save", days: 6, scenario });
    // Jogo B: 3 dias, salva, abre num jogo novo e continua 3 dias.
    const b = runGame({ config, data, seed: "save", days: 3, scenario });
    const text = JSON.stringify(makeReplay(b, small));
    const replay = parseReplay(text);
    const c = createGame({ config, data, seed: replay.seed });
    replayInto(c, replay);
    expect(fingerprint(c)).toEqual(fingerprint(b));
    c.sim.step(3 * c.sim.clock.ticksPerDay);
    expect(fingerprint(c)).toEqual(fingerprint(a));
  });

  it("recusa arquivo que não é save", () => {
    expect(() => parseReplay('{"hello": 1}')).toThrow(/não é um save/);
  });
});
