/**
 * Cidades de referência: o resultado de algumas cidades fica guardado (tests/unit/__snapshots__).
 * Se uma mudança no código mudar a cidade, este teste falha e mostra a diferença.
 *
 * - Mudança de propósito (regra nova, bug corrigido)? Atualize com `npm test -- tests/unit/reference -u`
 *   e explique no PR por que os números mudaram. O revisor aprova a mudança de propósito.
 * - Não era para mudar nada (refatoração, performance)? Então é bug: a cidade tem que ficar igual.
 */
import { loadConfigAndData, loadScenario, runGame } from "@city/cli";
import { type Game, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";

function fingerprint(game: Game) {
  const s = statsView(game);
  const { city, sim } = game;
  return {
    tick: sim.clock.tick,
    population: s.population,
    households: s.households,
    employed: s.employed,
    unemployed: s.unemployed,
    children: s.children,
    retired: s.retired,
    buildings: sim.buildings.count,
    cars: s.cars,
    money: Math.round(s.money),
    lastYear: { ...city.lastYear, migrantsTurnedAway: { ...city.lastYear.migrantsTurnedAway } },
    events: city.events.count,
    unmet: s.unmet,
  };
}

describe("cidades de referência", () => {
  it("cenário bairro-basico, 12 dias", () => {
    const scenario = loadScenario("bairro-basico");
    const { config, data } = loadConfigAndData({ ...scenario.overrides, world: { width: 160, height: 256 } });
    const game = runGame({ config, data, seed: "referencia", days: 12, scenario });
    expect(fingerprint(game)).toMatchSnapshot();
  });

  it("prefeito automático, 12 dias", () => {
    const { config, data } = loadConfigAndData();
    const game = runGame({ config, data, seed: "referencia-bot", days: 12, bot: true });
    expect(fingerprint(game)).toMatchSnapshot();
  });
});
