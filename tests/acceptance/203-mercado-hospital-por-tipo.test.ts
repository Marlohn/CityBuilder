/**
 * Issue #203 — mercado de hospital por tipo: UBS não vira leito de internação.
 *
 * O que ainda falta na main (por isso este arquivo FALHA antes da implementação):
 * em `packages/sim/src/markets/markets.ts` o mercado `hospitals` é uma cópia de `clinics`
 * e nenhum dos dois filtra por tipo de prédio. Como `VacancyMarket.update` só pergunta
 * "tem vaga?", uma UBS ativa com vaga entra em `markets.hospitals.open`, e aí
 * `MatchingSystem.clinics` (`packages/sim/src/systems/matching.ts`) cai no segundo nível
 * e chama `registerHospital(city, p, ubs)` — a UBS vira leito de internação.
 *
 * Um `it` por critério do "tá pronto quando":
 * 1. cidade com UBS e sem hospital: ninguém tem `pop.hospital >= 0` (a UBS não interna ninguém);
 * 2. cidade com hospital e sem UBS: ninguém tem `pop.clinic >= 0` (leito não é posto de saúde)
 *    e a conta do censo bate com quem tem leito (`withoutHospital` = população menos gente internada);
 * 3. `markets.hospitals.open` nunca tem UBS e `markets.clinics.open` nunca tem hospital, e todo
 *    registro em `pop.clinic`/`pop.hospital` aponta para um prédio do tipo certo;
 * 4. nenhuma regra do motor quebra: `checkInvariants` vazio e `buildings.patients` confere com
 *    quem está registrado em cada prédio de saúde ativo.
 *
 * Cidades pequenas e controladas, cenário `bairro-basico` (que já vem com uma UBS em 73,141),
 * dinheiro de sandbox e alcance de UBS curto (200 m) para o hospital virar o segundo nível de
 * verdade. Semente fixa, sem relógio e sem `Math.random`; cada cidade roda uma vez só.
 */
import { checkInvariants, currentCensus, type Game } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** Semente fixa do arquivo (nada de relógio nem `Math.random`). */
const SEED = "mercado-tipo-saude";
/** Dias de jogo: a UBS leva 12 meses de obra (1 dia) e o hospital 30 meses (2,5 dias). */
const DAYS = 40;
/** Dinheiro infinito (para o hospital de 50 milhões não travar a obra) e UBS a 200 m. */
const OVERRIDES = { economy: { mode: "sandbox" }, health: { maxDistanceMeters: 200 } };

/** A UBS do cenário (x 73, y 141) sai quando queremos uma cidade só de hospital. */
const BULLDOZE_UBS = { type: "bulldoze", x0: 73, y0: 141, x1: 74, y1: 142 } as const;

/** Onze hospitais de 4x3 colados na rua de y=140 (90 leitos cada = 990 leitos). */
const HOSPITAIS = [76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116].map((x) => ({
  type: "placeService",
  service: "hospital",
  x,
  y: 141,
}));

/** Cidades já rodadas (não roda a mesma cidade duas vezes). */
const jogos = new Map<string, Game>();

function cidade(chave: string, commands: readonly unknown[], days = DAYS): Game {
  const pronto = jogos.get(chave);
  if (pronto) return pronto;
  const game = createTestGame({
    seed: SEED,
    scenario: "bairro-basico",
    days,
    overrides: OVERRIDES,
    commands: commands as never,
  });
  jogos.set(chave, game);
  return game;
}

/** Ids dos prédios ativos de um tipo do catálogo (ex.: "ubs" ou "hospital"). */
function ativosDoTipo(game: Game, tipo: string): number[] {
  const b = game.sim.buildings;
  const ids: number[] = [];
  for (let i = 0; i < b.count; i++) if (b.isActive(i) && b.typeOf(i).id === tipo) ids.push(i);
  return ids;
}

/** Nº de pessoas vivas registradas em `campo` (pop.clinic ou pop.hospital), por prédio. */
function registrados(game: Game, campo: "clinic" | "hospital"): Map<number, number> {
  const pop = game.city.pop;
  const porPredio = new Map<number, number>();
  for (let p = 0; p < pop.count; p++) {
    if (!pop.isAlive(p)) continue;
    const alvo = pop[campo][p]!;
    if (alvo < 0) continue;
    porPredio.set(alvo, (porPredio.get(alvo) ?? 0) + 1);
  }
  return porPredio;
}

/** Nº de pessoas vivas registradas em `campo`. */
function contaRegistrados(game: Game, campo: "clinic" | "hospital"): number {
  let n = 0;
  for (const v of registrados(game, campo).values()) n += v;
  return n;
}

describe("issue #203: mercado de hospital por tipo (UBS não vira leito)", () => {
  it("1. numa cidade com UBS e sem hospital, ninguém tem pop.hospital >= 0", { timeout: 600000 }, () => {
    const game = cidade("so-ubs", []);
    const census = currentCensus(game);
    const ubs = ativosDoTipo(game, "ubs");
    const hospitais = ativosDoTipo(game, "hospital");
    // Pré-condições: sem elas o teste não prova nada.
    expect(
      census.population,
      "a cidade ficou sem gente: sem população o teste não prova nada",
    ).toBeGreaterThan(0);
    expect(
      ubs.length,
      "a cidade do critério 1 deveria ter a UBS do cenário (x=73, y=141) ativa: sem UBS presente " +
        "não dá para provar que ela parou de virar leito",
    ).toBeGreaterThan(0);
    for (const u of ubs) {
      expect(
        game.sim.buildings.patients[u]!,
        `a UBS ${u} está cheia (patients ${game.sim.buildings.patients[u]} para ` +
          `${game.sim.buildings.patientsCapacity(u)} vagas): sem vaga sobrando a UBS nem entra " ` +
          "no mercado de hospital e o teste não prova nada",
      ).toBeLessThan(game.sim.buildings.patientsCapacity(u));
    }
    expect(
      hospitais,
      "a cidade do critério 1 não deveria ter hospital nenhum: com hospital presente o 0 " +
        "abaixo seria impossível",
    ).toHaveLength(0);
    // A asserção que trava o bug.
    expect(
      contaRegistrados(game, "hospital"),
      `era esperado 0 pessoas com leito de internação (há ${ubs.length} UBS ativa(s) e ` +
        "nenhum hospital na cidade), mas o mercado de hospital aceitou a UBS como leito: " +
        'markets.hospitals precisa filtrar por tipo de prédio (tipo.id === "hospital")',
    ).toBe(0);
  });

  it("2. numa cidade com hospital e sem UBS, ninguém tem pop.clinic >= 0 e o censo bate", {
    timeout: 600000,
  }, () => {
    const game = cidade("so-hospital", [BULLDOZE_UBS, ...HOSPITAIS]);
    const census = currentCensus(game);
    const ubs = ativosDoTipo(game, "ubs");
    const hospitais = ativosDoTipo(game, "hospital");
    expect(
      census.population,
      "a cidade ficou sem gente: sem população o teste não prova nada",
    ).toBeGreaterThan(0);
    expect(
      hospitais.length,
      `era esperado pelo menos 1 hospital ativo (${HOSPITAIS.length} hospitais em y=141), ` +
        "mas não há nenhum: sem hospital o teste não prova nada",
    ).toBeGreaterThan(0);
    expect(
      ubs,
      "a cidade do critério 2 não deveria ter UBS nenhuma (bulldoze da UBS do cenário): com UBS " +
        "presente o 0 abaixo não provaria que leito de internação não é posto de saúde",
    ).toHaveLength(0);
    // O outro lado do bug: leito de internação não é posto de saúde.
    expect(
      contaRegistrados(game, "clinic"),
      `era esperado 0 pessoas registradas em posto de saúde (há ${hospitais.length} ` +
        "hospital(is) ativo(s) e nenhuma UBS na cidade), mas alguém foi registrado no hospital: " +
        'markets.clinics precisa filtrar por tipo de prédio (tipo.id === "ubs")',
    ).toBe(0);
    expect(
      census.withoutClinic,
      `sem nenhuma UBS na cidade era esperado withoutClinic igual à população ` +
        `(${census.population}), mas veio ${census.withoutClinic}`,
    ).toBe(census.population);
    // A conta do censo de leito: ninguém some e ninguém inventa gente internada.
    const comLeito = contaRegistrados(game, "hospital");
    expect(
      census.withoutHospital,
      `o censo conta quem está sem leito (pop.hospital < 0): era esperado ` +
        `${census.population} menos as ${comLeito} pessoas internadas = ` +
        `${census.population - comLeito}, mas veio ${census.withoutHospital}`,
    ).toBe(census.population - comLeito);
    const totalLeitos = hospitais.reduce((soma, h) => soma + game.sim.buildings.patientsCapacity(h), 0);
    expect(
      comLeito,
      `não dá para internar mais gente do que o número de leitos (${totalLeitos} leitos nos ` +
        `${hospitais.length} hospitais ativos)`,
    ).toBeLessThanOrEqual(totalLeitos);
    expect(
      totalLeitos,
      "os hospitais da cidade deveriam ter leito sobrando para provar a conta do censo",
    ).toBeGreaterThan(0);
  });

  it("3. hospitals.open nunca tem UBS, clinics.open nunca tem hospital", { timeout: 600000 }, () => {
    const cidades: [string, Game][] = [
      ["so-ubs", cidade("so-ubs", [])],
      ["so-hospital", cidade("so-hospital", [BULLDOZE_UBS, ...HOSPITAIS])],
      ["nenhum", cidade("nenhum", [BULLDOZE_UBS])],
      ["ubs-e-hospital", cidade("ubs-e-hospital", HOSPITAIS)],
    ];
    for (const [nome, game] of cidades) {
      const m = game.city.markets;
      for (let i = 0; i < m.hospitals.open.size; i++) {
        const id = m.hospitals.open.at(i);
        expect(
          game.sim.buildings.typeOf(id).id,
          `na cidade "${nome}", o prédio ${id} entrou em markets.hospitals.open, mas é do tipo ` +
            "errado: uma UBS é posto de saúde, não leito de internação",
        ).not.toBe("ubs");
        expect(
          game.sim.buildings.typeOf(id).id,
          `na cidade "${nome}", o prédio ${id} entrou em markets.hospitals.open, mas não é do ` +
            'tipo "hospital"',
        ).toBe("hospital");
      }
      for (let i = 0; i < m.clinics.open.size; i++) {
        const id = m.clinics.open.at(i);
        expect(
          game.sim.buildings.typeOf(id).id,
          `na cidade "${nome}", o prédio ${id} entrou em markets.clinics.open, mas é do tipo ` +
            "errado: leito de internação não é posto de saúde",
        ).not.toBe("hospital");
        expect(
          game.sim.buildings.typeOf(id).id,
          `na cidade "${nome}", o prédio ${id} entrou em markets.clinics.open, mas não é do ` + 'tipo "ubs"',
        ).toBe("ubs");
      }
    }
    // E o registro em `pop` aponta sempre para o prédio do tipo certo.
    const comAmbos = cidades[3]![1];
    for (const [campo, tipo] of [
      ["clinic", "ubs"],
      ["hospital", "hospital"],
    ] as const) {
      for (const [id, n] of registrados(comAmbos, campo)) {
        expect(
          comAmbos.sim.buildings.typeOf(id).id,
          `${n} pessoas estão com pop.${campo} apontando para o prédio ${id}, que é do tipo ` +
            `"${comAmbos.sim.buildings.typeOf(id).id}" e não "${tipo}"`,
        ).toBe(tipo);
      }
    }
    // Na cidade só de UBS o mercado de hospital tem de estar vazio.
    expect(
      cidades[0]![1].city.markets.hospitals.open.size,
      "numa cidade só com UBS, markets.hospitals.open deveria estar vazio, mas tem " +
        `${cidades[0]![1].city.markets.hospitals.open.size} prédio(s)`,
    ).toBe(0);
  });

  it("4. nenhuma regra do motor quebra e a contagem de pacientes bate", { timeout: 600000 }, () => {
    for (const nome of ["so-ubs", "so-hospital", "nenhum", "ubs-e-hospital"]) {
      const game = jogos.get(nome);
      expect(game, `a cidade "${nome}" deveria ter sido rodada`).toBeDefined();
      if (game === undefined) continue;
      expect(
        checkInvariants(game.city),
        `regras que nunca podem quebrar foram violadas na cidade "${nome}"`,
      ).toEqual([]);
      // `patients` continua sendo UM contador só (UBS e hospital dividem o mesmo campo):
      // o número de pacientes de cada prédio de saúde ativo tem que ser exatamente quem está
      // registrado nele, pelo posto de saúde ou pelo leito.
      const conta = new Map<number, number>();
      for (const [id, n] of registrados(game, "clinic")) conta.set(id, (conta.get(id) ?? 0) + n);
      for (const [id, n] of registrados(game, "hospital")) conta.set(id, (conta.get(id) ?? 0) + n);
      for (const tipo of ["ubs", "hospital"]) {
        for (const id of ativosDoTipo(game, tipo)) {
          expect(
            game.sim.buildings.patients[id]!,
            `o prédio de saúde ${id} (${tipo}) tem patients ${game.sim.buildings.patients[id]}, ` +
              `mas há ${conta.get(id) ?? 0} pessoa(s) registradas nele: o contador de pacientes ` +
              "não bate com quem usa o prédio",
          ).toBe(conta.get(id) ?? 0);
        }
      }
    }
  });
});
