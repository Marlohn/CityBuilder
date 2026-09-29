/**
 * Testes da cidade inteira (sem tela): regras que nunca podem quebrar, reprodutibilidade e
 * "ninguém surge do nada". Cada falha mostra a semente e o comando para reproduzir.
 */
import { loadConfigAndData, loadScenario, runGame } from "@city/cli";
import { checkInvariants, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";

const scenario = loadScenario("bairro-basico");
const small = { world: { width: 160, height: 256 } };

function run(seed: string, days: number, check?: (day: number, violations: string[]) => void) {
  const { config, data } = loadConfigAndData(small);
  return runGame({
    config,
    data,
    seed,
    days,
    scenario,
    onDay: (g, d) => check?.(d, checkInvariants(g.city)),
  });
}

describe("regras que nunca quebram", () => {
  for (const seed of ["a", "b", "c", "d"]) {
    it(`semente "${seed}": nenhuma violação em 12 anos`, () => {
      run(seed, 12, (day, v) => {
        expect(
          v,
          `dia ${day}. Reproduzir: npm run sim -- report --scenario=bairro-basico --seed=${seed} --days=${day}`,
        ).toEqual([]);
      });
    });
  }
});

describe("reprodutibilidade", () => {
  it("mesma semente e mesmos comandos = mesma cidade", () => {
    const a = run("mesma", 6);
    const b = run("mesma", 6);
    const sa = statsView(a);
    const sb = statsView(b);
    expect(sa.population).toBe(sb.population);
    expect(sa.money).toBe(sb.money);
    expect(Buffer.from(a.city.pop.birthTick.buffer).equals(Buffer.from(b.city.pop.birthTick.buffer))).toBe(
      true,
    );
    expect(a.city.events.count).toBe(b.city.events.count);
  });

  it("sementes diferentes geram cidades diferentes", () => {
    expect(statsView(run("x1", 6)).population).not.toBe(statsView(run("x2", 6)).population);
  });
});

describe("a cidade vive", () => {
  it("chegam moradores, nascem crianças, pessoas trabalham e estudam", () => {
    const g = run("vida", 15);
    const s = statsView(g);
    expect(s.population).toBeGreaterThan(500);
    expect(s.employed).toBeGreaterThan(200);
    expect(s.students).toBeGreaterThan(50);
    expect(g.city.lastYear.births + g.city.year.births).toBeGreaterThan(0);
  });

  it("população = chegadas + nascimentos - mortes - saídas", () => {
    const g = run("conta", 8);
    const { pop, events } = g.city;
    let arrivals = 0;
    let births = 0;
    let deaths = 0;
    let left = 0;
    for (let e = 0; e < events.count; e++) {
      const t = events.type[e];
      if (t === 1) arrivals++;
      else if (t === 2) births++;
      else if (t === 3) deaths++;
      else if (t === 13) left++;
    }
    expect(arrivals + births - deaths - left).toBe(pop.aliveCount);
  });
});
