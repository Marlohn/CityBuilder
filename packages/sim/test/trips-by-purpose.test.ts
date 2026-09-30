/** Issue #40: viagens de ontem por motivo ficam nos contadores do motor (`city.lastYear`). */
import { describe, expect, it } from "vitest";
import { createTestGame } from "../../../tests/helpers";

function mainCity() {
  return createTestGame({
    seed: "avaliacao-livre",
    scenario: "bairro-basico",
    days: 40,
    bot: true,
    overrides: { economy: { mode: "sandbox" } },
  });
}

describe("viagens de ontem por motivo (issue #40)", () => {
  it("contadores de `city.lastYear` passam de zero e somam mais que os trabalhadores com carro", () => {
    const game = mainCity();
    const ly = game.city.lastYear;
    expect(ly.tripsWork, "nenhuma viagem de trabalho ontem").toBeGreaterThan(0);
    expect(ly.tripsSchool, "nenhuma viagem de escola ontem").toBeGreaterThan(0);
    expect(ly.tripsShopping, "nenhuma viagem de compras ontem").toBeGreaterThan(0);
    expect(ly.tripsHealth, "nenhuma viagem de saúde ontem").toBeGreaterThan(0);
    expect(ly.tripsLeisure, "nenhuma viagem de lazer ontem").toBeGreaterThan(0);
    expect(ly.tripsWalk, "nenhuma viagem a pé ontem").toBeGreaterThan(0);
    let drivers = 0;
    for (let p = 0; p < game.city.pop.count; p++) {
      if (game.city.pop.status[p] !== 1) continue;
      if (game.city.pop.job[p]! === -1) continue;
      const h = game.city.pop.household[p]!;
      if (h < 0) continue;
      if (game.city.hh.cars[h]! > 0) drivers++;
    }
    expect(drivers, "nenhum trabalhador com carro na cidade de referência").toBeGreaterThan(0);
    const total = ly.tripsWork + ly.tripsSchool + ly.tripsShopping + ly.tripsHealth + ly.tripsLeisure;
    expect(
      total,
      `soma das viagens de ontem (${total}) não passa dos trabalhadores com carro (${drivers})`,
    ).toBeGreaterThan(drivers);
  });
});
