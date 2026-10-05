/**
 * Regressão da #293: `seekHospital` representa o episódio anual atual, não um histórico vitalício.
 *
 * A taxa hospitalAdmissionRatePerYear é sorteada uma vez por aniversário. Se uma pessoa ficou
 * na fila no ciclo anterior e o novo sorteio é negativo, o pedido antigo precisa desaparecer.
 * A semente é fixa para congelar esse sorteio negativo sem usar relógio nem Math.random.
 */
import { loadConfigAndData } from "@city/cli";
import { createGame, newPerson } from "@city/sim";
import { describe, expect, it } from "vitest";

describe("issue #293: pedido anual de internação", () => {
  it("substitui o pedido antigo pelo sorteio do novo ano", () => {
    const { config, data } = loadConfigAndData({
      economy: { mode: "sandbox" },
      population: { immigration: { enabled: false } },
      health: { hospitalAdmissionRatePerYear: 0.0001 },
    });
    const game = createGame({ config, data, seed: "hospital-pedido-anual-293" });
    const { city, sim } = game;
    const tpd = sim.clock.ticksPerDay;

    // Nascido exatamente no mesmo slot do relógio: o primeiro sim.step roda seu aniversário.
    const p = newPerson(city, {
      sex: 0,
      birthTick: sim.clock.tick - 20 * tpd,
      first: 0,
      surnameA: 0,
      surnameB: 0,
    });
    city.pop.laborWilling[p] = 2;

    // Este pedido representa o episódio do ciclo anual anterior.
    city.seekHospital.add(p);
    expect(city.seekHospital.has(p)).toBe(true);

    sim.step(1);

    expect(city.pop.isAlive(p), "a pessoa precisa sobreviver").toBe(true);
    expect(city.seekHospital.has(p), "pedido antigo não pode permanecer").toBe(false);
  });
});
