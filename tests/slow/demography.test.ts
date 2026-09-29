/**
 * Coorte de 10 mil bebês acompanhada até todos morrerem, usando o MESMO código anual do jogo.
 * Prova de ponta a ponta: a vida média e a mortalidade infantil batem com o IBGE 2023.
 * (Casamento, trabalho, migração e saída de casa desligados para isolar a mortalidade.)
 */
import { loadConfigAndData } from "@city/cli";
import { createGame, joinHousehold, newPerson } from "@city/sim";
import { describe, expect, it } from "vitest";

describe("coorte de 10 mil bebês (mortalidade de ponta a ponta)", () => {
  it("vida média ≈ 76,4 anos e mortalidade infantil ≈ 12,5 por mil (IBGE 2023)", () => {
    const { config, data } = loadConfigAndData({
      world: { width: 32, height: 32, startingRoad: { enabled: false } },
      population: { immigration: { enabled: false } },
      lifecycle: {
        marriage: { hazardByAge: { "0": 0 } },
        labor: { participation: 0 },
        leaveParentsHome: { annualChance: 0 },
      },
      health: { uncoveredMortalityMultiplier: 1 },
    });
    const game = createGame({ config, data, seed: "coorte" });
    const { city, sim } = game;
    // Mães fictícias de 30 anos, uma família para cada 50 bebês (cada família precisa de um adulto).
    const cohort: number[] = [];
    const N = 10_000;
    const tpd = sim.clock.ticksPerDay;
    let h = -1;
    for (let i = 0; i < N; i++) {
      if (i % 50 === 0) {
        h = city.hh.create();
        const mom = newPerson(city, {
          sex: 0,
          birthTick: sim.clock.tick - 30 * tpd,
          first: 0,
          surnameA: 0,
          surnameB: 0,
        });
        city.pop.laborWilling[mom] = 2;
        joinHousehold(city, mom, h);
      }
      const male = i % 205 < 105;
      const p = newPerson(city, {
        sex: male ? 1 : 0,
        birthTick: sim.clock.tick,
        first: 0,
        surnameA: 0,
        surnameB: 0,
      });
      joinHousehold(city, p, h);
      cohort.push(p);
    }
    // Acompanha até todos morrerem (máximo 111 anos).
    const deathAge = new Map<number, number>();
    for (let day = 0; day < 112 && deathAge.size < N; day++) {
      sim.step(tpd);
      for (const p of cohort) {
        if (!deathAge.has(p) && city.pop.status[p] !== 1) {
          // Idade registrada no cartório no momento da morte (evento "faleceu", campo a).
          const evs = city.events.of(p);
          const last = evs[evs.length - 1]!;
          deathAge.set(p, city.pop.status[p] === 2 ? city.events.a[last]! : -1);
        }
      }
    }
    const left = [...deathAge.values()].filter((a) => a < 0).length;
    // Quem foi embora sai da amostra (não morreu aqui).
    const died = [...deathAge.values()].filter((a) => a >= 0);
    // Só órfãos sem avós na cidade vão morar com parentes fora (mãe morreu antes dos 18 do filho).
    expect(left, "quase ninguém da coorte deveria ir embora com migração desligada").toBeLessThan(N * 0.1);
    const infant = died.filter((a) => a <= 1).length;
    const mean = died.reduce((s, a) => s + a, 0) / died.length;
    // Morte no aniversário de `a` anos = morreu durante o ano (a-1, a): em média viveu a - 0,5.
    const meanLifespan = mean - 0.5;
    expect(died.length + left, "todos da coorte deveriam ter morrido (ou saído) em 111 anos").toBe(N);
    expect(meanLifespan).toBeGreaterThan(75.0);
    expect(meanLifespan).toBeLessThan(77.8);
    expect((infant / N) * 1000).toBeGreaterThan(9);
    expect((infant / N) * 1000).toBeLessThan(16);
  }, 180_000);
});
