/**
 * Issue #121 — o hospital reduz a mortalidade e tem porte mínimo documentado.
 *
 * Escopo desta tarefa (depois do ajuste do Arquiteto no comentário da issue): só o motor.
 * O gatilho do prefeito automático foi para a #175 e o manual/sinal para a #176, então aqui
 * não se testa o bot nem o painel.
 *
 * O que ainda precisa ficar travado:
 * 1. Construção: o hospital que o jogador constrói entra em funcionamento e recebe pacientes.
 * 2. Leitos: ninguém fica com leito a mais do que a soma de `patientsCapacity` dos hospitais,
 *    e todo leito aponta para um hospital em funcionamento.
 * 3. Mortalidade: na MESMA cidade e na MESMA semente, quem tem leito de hospital morre menos
 *    do que quem não tem (a única variável mudada é o leito). A conta sai de uma coorte
 *    controlada de recém-nascidos (5.000 em cada grupo), não da cidade do cenário: depois da
 *    #203 o leito é só de hospital (UBS não vira leito), o grupo com leito do `bairro-basico`
 *    fica pequeno e não acumula nenhuma morte em 80 dias.
 * 4. Porte mínimo: o item `hospital` de `data/reference/cidade-real.yaml` diz a partir de que
 *    tamanho de cidade o hospital faz falta, com fonte (hoje está "PENDENTE: porte mínimo").
 *
 * Semente fixa, sem relógio e sem `Math.random`. Cada cidade roda uma vez só.
 */
import { readFileSync } from "node:fs";
import { createRun, loadConfigAndData, loadScenario, runGame } from "@city/cli";
import { BSTATE, checkInvariants, currentCensus, type Game, joinHousehold, newPerson } from "@city/sim";
import { describe, expect, it } from "vitest";
import { EV } from "../../packages/sim/src/people/events";

/** Semente fixa do arquivo (nada de relógio nem `Math.random`). */
const SEED = "hospital-mortalidade";
/** Dias de jogo: o hospital leva 30 meses de obra (2,5 dias) e a UBS some do alcance. */
const DAYS = 80;
/** Raio curto de UBS (200 m) para o hospital virar o segundo nível de verdade. */
const UBS_RAIO = 200;
/** Recém-nascidos em cada grupo da coorte de mortalidade (peso estatístico da comparação). */
const COORTE = 5000;
/** Dias de jogo da coorte: menos de um ano, como em 119-hospital-segundo-nivel.test.ts. */
const DIAS_COHORTE = 76;

/** Uma pessoa com leito de internação e o prédio do hospital onde ela está. */
type Ocupante = { pessoa: number; hospital: number };

/** Lê um arquivo do repositório como texto. */
function readRepoText(caminho: string): string {
  return readFileSync(caminho, "utf8");
}

/** IDs dos prédios de um tipo que estão funcionando (state active). */
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

/**
 * Cenário `bairro-basico` com dinheiro infinito, a UBS do cenário demolida e o alcance da UBS
 * curto em 200 m (assim o hospital é o único serviço de saúde no alcance). Sem hospital e com
 * quatro hospitais em x = 76, 84, 92 e 100 (y = 141), conforme o parâmetro.
 */
function cidade(comHospital: boolean): Game {
  const chave = comHospital ? "com-hospital" : "sem-hospital";
  const pronto = cidades.get(chave);
  if (pronto) return pronto;
  const scenario = loadScenario("bairro-basico");
  const { config, data } = loadConfigAndData({
    ...scenario.overrides,
    economy: { mode: "sandbox" },
    health: { maxDistanceMeters: UBS_RAIO },
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
  cidades.set(chave, game);
  return game;
}

const cidades = new Map<string, Game>();

/** Leitos de internação ocupados: quem está com leito e em qual hospital. */
function leitoOcupa(game: Game): Ocupante[] {
  const pop = game.city.pop;
  const out: Ocupante[] = [];
  for (let p = 0; p < pop.count; p++) {
    if (pop.hospital[p]! >= 0) out.push({ pessoa: p, hospital: pop.hospital[p]! });
  }
  return out;
}

/** Pessoas que morreram (EV.died = 3) na cidade, pelo id que está no campo `person`. */
function mortes(game: Game): Set<number> {
  const ev = game.city.events;
  const out = new Set<number>();
  for (let e = 0; e < ev.count; e++) {
    if (ev.type[e] === EV.died) out.add(ev.person[e]!);
  }
  return out;
}

describe("issue #121: hospital reduz mortalidade e tem porte documentado", () => {
  it("o hospital construído entra em funcionamento e ocupa todos os leitos", { timeout: 300000 }, () => {
    const game = cidade(true);
    const b = game.sim.buildings;
    const hospitals = prediosAtivos(game, "hospital");
    expect(
      hospitals.length,
      `eram esperados 4 hospitais ativos no fim das obras (placeService hospital em x=76, 84, 92 ` +
        `e 100, y=141), mas há ${hospitals.length}: sem hospital em funcionamento o teste não prova nada`,
    ).toBe(4);
    if (hospitals.length === 0) return;
    const leitosTotais = hospitals.reduce((soma, h) => soma + b.patientsCapacity(h), 0);
    expect(
      leitosTotais,
      `os 4 deveriam ter 360 leitos no total (90 por hospital, Portaria GM/MS 1.101/2002), ` +
        `mas somam ${leitosTotais}`,
    ).toBe(360);
    const ocupados = leitoOcupa(game);
    expect(
      ocupados.length,
      `esperado mais de 0 pessoas com leito de hospital (a UBS saiu do alcance com ` +
        `maxDistanceMeters = ${UBS_RAIO} m e o hospital alcança ` +
        `${game.sim.config.health.hospitalMaxDistanceMeters} m), mas ninguém registrou leito: ` +
        `o hospital não está recebendo pacientes`,
    ).toBeGreaterThan(0);
    expect(
      ocupados.length,
      `há ${ocupados.length} pessoas com leito e só ${leitosTotais} leitos: ninguém pode ter ` +
        `leito a mais do que a capacidade somada dos hospitais`,
    ).toBeLessThanOrEqual(leitosTotais);
    for (const { pessoa, hospital } of ocupados) {
      expect(
        hospitals.includes(hospital),
        `a pessoa ${pessoa} tem leito no prédio ${hospital}, que não está ativo: ninguém pode ` +
          `ficar com leito em hospital fora de funcionamento`,
      ).toBe(true);
    }
    expect(
      checkInvariants(game.city),
      `regras que nunca podem quebrar foram violadas na cidade com hospital`,
    ).toEqual([]);
  });

  it("na mesma cidade e semente, quem tem leito morre menos do que quem não tem", { timeout: 300000 }, () => {
    // Coorte controlada, no padrão de 119-hospital-segundo-nivel.test.ts: dois grupos de
    // recém-nascidos na MESMA cidade e na MESMA semente, mudando SÓ o leito (`pop.hospital`).
    // A cidade do cenário (`bairro-basico`, 80 dias) não dá peso para essa conta: o roteiro
    // antigo exigia uma morte no grupo com leito, e depois da #203 esse grupo quase não morre
    // — o leito de internação é só de `tipo.id === "hospital"` (UBS não vira leito), sobra muito
    // pouca gente idosa com leito e o grupo inteiro passa o tempo sem nenhuma morte. Aqui o peso
    // vem do tamanho da coorte (5.000 de cada lado), não da idade nem da duração.
    // Sem UBS no mapa, `uncoveredMortalityMultiplier` pesa igual nos dois grupos, então a única
    // diferença entre eles é a redução de risco que o leito aplica em `systems/lifecycle.ts`.
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
      seed: SEED,
      days: DIAS_COHORTE,
      commands: [
        { type: "buildRoad", kind: "street", x0: 2, y0: 8, x1: 22, y1: 8 },
        { type: "placeService", service: "hospital", x: 6, y: 9 },
      ],
    });
    const game = run.game;
    const { city, sim } = game;
    const tpd = sim.clock.ticksPerDay;
    // Um dia para os comandos aplicarem: o prédio ainda está em obras, mas o id já é o definitivo.
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
    // Dois grupos de COORTE recém-nascidos: grupo A sem leito, grupo B com o leito do hospital.
    // Uma família a cada 50 bebês, com mãe de 30 anos (como em tests/slow/demography.test.ts).
    const grupoSemLeito: number[] = [];
    const grupoComLeito: number[] = [];
    let familia = -1;
    for (let i = 0; i < 2 * COORTE; i++) {
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
      if (i < COORTE) {
        city.pop.hospital[p] = -1;
        grupoSemLeito.push(p);
      } else {
        city.pop.hospital[p] = hospital;
        grupoComLeito.push(p);
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
    const morreu = mortes(game);
    const mortesSemLeito = grupoSemLeito.filter((p) => morreu.has(p)).length;
    const mortesComLeito = grupoComLeito.filter((p) => morreu.has(p)).length;
    expect(
      mortesSemLeito,
      `o grupo sem leito (${COORTE} recém-nascidos) não teve nenhuma morte em ${DIAS_COHORTE} dias: ` +
        `sem mortes o grupo de comparação não prova nada`,
    ).toBeGreaterThan(0);
    expect(
      mortesComLeito,
      `o grupo com leito (${COORTE} recém-nascidos) não teve nenhuma morte em ${DIAS_COHORTE} dias: ` +
        `o teste precisa das duas taxas para comparar`,
    ).toBeGreaterThan(0);
    const taxaComLeito = mortesComLeito / grupoComLeito.length;
    const taxaSemLeito = mortesSemLeito / grupoSemLeito.length;
    expect(
      taxaComLeito,
      `quem tem leito de hospital (${mortesComLeito} mortes em ${grupoComLeito.length} pessoas = ` +
        `${(taxaComLeito * 100).toFixed(2)}%) deveria morrer MENOS do que quem não tem ` +
        `(${mortesSemLeito} mortes em ${grupoSemLeito.length} pessoas = ${(taxaSemLeito * 100).toFixed(2)}%): ` +
        `o leito do hospital não está reduzindo a mortalidade de ninguém`,
    ).toBeLessThan(taxaSemLeito);
    // A cidade sem hospital é a mesma cidade sem os quatro prédios: sem hospital, ninguém tem leito.
    const semHospital = cidade(false);
    expect(
      leitoOcupa(semHospital).length,
      `na cidade sem hospital nenhum prédio, ${leitoOcupa(semHospital).length} pessoas ficaram com ` +
        `leito: o hospital sumiu da cidade mas o leito ficou`,
    ).toBe(0);
    expect(
      prediosAtivos(semHospital, "hospital").length,
      `a cidade sem hospital não deveria ter hospital ativo`,
    ).toBe(0);
  });

  it("o porte mínimo do hospital na referência de cidade real está documentado com fonte", () => {
    const yaml = readRepoText("data/reference/cidade-real.yaml");
    const linhas = yaml.split("\n");
    const inicio = linhas.findIndex((linha) => /^\s*-\s*id:\s*hospital\s*$/.test(linha));
    expect(
      inicio,
      `data/reference/cidade-real.yaml deveria ter um item "- id: hospital"`,
    ).toBeGreaterThanOrEqual(0);
    if (inicio < 0) return;
    let fim = linhas.length;
    for (let i = inicio + 1; i < linhas.length; i++) {
      if (/^\s*-\s*id:\s*/.test(linhas[i] ?? "")) {
        fim = i;
        break;
      }
    }
    const bloco = linhas.slice(inicio, fim);
    const minPop = bloco
      .map((linha) => /^(\s*)minPopulation:\s*(\d+)\s*$/.exec(linha))
      .find((achado) => achado !== null);
    expect(
      minPop,
      `o item hospital de data/reference/cidade-real.yaml deveria ter minPopulation (a partir de ` +
        `quantos habitantes o hospital faz falta), mas o bloco é:\n${bloco.join("\n")}`,
    ).toBeTruthy();
    if (!minPop) return;
    const pop = Number(minPop[2]);
    expect(
      pop,
      `o porte mínimo do hospital saiu da faixa 5.000 a 12.000 habitantes (a 2,5 leitos por mil ` +
        `da Portaria GM/MS 1.101/2002, 8.000 habitantes dariam ${(2.5 * pop) / 1000} leitos, ` +
        `o tamanho de um hospital pequeno), mas está em ${pop}`,
    ).toBeGreaterThanOrEqual(5000);
    expect(
      pop,
      `o porte mínimo do hospital saiu da faixa 5.000 a 12.000 habitantes (a 2,5 leitos por mil ` +
        `da Portaria GM/MS 1.101/2002, 8.000 habitantes dariam ${(2.5 * pop) / 1000} leitos, ` +
        `o tamanho de um hospital pequeno), mas está em ${pop}`,
    ).toBeLessThanOrEqual(12000);
    const pendente = bloco.find((linha) => /PENDENTE/i.test(linha) && /porte/i.test(linha));
    expect(
      pendente,
      `o porte mínimo do hospital ainda está sem resolver em data/reference/cidade-real.yaml ` +
        `(linha "${String(pendente).trim()}"): a issue #121 pede o porte mínimo documentado. ` +
        `Ou põe a fonte do porte, ou troca por um número que também tenha fonte.`,
    ).toBeUndefined();
  });
});
