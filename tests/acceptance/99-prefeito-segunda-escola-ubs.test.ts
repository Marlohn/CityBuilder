/**
 * Issue #99 — o prefeito automático não constrói a segunda escola/UBS quando a primeira lota.
 *
 * O `placeServiceNearDemand` (`packages/bots/src/mayor.ts`) desiste de construir quando já
 * existe um prédio do mesmo tipo a menos de 60 quadradinhos do ponto escolhido, sem conferir
 * se o prédio existente ainda tem vaga. Com a primeira escola lotada
 * (`students === studentsCapacity`) ou a primeira UBS lotada (`patients === patientsCapacity`),
 * a demanda continua crescendo (crianças sem escola, pessoas sem UBS) mas o prefeito não
 * constrói a segunda — só muito depois, quando a cidade já cresceu para longe.
 *
 * Este teste trava a regra: escola ou UBS lotada não conta como "já tem serviço por perto",
 * então com a primeira lotada o prefeito tem que colocar a segunda. Semente fixa, sem
 * relógio e sem `Math.random`. Roda dia a dia com `createRun` para poder parar no dia exato.
 */
import { createRun, loadConfigAndData } from "@city/cli";
import { BSTATE, checkInvariants, currentCensus, type Game } from "@city/sim";
import { describe, expect, it } from "vitest";

/** Cidade de referência da issue: cidade vazia construída pelo prefeito, dinheiro infinito. */
const SEED = "avaliacao-livre";
const DAYS = 40;
const OVERRIDES = { economy: { mode: "sandbox" } };

/** Roda o bot do zero até o dia pedido e devolve o jogo naquele dia. */
const gamesPorDia = new Map<number, Game>();
function gameNoDia(dia: number): Game {
  const pronto = gamesPorDia.get(dia);
  if (pronto) return pronto;
  const { config, data } = loadConfigAndData(OVERRIDES);
  const run = createRun({ config, data, seed: SEED, days: DAYS, bot: true });
  while (run.game.sim.clock.day < dia) {
    if (!run.nextDay()) break;
  }
  gamesPorDia.set(dia, run.game);
  return run.game;
}

/** Prédios de um tipo do catálogo que não foram demolidos (valem como "existe"). */
function prediosDoTipo(game: Game, id: string): number[] {
  const b = game.sim.buildings;
  const out: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (b.typeOf(i).id !== id || b.state[i] === BSTATE.demolished) continue;
    out.push(i);
  }
  return out;
}

describe("issue #99: prefeito constrói a segunda escola e a segunda UBS quando a primeira lota", () => {
  it("a cidade do teste tem uma escola e uma UBS ativas e depois lotadas", { timeout: 600000 }, () => {
    const game = gameNoDia(25);
    const b = game.sim.buildings;
    const escolas = prediosDoTipo(game, "escola").filter((id) => b.state[id] === BSTATE.active);
    const ubs = prediosDoTipo(game, "ubs").filter((id) => b.state[id] === BSTATE.active);
    expect(
      escolas.length,
      `a cidade do teste deveria ter 1 escola ativa aos 25 dias, mas tem ${escolas.length}: ` +
        `sem esse cenário o teste não prova nada`,
    ).toBe(1);
    expect(
      ubs.length,
      `a cidade do teste deveria ter 1 UBS ativa aos 25 dias, mas tem ${ubs.length}: ` +
        `sem esse cenário o teste não prova nada`,
    ).toBe(1);
    const e = escolas[0]!;
    expect(
      b.students[e],
      `a escola do teste deveria estar lotada aos 25 dias (students === studentsCapacity), ` +
        `mas tem ${b.students[e]} alunos para ${b.studentsCapacity(e)} vagas: ` +
        `sem lotação o teste não prova nada`,
    ).toBe(b.studentsCapacity(e));
    const u = ubs[0]!;
    expect(
      b.patients[u],
      `a UBS do teste deveria estar lotada aos 25 dias (patients === patientsCapacity), ` +
        `mas tem ${b.patients[u]} pacientes para ${b.patientsCapacity(u)} vagas: ` +
        `sem lotação o teste não prova nada`,
    ).toBe(b.patientsCapacity(u));
  });

  it("com a primeira escola lotada, o prefeito constrói uma segunda escola", { timeout: 600000 }, () => {
    const game = gameNoDia(30);
    const escolas = prediosDoTipo(game, "escola");
    expect(
      escolas.length,
      `com a primeira escola lotada desde o dia 25, aos 30 dias era esperado pelo menos 2 escolas, ` +
        `mas só existe ${escolas.length}: o prefeito não constrói a segunda porque a primeira, ` +
        `mesmo lotada, conta como "já tem escola por perto"`,
    ).toBeGreaterThanOrEqual(2);
  });

  it("com a primeira UBS lotada, o prefeito constrói uma segunda UBS", { timeout: 600000 }, () => {
    const game = gameNoDia(30);
    const ubs = prediosDoTipo(game, "ubs");
    expect(
      ubs.length,
      `com a primeira UBS lotada desde o dia 25, aos 30 dias era esperado pelo menos 2 UBS, ` +
        `mas só existe ${ubs.length}: o prefeito não constrói a segunda porque a primeira, ` +
        `mesmo lotada, conta como "já tem UBS por perto"`,
    ).toBeGreaterThanOrEqual(2);
  });

  it("a cidade do teste não precisa de mais serviço que a capacidade dupla", { timeout: 600000 }, () => {
    const game = gameNoDia(15);
    const b = game.sim.buildings;
    const escolas = prediosDoTipo(game, "escola");
    const ubs = prediosDoTipo(game, "ubs");
    expect(
      escolas.length,
      `aos 15 dias era esperada exatamente 1 escola (a primeira ainda tinha vaga), ` +
        `mas existem ${escolas.length}`,
    ).toBe(1);
    expect(
      ubs.length,
      `aos 15 dias era esperada exatamente 1 UBS (a primeira ainda tinha vaga), ` +
        `mas existem ${ubs.length}`,
    ).toBe(1);
    expect(
      b.students[escolas[0]!],
      `aos 15 dias a primeira escola deveria ainda ter vaga ` +
        `(students < studentsCapacity), mas tem ${b.students[escolas[0]!]} alunos para ` +
        `${b.studentsCapacity(escolas[0]!)} vagas`,
    ).toBeLessThan(b.studentsCapacity(escolas[0]!));
    expect(
      b.patients[ubs[0]!],
      `aos 15 dias a primeira UBS deveria ainda ter vaga ` +
        `(patients < patientsCapacity), mas tem ${b.patients[ubs[0]!]} pacientes para ` +
        `${b.patientsCapacity(ubs[0]!)} vagas`,
    ).toBeLessThan(b.patientsCapacity(ubs[0]!));
  });

  it("no fim dos 40 dias poucas crianças ficam sem escola", { timeout: 600000 }, () => {
    const game = gameNoDia(40);
    const c = currentCensus(game);
    expect(
      c.children6to17,
      `a cidade do teste deveria ter crianças de 6 a 17 anos aos 40 dias para a conta fazer sentido`,
    ).toBeGreaterThan(0);
    expect(
      c.childrenWithoutSchool,
      `${c.childrenWithoutSchool} de ${c.children6to17} crianças de 6 a 17 anos estão sem escola ` +
        `aos 40 dias (esperado menos de 10%): com a primeira escola lotada o prefeito ` +
        `não construiu a segunda a tempo`,
    ).toBeLessThan(c.children6to17 * 0.1);
  });

  it("no fim dos 40 dias poucas pessoas ficam sem UBS", { timeout: 600000 }, () => {
    const game = gameNoDia(40);
    const c = currentCensus(game);
    expect(
      c.population,
      `a cidade do teste deveria ter gente aos 40 dias para a conta fazer sentido`,
    ).toBeGreaterThan(0);
    expect(
      c.withoutClinic,
      `${c.withoutClinic} de ${c.population} pessoas estão sem UBS aos 40 dias ` +
        `(esperado menos de 10%): com a primeira UBS lotada o prefeito não construiu ` +
        `a segunda a tempo`,
    ).toBeLessThan(c.population * 0.1);
  });

  it("nada quebra junto", { timeout: 600000 }, () => {
    const game = gameNoDia(40);
    expect(checkInvariants(game.city), `regras que nunca podem quebrar foram violadas aos 40 dias`).toEqual(
      [],
    );
    expect(currentCensus(game).population, `a cidade esvaziou aos 40 dias`).toBeGreaterThan(0);
  });
});
