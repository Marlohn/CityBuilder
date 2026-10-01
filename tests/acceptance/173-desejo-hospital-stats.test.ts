/**
 * Teste de aceitação da issue #173 (papel QA).
 *
 * Hoje `statsView(game).unmet` (packages/sim/src/view/stats.ts) tem as chaves
 * school, university, health, housing, job, transit, parking, water e power,
 * mas não tem `hospital`. O censo (`currentCensus`, via people/census.ts) JÁ
 * conta `withoutHospital` (pessoas sem leito de hospital) e `withoutClinic`.
 *
 * A regra pedida: `unmet` ganha a chave `hospital` valendo exatamente
 * `currentCensus(game).withoutHospital`, enquanto `unmet.health` continua
 * valendo `withoutClinic` (nada de reaproveitar a chave do sem-UBS).
 *
 * Este teste deve falhar na `main` porque a chave `hospital` não existe
 * no contrato/stats (vem `undefined`).
 *
 * Cenário: as duas cidades usam `health.maxDistanceMeters: 200` e demolem
 * a UBS do cenário (`bulldoze` em x 73-74, y 141-142, como no teste 119).
 * Sem isso a UBS do cenário atende todo mundo a 15 km, o hospital nunca
 * registra leito (`withoutHospital` vale a população inteira nas duas
 * cidades) e `withoutClinic` fica 0 nas duas (critério 3 trivial). Com a
 * UBS fora de alcance, o hospital de fato registra leito e o critério 3
 * fica não-trivial (sem hospital, `withoutClinic` vale a população).
 *
 * Um `it` por critério do "tá pronto quando":
 * 1. sem hospital, `unmet.hospital` vale `withoutHospital`;
 * 2. com hospital, `unmet.hospital` vale `withoutHospital` e é MENOR que
 *    na cidade sem hospital (prova que o contador reage ao hospital);
 * 3. `unmet.health` continua valendo `withoutClinic` nas duas cidades.
 *
 * Semente fixa única para as duas cidades (só muda a lista de comandos),
 * sem relógio, sem `Math.random`. Cada cidade é simulada uma única vez
 * (`Map` memoizado no escopo do arquivo).
 */
import type { Command } from "@city/contract";
import { currentCensus, type Game, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** Chave nova esperada no `unmet` (ainda não existe no contrato): acesso tolerante. */
interface UnmetWithHospital {
  hospital?: unknown;
  health?: unknown;
}

function unmet(game: Game): UnmetWithHospital {
  return statsView(game).unmet as unknown as UnmetWithHospital;
}

/** Semente fixa única do arquivo (nada de relógio nem `Math.random`). */
const SEED = "desejo-hospital-stats";
/** Dias de jogo (o hospital leva 30 meses de obra = 2,5 dias, então 40 basta). */
const DAYS = 40;

/** Demole a UBS do cenário (x de 73 a 74, y de 141 a 142, como no teste 119). */
const BULLDOZE_UBS: Command = { type: "bulldoze", x0: 73, y0: 141, x1: 74, y1: 142 };

/** Quatro hospitais lado a lado (mesmos do teste 119, para ter leito de sobra). */
const HOSPITAL_COMMANDS: Command[] = [
  { type: "placeService", service: "hospital", x: 76, y: 141 },
  { type: "placeService", service: "hospital", x: 84, y: 141 },
  { type: "placeService", service: "hospital", x: 92, y: 141 },
  { type: "placeService", service: "hospital", x: 100, y: 141 },
];

/** Cidades já rodadas (não roda a mesma cidade duas vezes). */
const jogos = new Map<string, Game>();

/** Mesma cidade com ou sem hospital (o bulldoze da UBS vai na frente; só muda o resto). */
function cidade(comHospital: boolean): Game {
  const chave = comHospital ? "com-hospital" : "sem-hospital";
  const pronto = jogos.get(chave);
  if (pronto) return pronto;
  const game = createTestGame({
    seed: SEED,
    scenario: "bairro-basico",
    days: DAYS,
    overrides: { economy: { mode: "sandbox" }, health: { maxDistanceMeters: 200 } },
    commands: comHospital ? [BULLDOZE_UBS, ...HOSPITAL_COMMANDS] : [BULLDOZE_UBS],
  });
  jogos.set(chave, game);
  return game;
}

describe("issue #173: desejo não atendido 'hospital' no contrato e no stats", () => {
  it("sem hospital, unmet.hospital vale withoutHospital", { timeout: 300000 }, () => {
    const game = cidade(false);
    const census = currentCensus(game);
    expect(
      census.population,
      `a cidade sem hospital esvaziou (população 0): sem gente o teste não prova nada`,
    ).toBeGreaterThan(0);
    expect(
      census.withoutHospital,
      `sem nenhum hospital era esperado withoutHospital maior que 0 (há ${census.population} ` +
        `pessoas na cidade), mas veio 0: sem gente sem leito o teste não prova nada`,
    ).toBeGreaterThan(0);
    const hospital = unmet(game).hospital;
    expect(
      typeof hospital,
      `a chave \`hospital\` não existe em statsView(game).unmet (packages/sim/src/view/stats.ts ` +
        `nem no contrato packages/contract/src/view.ts): sem ela a tela não mostra o desejo não atendido`,
    ).toBe("number");
    if (typeof hospital !== "number") return;
    expect(
      hospital,
      `sem hospital era esperado unmet.hospital igual a withoutHospital (${census.withoutHospital}), ` +
        `mas veio ${hospital}`,
    ).toBe(census.withoutHospital);
  });

  it("com hospital, unmet.hospital vale withoutHospital e é menor que sem hospital", {
    timeout: 300000,
  }, () => {
    const sem = cidade(false);
    const com = cidade(true);
    const censusSem = currentCensus(sem);
    const censusCom = currentCensus(com);
    expect(
      censusCom.population,
      `a cidade com hospital esvaziou (população 0): sem gente o teste não prova nada`,
    ).toBeGreaterThan(0);
    expect(
      censusSem.withoutHospital,
      `sem nenhum hospital era esperado withoutHospital maior que 0 (há ${censusSem.population} ` +
        `pessoas na cidade), mas veio 0: sem gente sem leito o teste não prova nada`,
    ).toBeGreaterThan(0);
    const semHospital = unmet(sem).hospital;
    expect(
      typeof semHospital,
      `a chave \`hospital\` não existe em statsView(game).unmet (packages/sim/src/view/stats.ts ` +
        `nem no contrato packages/contract/src/view.ts): sem ela a tela não mostra o desejo não atendido`,
    ).toBe("number");
    if (typeof semHospital !== "number") return;
    const comHospital = unmet(com).hospital;
    expect(
      typeof comHospital,
      `a chave \`hospital\` não existe em statsView(game).unmet (packages/sim/src/view/stats.ts ` +
        `nem no contrato packages/contract/src/view.ts): sem ela a tela não mostra o desejo não atendido`,
    ).toBe("number");
    if (typeof comHospital !== "number") return;
    expect(
      comHospital,
      `com hospital era esperado unmet.hospital igual a withoutHospital (${censusCom.withoutHospital}), ` +
        `mas veio ${comHospital}`,
    ).toBe(censusCom.withoutHospital);
    expect(
      comHospital,
      `com hospital (${comHospital} sem leito) o desejo não atendido deveria ser MENOR que sem ` +
        `hospital (${semHospital}): o contador não está reagindo ao hospital`,
    ).toBeLessThan(semHospital);
  });

  it("unmet.health continua valendo withoutClinic nas duas cidades", { timeout: 300000 }, () => {
    for (const comHospital of [false, true]) {
      const game = cidade(comHospital);
      const census = currentCensus(game);
      const rotulo = comHospital ? "com hospital" : "sem hospital";
      const health = unmet(game).health;
      expect(
        typeof health,
        `na cidade ${rotulo} a chave \`health\` sumiu de statsView(game).unmet: ` +
          `ela tem que continuar existindo e valendo withoutClinic`,
      ).toBe("number");
      expect(
        health,
        `na cidade ${rotulo} era esperado unmet.health igual a withoutClinic ` +
          `(${census.withoutClinic}), mas veio ${health}: a chave do sem-UBS não pode mudar`,
      ).toBe(census.withoutClinic);
    }
  });
});
