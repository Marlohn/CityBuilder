/**
 * Issue #119 — o hospital é o SEGUNDO NÍVEL de saúde (a UBS continua como primeiro nível).
 *
 * O que a issue pede no motor (`packages/sim`), ainda faltando hoje:
 * - `people/population.ts`: campo novo `pop.hospital` (um leito por pessoa, como `pop.clinic`),
 *   preenchido em `people/actions.ts` (registrar/soltar, como `registerClinic`);
 * - `systems/matching.ts` (`clinics`): sem vaga na UBS perto (até `maxDistanceMeters`, 2 km),
 *   tenta o hospital até `hospitalMaxDistanceMeters` (15 km); quem tem UBS perto não gasta leito;
 * - `systems/lifecycle.ts`: quem tem leito (`pop.hospital[p] >= 0`) morre menos
 *   (multiplicador `1 - hospitalMortalityReduction`, hoje 0.15, sobre o risco anual);
 * - `people/census.ts`: conta `withoutHospital` e amostra `samples.hospital` para o roadmap.
 * A config (`config/health.yaml`) e o prédio (`hospital`, 90 leitos) já existem (issue #118).
 *
 * Por que cada `it` existe (um por critério da issue):
 * 1. UBS perto com vaga não gasta leito: o hospital é só reserva, não primeira opção.
 * 2. Sem UBS no alcance, o hospital a até 15 km ainda registra: o alcance maior funciona.
 * 3. O censo conta quem está sem leito e amostra os locais: alimenta o roadmap.
 * 4. Quem tem leito morre menos: a proteção do segundo nível aparece na mortalidade.
 * 5. Nada quebra junto: invariantes e população de pé.
 *
 * Semente fixa, sem relógio, sem `Math.random`. As cidades ficam num `Map` memoizado
 * para não rodar a mesma simulação duas vezes.
 */
import { createRun, loadConfigAndData, loadScenario, runGame } from "@city/cli";
import { BSTATE, checkInvariants, currentCensus, type Game, joinHousehold, newPerson } from "@city/sim";
import { describe, expect, it } from "vitest";
import { EV } from "../../packages/sim/src/people/events";

/** Campo novo da issue #119, ainda ausente no motor: acesso tolerante via tipo local. */
interface PopWithHospital {
  hospital?: Int32Array;
}

/** Campos novos do censo da issue #119, ainda ausentes no motor. */
interface CensusWithHospital {
  population: number;
  withoutClinic: number;
  withoutHospital?: unknown;
  samples: Record<string, number[] | undefined>;
}

/** Semente fixa do arquivo (nada de relógio nem `Math.random`). */
const SEED = "hospital-segundo-nivel";
/** Dias de jogo das cidades do cenário (o hospital leva 30 meses de obra = 2,5 dias). */
const DAYS = 80;

/** Cidades já rodadas (não roda a mesma cidade duas vezes). */
const jogos = new Map<string, Game>();

/** Prédios de um tipo do catálogo que estão funcionando (state active). */
function prediosAtivos(game: Game, id: string): number[] {
  const b = game.sim.buildings;
  const out: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (b.typeOf(i).id !== id) continue;
    if (b.state[i] !== BSTATE.active) continue;
    out.push(i);
  }
  return out;
}

/** Pessoas vivas com leito (`leitos[p] >= 0`). Chamar só com `pop.hospital` existindo. */
function contaComLeito(game: Game, leitos: Int32Array): number {
  const pop = game.city.pop;
  let n = 0;
  for (let p = 0; p < pop.count; p++) {
    if (pop.status[p] !== 1) continue; // 1 = vivo (PSTATUS.alive)
    if (leitos[p]! >= 0) n++;
  }
  return n;
}

/** Idade ao morrer pelo evento de morte (EV.died), ou null se a pessoa não morreu aqui. */
function idadeAoMorrer(game: Game, p: number): number | null {
  const eventos = game.city.events.of(p);
  for (const e of eventos) {
    if (game.city.events.type[e] === EV.died) return game.city.events.a[e]!;
  }
  return null;
}

/** Cenário bairro-basico com dinheiro infinito, mais um hospital (aplica `scenario.overrides`). */
function cidadeComUbs(): Game {
  const pronto = jogos.get("com-ubs");
  if (pronto) return pronto;
  const scenario = loadScenario("bairro-basico");
  const { config, data } = loadConfigAndData({
    ...scenario.overrides,
    economy: { mode: "sandbox" },
  });
  const game = runGame({
    config,
    data,
    seed: SEED,
    days: DAYS,
    scenario,
    commands: [
      { type: "placeService", service: "hospital", x: 76, y: 141 },
      { type: "placeService", service: "hospital", x: 84, y: 141 },
      { type: "placeService", service: "hospital", x: 92, y: 141 },
      { type: "placeService", service: "hospital", x: 100, y: 141 },
    ],
  });
  jogos.set("com-ubs", game);
  return game;
}

/**
 * Mesma cidade, mas a UBS some do alcance: override de 200 m (`health.maxDistanceMeters`)
 * e a UBS do cenário demolida (x de 73 a 74, y de 141 a 142). Com hospital ou sem,
 * conforme o parâmetro (o bulldoze entra antes do placeService nos comandos).
 */
function cidadeSemUbs(comHospital: boolean): Game {
  const chave = comHospital ? "sem-ubs-com-hospital" : "sem-ubs-sem-hospital";
  const pronto = jogos.get(chave);
  if (pronto) return pronto;
  const scenario = loadScenario("bairro-basico");
  const { config, data } = loadConfigAndData({
    ...scenario.overrides,
    economy: { mode: "sandbox" },
    health: { maxDistanceMeters: 200 },
  });
  const game = runGame({
    config,
    data,
    seed: SEED,
    days: DAYS,
    scenario,
    commands: comHospital
      ? [
          { type: "bulldoze", x0: 73, y0: 141, x1: 74, y1: 142 },
          { type: "placeService", service: "hospital", x: 76, y: 141 },
          { type: "placeService", service: "hospital", x: 84, y: 141 },
          { type: "placeService", service: "hospital", x: 92, y: 141 },
          { type: "placeService", service: "hospital", x: 100, y: 141 },
        ]
      : [{ type: "bulldoze", x0: 73, y0: 141, x1: 74, y1: 142 }],
  });
  jogos.set(chave, game);
  return game;
}

describe("issue #119: hospital é o segundo nível de saúde", () => {
  it("quem tem vaga na UBS perto não gasta leito do hospital", { timeout: 300000 }, () => {
    const game = cidadeComUbs();
    const b = game.sim.buildings;
    const ubs = prediosAtivos(game, "ubs");
    expect(
      ubs.length,
      `era esperada pelo menos 1 UBS ativa no cenário bairro-basico, mas há ${ubs.length}: ` +
        `sem UBS o teste não prova nada`,
    ).toBeGreaterThanOrEqual(1);
    const u = ubs[0]!;
    expect(
      b.patients[u]!,
      `a UBS ${u} deveria ter vaga (patients < patientsCapacity), mas tem ${b.patients[u]} ` +
        `pacientes para ${b.patientsCapacity(u)} vagas: sem vaga sobrando o teste não prova nada`,
    ).toBeLessThan(b.patientsCapacity(u));
    const hospitais = prediosAtivos(game, "hospital");
    expect(
      hospitais.length,
      `era esperado pelo menos 1 hospital ativo (quatro hospitais em x=76, 84, 92 e 100 (y=141)), ` +
        `mas há ${hospitais.length}: sem hospital o teste não prova nada`,
    ).toBeGreaterThanOrEqual(1);
    const pop = game.city.pop as PopWithHospital & typeof game.city.pop;
    expect(
      typeof pop.hospital,
      `o motor ainda não tem o campo pop.hospital ` +
        `(packages/sim/src/people/population.ts, preenchido em people/actions.ts): ` +
        `sem ele ninguém registra leito de hospital`,
    ).not.toBe("undefined");
    if (pop.hospital === undefined) return;
    const n = contaComLeito(game, pop.hospital);
    expect(
      n,
      `era esperado 0 pessoas com leito de hospital (a UBS perto tem vaga para todo mundo), ` +
        `mas ${n} pessoas estão com pop.hospital >= 0: quem tem UBS perto está gastando leito à toa`,
    ).toBe(0);
  });

  it("sem UBS a menos de 2 km, o leito do hospital a até 15 km ainda registra", { timeout: 300000 }, () => {
    const game = cidadeSemUbs(true);
    const b = game.sim.buildings;
    let ubs = -1;
    for (let i = 0; i < b.count; i++) {
      if (b.typeOf(i).id !== "ubs") continue;
      ubs = i;
      break;
    }
    expect(
      ubs,
      `era esperado 1 prédio ubs no cenário bairro-basico (placeService ubs em x=73, y=141), ` +
        `mas não há nenhum: sem UBS o teste não prova nada`,
    ).toBeGreaterThanOrEqual(0);
    if (ubs < 0) return;
    expect(
      b.state[ubs],
      `a UBS ${ubs} deveria estar demolida (state ${BSTATE.demolished}), mas está com state ` +
        `${b.state[ubs]}: sem demolir a UBS o teste não prova nada`,
    ).toBe(BSTATE.demolished);
    expect(
      game.sim.config.health.maxDistanceMeters,
      `o override do cenário deveria fixar health.maxDistanceMeters em 200 m, mas veio ` +
        `${game.sim.config.health.maxDistanceMeters} m: sem o alcance curto o teste não prova nada`,
    ).toBe(200);
    const pop = game.city.pop as PopWithHospital & typeof game.city.pop;
    expect(
      typeof pop.hospital,
      `o motor ainda não tem o campo pop.hospital ` +
        `(packages/sim/src/people/population.ts, preenchido em people/actions.ts): ` +
        `sem ele o hospital não registra ninguém`,
    ).not.toBe("undefined");
    if (pop.hospital === undefined) return;
    const n = contaComLeito(game, pop.hospital);
    expect(
      n,
      `era esperado mais de 0 pessoas com leito (a UBS sumiu do alcance e o hospital alcança ` +
        `15 km), mas veio ${n}: o alcance maior do hospital não registrou ninguém`,
    ).toBeGreaterThan(0);
    const hospitais = prediosAtivos(game, "hospital");
    expect(
      hospitais.length,
      `era esperado pelo menos 1 hospital ativo (quatro hospitais em x=76, 84, 92 e 100 (y=141)), ` +
        `mas há ${hospitais.length}: sem hospital o teste não prova nada`,
    ).toBeGreaterThanOrEqual(1);
    if (hospitais.length === 0) return;
    const totalDeLeitos = hospitais.reduce((soma, h) => soma + game.sim.buildings.patientsCapacity(h), 0);
    expect(
      n,
      `era esperado no máximo ${totalDeLeitos} pessoas com leito (a soma de patientsCapacity de ` +
        `todos os hospitais ativos), mas veio ${n}`,
    ).toBeLessThanOrEqual(totalDeLeitos);
    const hospital = hospitais[0]!;
    // Casa de alguém vivo (prédio da família); senão, qualquer prédio residencial ativo.
    // A conta usa world.manhattanMeters, que já multiplica por 16 m por quadradinho.
    let casa = -1;
    const city = game.city;
    for (let p = 0; p < city.pop.count; p++) {
      if (city.pop.status[p] !== 1) continue; // 1 = vivo (PSTATUS.alive)
      const lar = city.homeBuilding(p);
      if (lar >= 0) {
        casa = lar;
        break;
      }
    }
    if (casa < 0) {
      const bs = game.sim.buildings;
      for (let i = 0; i < bs.count; i++) {
        if (!bs.isActive(i)) continue;
        if (bs.homesCapacity(i) > 0) {
          casa = i;
          break;
        }
      }
    }
    expect(
      casa,
      `ninguém na cidade tem casa e não há prédio residencial ativo: sem casa o teste não prova nada`,
    ).toBeGreaterThanOrEqual(0);
    if (casa < 0) return;
    const dist = game.sim.world.manhattanMeters(
      game.sim.buildings.access[casa]!,
      game.sim.buildings.access[hospital]!,
    );
    expect(
      dist,
      `a distância casa-hospital é ${dist} m e deveria ser MAIOR que 200 m ` +
        `(maxDistanceMeters do override): se coubesse em 200 m, teria sido a UBS que registrou`,
    ).toBeGreaterThan(200);
    expect(
      dist,
      `a distância casa-hospital é ${dist} m e deveria ser no máximo 15000 m ` +
        `(hospitalMaxDistanceMeters da config): prova que foi o alcance maior do hospital que registrou`,
    ).toBeLessThanOrEqual(15000);
    expect(
      checkInvariants(game.city),
      `regras que nunca podem quebrar foram violadas na cidade com hospital`,
    ).toEqual([]);
  });

  it("o censo conta quem está sem leito e amostra os locais para o hospital", { timeout: 300000 }, () => {
    const game = cidadeSemUbs(true);
    const census = currentCensus(game) as unknown as CensusWithHospital;
    const pop = game.city.pop as PopWithHospital & typeof game.city.pop;
    expect(
      typeof pop.hospital,
      `o motor ainda não tem o campo pop.hospital ` +
        `(packages/sim/src/people/population.ts): sem ele não dá para conferir a conta do censo`,
    ).not.toBe("undefined");
    if (pop.hospital === undefined) return;
    const n = contaComLeito(game, pop.hospital);
    const semLeito = census.population - n;
    const hospitais = prediosAtivos(game, "hospital");
    const totalDeLeitos = hospitais.reduce((soma, h) => soma + game.sim.buildings.patientsCapacity(h), 0);
    expect(
      typeof census.withoutHospital,
      `o censo ainda não conta withoutHospital (packages/sim/src/people/census.ts): ` +
        `sem esse número o roadmap não sabe onde falta hospital`,
    ).toBe("number");
    if (typeof census.withoutHospital !== "number") return;
    expect(
      census.withoutHospital,
      `era esperado withoutHospital = população (${census.population}) menos pessoas com leito ` +
        `(${n}) = ${semLeito}, mas veio ${census.withoutHospital}`,
    ).toBe(semLeito);
    expect(
      census.withoutHospital,
      `era esperado withoutHospital >= população (${census.population}) menos a soma de ` +
        `patientsCapacity (${totalDeLeitos}) = ${census.population - totalDeLeitos}, ` +
        `mas veio ${census.withoutHospital}`,
    ).toBeGreaterThanOrEqual(census.population - totalDeLeitos);
    const amostra = census.samples.hospital;
    expect(
      Array.isArray(amostra),
      `samples.hospital deveria ser um array de locais para o roadmap, ` +
        `mas veio ${String(amostra)}: o censo não está amostrando onde falta hospital`,
    ).toBe(true);
    if (!Array.isArray(amostra)) return;
    expect(
      amostra.length,
      `samples.hospital deveria ter entre 1 e 200 locais (há ${semLeito} pessoas sem leito), ` +
        `mas veio com ${amostra.length}`,
    ).toBeGreaterThanOrEqual(1);
    expect(
      amostra.length,
      `samples.hospital deveria ter entre 1 e 200 locais (há ${semLeito} pessoas sem leito), ` +
        `mas veio com ${amostra.length}`,
    ).toBeLessThanOrEqual(200);
    const total = game.sim.world.width * game.sim.world.height;
    for (const q of amostra) {
      expect(
        q,
        `samples.hospital tem o local ${q}, fora do mapa (válido de 0 a ${total - 1} ` +
          `num mapa de ${game.sim.world.width}x${game.sim.world.height})`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        q,
        `samples.hospital tem o local ${q}, fora do mapa (válido de 0 a ${total - 1} ` +
          `num mapa de ${game.sim.world.width}x${game.sim.world.height})`,
      ).toBeLessThan(total);
    }
    // Segunda cidade igual, SEM nenhum hospital: todo mundo fica sem leito, mas com amostra.
    const game2 = cidadeSemUbs(false);
    const census2 = currentCensus(game2) as unknown as CensusWithHospital;
    expect(
      typeof census2.withoutHospital,
      `o censo ainda não conta withoutHospital (packages/sim/src/people/census.ts)`,
    ).toBe("number");
    if (typeof census2.withoutHospital !== "number") return;
    expect(
      census2.withoutHospital,
      `sem nenhum hospital era esperado withoutHospital igual à população ` +
        `(${census2.population}), mas veio ${census2.withoutHospital}`,
    ).toBe(census2.population);
    const amostra2 = census2.samples.hospital;
    expect(
      Array.isArray(amostra2) && amostra2.length > 0,
      `sem nenhum hospital era esperado samples.hospital não vazio (há ${census2.population} ` +
        `pessoas sem leito), mas veio ${Array.isArray(amostra2) ? amostra2.length : String(amostra2)}`,
    ).toBe(true);
  });

  it("quem tem leito de hospital morre menos do que quem não tem", { timeout: 300000 }, () => {
    const { config, data } = loadConfigAndData({
      economy: { mode: "sandbox" },
      world: { width: 32, height: 32, startingRoad: { enabled: false }, water: { enabled: false } },
      population: { immigration: { enabled: false } },
      lifecycle: {
        marriage: { hazardByAge: { "0": 0 } },
        labor: { participation: 0 },
        leaveParentsHome: { annualChance: 0 },
      },
      health: { uncoveredMortalityMultiplier: 4 },
    });
    const run = createRun({
      config,
      data,
      seed: "hospital-mortalidade",
      days: 76,
      commands: [
        { type: "buildRoad", kind: "street", x0: 2, y0: 8, x1: 22, y1: 8 },
        { type: "placeService", service: "hospital", x: 6, y: 9 },
      ],
    });
    const game = run.game;
    const { city, sim } = game;
    const tpd = sim.clock.ticksPerDay;
    const pop = city.pop as PopWithHospital & typeof city.pop;
    expect(
      typeof pop.hospital,
      `o motor ainda não tem o campo pop.hospital ` +
        `(packages/sim/src/people/population.ts): sem ele não dá para separar quem tem leito`,
    ).not.toBe("undefined");
    if (pop.hospital === undefined) return;
    // Hospital de verdade: avança 1 dia para os comandos aplicarem (o prédio ainda está
    // em obras, mas o id já é o definitivo) e o grupo B recebe esse id real.
    run.nextDay();
    let hospital = -1;
    const bs = sim.buildings;
    for (let i = 0; i < bs.count; i++) {
      if (bs.typeOf(i).id === "hospital") {
        hospital = i;
        break;
      }
    }
    expect(
      hospital,
      `era esperado 1 hospital construído via placeService em x=6, y=9 (encostado na via ` +
        `de y=8), mas não há nenhum: sem hospital o teste não prova nada`,
    ).toBeGreaterThanOrEqual(0);
    if (hospital < 0) return;
    // Dois grupos de 5000 recém-nascidos na mesma cidade e semente (mães de 30 anos,
    // uma família a cada 50 bebês, como em tests/slow/demography.test.ts).
    const N = 5000;
    const grupoA: number[] = [];
    const grupoB: number[] = [];
    let familia = -1;
    for (let i = 0; i < 2 * N; i++) {
      if (i % 50 === 0) {
        familia = city.hh.create();
        const mae = newPerson(city, {
          sex: 0,
          birthTick: sim.clock.tick - 30 * tpd,
          first: 0,
          surnameA: 0,
          surnameB: 0,
        });
        city.pop.laborWilling[mae] = 2;
        joinHousehold(city, mae, familia);
      }
      const homem = i % 205 < 105;
      const p = newPerson(city, {
        sex: homem ? 1 : 0,
        birthTick: sim.clock.tick,
        first: 0,
        surnameA: 0,
        surnameB: 0,
      });
      joinHousehold(city, p, familia);
      if (i < N) {
        pop.hospital![p] = -1;
        grupoA.push(p);
      } else {
        pop.hospital![p] = hospital;
        grupoB.push(p);
      }
    }
    while (run.nextDay()) {}
    let hospitalAtivo = -1;
    for (let i = 0; i < bs.count; i++) {
      if (bs.typeOf(i).id === "hospital" && bs.state[i] === BSTATE.active) {
        hospitalAtivo = i;
        break;
      }
    }
    expect(
      hospitalAtivo,
      `era esperado 1 hospital ativo ao fim das obras (placeService em x=6, y=9), ` +
        `mas não há nenhum: sem hospital ativo o teste não prova nada`,
    ).toBeGreaterThanOrEqual(0);
    if (hospitalAtivo < 0) return;
    let mortosA = 0;
    let somaA = 0;
    for (const p of grupoA) {
      const idade = idadeAoMorrer(game, p);
      if (idade !== null) {
        mortosA++;
        somaA += idade;
      }
    }
    let mortosB = 0;
    let somaB = 0;
    for (const p of grupoB) {
      const idade = idadeAoMorrer(game, p);
      if (idade !== null) {
        mortosB++;
        somaB += idade;
      }
    }
    expect(
      mortosA,
      `o grupo A (sem leito) não teve mortes em 76 dias entre ${grupoA.length} bebês: ` +
        `sem mortes a conta não prova nada`,
    ).toBeGreaterThan(0);
    expect(
      mortosB,
      `o grupo B (com leito) não teve mortes em 76 dias entre ${grupoB.length} bebês: ` +
        `sem mortes a conta não prova nada`,
    ).toBeGreaterThan(0);
    if (mortosA === 0 || mortosB === 0) return;
    const mediaA = somaA / mortosA;
    const mediaB = somaB / mortosB;
    expect(
      mediaB - mediaA,
      `quem tem leito (grupo B, média ${mediaB.toFixed(2)} anos em ${mortosB} mortes) deveria viver ` +
        `pelo menos 1 ano a mais na média do que quem não tem (grupo A, média ${mediaA.toFixed(2)} ` +
        `anos em ${mortosA} mortes): o leito do hospital não está protegendo ninguém`,
    ).toBeGreaterThanOrEqual(1);
    expect(
      mediaA,
      `a média do grupo A (${mediaA.toFixed(2)} anos) saiu da faixa 45-75 anos: ` +
        `a cidade virou um caso extremo`,
    ).toBeGreaterThanOrEqual(45);
    expect(
      mediaA,
      `a média do grupo A (${mediaA.toFixed(2)} anos) saiu da faixa 45-75 anos: ` +
        `a cidade virou um caso extremo`,
    ).toBeLessThanOrEqual(75);
    expect(
      mediaB,
      `a média do grupo B (${mediaB.toFixed(2)} anos) saiu da faixa 45-75 anos: ` +
        `a cidade virou um caso extremo`,
    ).toBeGreaterThanOrEqual(45);
    expect(
      mediaB,
      `a média do grupo B (${mediaB.toFixed(2)} anos) saiu da faixa 45-75 anos: ` +
        `a cidade virou um caso extremo`,
    ).toBeLessThanOrEqual(75);
  });

  it("uma cidade com hospital não quebra nenhuma regra do motor", { timeout: 300000 }, () => {
    const game = cidadeSemUbs(true);
    expect(
      checkInvariants(game.city),
      `regras que nunca podem quebrar foram violadas na cidade com hospital`,
    ).toEqual([]);
    expect(
      currentCensus(game).population,
      `a cidade com hospital esvaziou (população 0): sem gente o teste não prova nada`,
    ).toBeGreaterThan(0);
  });
});
