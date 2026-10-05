/**
 * Teste de aceitação da issue #174, tarefa "Leitos de internação no stats e no relatório
 * (sem contar vaga de UBS)" (papel QA).
 *
 * O que falta na main (por isso este teste FALHA antes da implementação):
 * - `StatsView` (packages/contract/src/view.ts) e `statsView` (packages/sim/src/view/stats.ts)
 *   não têm `hospitalBeds: { total; occupied }`: total = soma de `patientsCapacity` SÓ dos
 *   prédios ativos cujo tipo é "hospital"; occupied = pessoas com `pop.hospital[p] >= 0` em
 *   hospital ativo. A UBS (vaga de atenção básica, capacidade na casa dos milhares) NÃO é leito.
 * - `reportText` (packages/sim/src/view/report.ts) não tem a linha "Leitos de hospital: X
 *   (Y ocupados)" nem "sem hospital: N" na linha de desejos não atendidos.
 *
 * Um `it` por critério do "tá pronto quando":
 * 1. cidade com 1 UBS e zero hospitais: `hospitalBeds` existe, total === 0 e o relatório não
 *    mostra leito;
 * 2. cidade com 4 hospitais ativos (+ UBS ativa): total === 4 x capacidade do "hospital" lida
 *    do catálogo (data/buildings.yaml via `buildings.typeOf(i).patients`, sem número fixo no
 *    teste), occupied entre 1 e total, e total bem menor que a conta errada que somaria a UBS;
 * 3. occupied só conta gente em hospital ativo (limites + contagem independente via
 *    `game.city.pop` / `game.sim.buildings`, APIs públicas já usadas pelo relatório);
 * 4. o relatório mostra `sem hospital: N` (N === unmet.hospital === withoutHospital) e a linha
 *    de leitos com X/Y iguais a `hospitalBeds`;
 * 5. a cidade de referência não muda: os números já guardados no snapshot continuam iguais
 *    (só a chave nova pode entrar no snapshot).
 *
 * Sobre as cidades: reaproveito do teste 173 o bulldoze da UBS (x 73-74, y 141-142), os 4
 * hospitais lado a lado (x 76/84/92/100, y 141), os overrides (sandbox + saúde a 200 m) e os
 * 40 dias (a obra do hospital dura 30 meses = 2,5 dias, então 40 basta). A cidade dos critérios
 * 2 e 3 MANTÉM a UBS do cenário de propósito: sem UBS ativa presente, o teste não provaria a
 * exclusão da vaga de UBS da conta de leitos. O bulldoze só entra na cidade do critério 4
 * (onde o "sem hospital" fica não-trivial, como no teste 173).
 *
 * Sobre o critério 5: congelei abaixo (EMBUTIDOS no teste, não lidos do snapshot) os números
 * atuais de tests/unit/__snapshots__/reference.test.ts.snap para as duas cidades
 * ("bairro-basico, 12 dias" e "prefeito automático, 12 dias"): tick, population, households,
 * employed, unemployed, children, retired, buildings, cars, money, events e o objeto unmet SÓ
 * com as chaves que já existem (sem nenhuma chave nova). Deixei de fora o `lastYear` detalhado
 * (receitas/despesas por categoria com floats e contadores de viagem): ele continua coberto
 * pelo próprio reference.test.ts, e o que prova "comportamento não mudou" para esta tarefa são
 * os contadores de gente/prédio/evento mais o unmet. O teste também LÊ o arquivo .snap (fs,
 * caminho relativo ao repo) e confere que os números congelados estão lá — assim, se alguém
 * regravasse o snapshot com números diferentes, este teste continuaria falhando. O bloco
 * `hospitalBeds` (quando entrar no snapshot) é ignorado de propósito: a presença da chave nova
 * é cobrada via `statsView`, não via texto do snapshot.
 *
 * Semente fixa em todas as cidades, sem relógio, sem `Math.random`. Cidades com comandos são
 * criadas com `createTestGame` de tests/helpers.ts e rodadas uma única vez (Map memoizado).
 */

import { loadConfigAndData, loadScenario, runGame } from "@city/cli";
import type { Command } from "@city/contract";
import { currentCensus, type Game, reportText, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** Chave nova esperada no stats (ainda não existe no contrato): acesso tolerante. */
interface HospitalBedsView {
  total?: unknown;
  occupied?: unknown;
}

function bedsOf(game: Game): HospitalBedsView | undefined {
  return (statsView(game) as unknown as { hospitalBeds?: HospitalBedsView }).hospitalBeds;
}

/** Mensagem padrão quando a chave nova ainda não existe (o motivo certo da falha na main). */
const SEM_CHAVE =
  "a chave nova `hospitalBeds` não existe em statsView(game) (packages/sim/src/view/stats.ts) " +
  "nem no contrato StatsView (packages/contract/src/view.ts): sem ela a tela e o relatório " +
  "não mostram os leitos de internação";

/** Semente fixa única das cidades com comandos (não pode conter "leito" porque o relatório mostra a semente no cabeçalho e o filtro do critério 1 casa com /leito/i). */
const SEED = "internacao-hosp";
/** Dias de jogo (o hospital leva 30 meses de obra = 2,5 dias, então 40 basta). */
const DAYS = 40;
/** Mesmos overrides do teste 173 (sandbox + saúde a 200 m, para o hospital registrar leito). */
const OVERRIDES = { economy: { mode: "sandbox" }, health: { maxDistanceMeters: 200 } };

/** Demole a UBS do cenário (x de 73 a 74, y de 141 a 142, como no teste 173). */
const BULLDOZE_UBS: Command = { type: "bulldoze", x0: 73, y0: 141, x1: 74, y1: 142 };

/** Quatro hospitais lado a lado (mesmos do teste 173, para ter leito de sobra). */
const HOSPITAL_COMMANDS: Command[] = [
  { type: "placeService", service: "hospital", x: 76, y: 141 },
  { type: "placeService", service: "hospital", x: 84, y: 141 },
  { type: "placeService", service: "hospital", x: 92, y: 141 },
  { type: "placeService", service: "hospital", x: 100, y: 141 },
];

/** Cidades já rodadas (não roda a mesma cidade duas vezes). */
const jogos = new Map<string, Game>();

function cidade(chave: string, commands: Command[]): Game {
  const pronto = jogos.get(chave);
  if (pronto) return pronto;
  const game = createTestGame({
    seed: SEED,
    scenario: "bairro-basico",
    days: DAYS,
    overrides: OVERRIDES,
    commands,
  });
  jogos.set(chave, game);
  return game;
}

/** Ids dos prédios ativos de um tipo do catálogo (ex.: "hospital" ou "ubs"). */
function ativosDoTipo(game: Game, tipo: string): number[] {
  const b = game.sim.buildings;
  const ids: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (b.isActive(i) && b.typeOf(i).id === tipo) ids.push(i);
  }
  return ids;
}

/** Capacidade de pacientes de um tipo, lida do catálogo (data/buildings.yaml). */
function capacidadeNoCatalogo(game: Game, tipo: string): number | undefined {
  const achado = game.sim.buildings.catalog.find((b) => b.id === tipo);
  expect(
    achado,
    `o tipo "${tipo}" deveria existir no catálogo data/buildings.yaml: sem ele o teste não prova nada`,
  ).toBeDefined();
  return achado?.patients;
}

/** Número no formato do relatório ("1.234" com ponto de milhar) de volta para number. */
function numeroDoRelatorio(texto: string): number {
  return Number(texto.replace(/\./g, ""));
}

describe("issue #174: leitos de internação no stats e no relatório (sem vaga de UBS)", () => {
  it("1. com 1 UBS e zero hospitais, hospitalBeds.total é 0 e o relatório não mostra leito", {
    timeout: 300000,
  }, () => {
    const game = cidade("ubs-sem-hospital", []);
    // Pré-condições (passam na main): a cidade tem a UBS do cenário ativa e nenhum hospital.
    const ubs = ativosDoTipo(game, "ubs");
    expect(
      ubs.length,
      "a cidade do critério 1 deveria ter a UBS do cenário (x73,y141) ativa: sem UBS presente " +
        "o total 0 não provaria a exclusão da vaga de UBS",
    ).toBeGreaterThan(0);
    for (const id of ubs) {
      expect(
        game.sim.buildings.patientsCapacity(id),
        `a UBS ativa ${id} deveria ter capacidade de pacientes maior que 0 (é a vaga de atenção ` +
          "básica que NÃO pode entrar na conta de leitos)",
      ).toBeGreaterThan(0);
    }
    expect(
      ativosDoTipo(game, "hospital"),
      "a cidade do critério 1 deveria ter ZERO hospitais (só a UBS do cenário): com hospital " +
        "presente o total 0 seria impossível",
    ).toHaveLength(0);
    // Chave nova (falha na main: a chave ainda não existe no contrato/stats).
    const beds = bedsOf(game);
    expect(typeof beds, SEM_CHAVE).toBe("object");
    if (beds === undefined) return;
    expect(typeof beds.total, `${SEM_CHAVE} (veio total do tipo ${typeof beds.total})`).toBe("number");
    expect(typeof beds.occupied, `${SEM_CHAVE} (veio occupied do tipo ${typeof beds.occupied})`).toBe(
      "number",
    );
    if (typeof beds.total !== "number" || typeof beds.occupied !== "number") return;
    expect(
      beds.total,
      `com ZERO hospitais o total de leitos deveria ser 0, mesmo com ${ubs.length} UBS ativa(s): ` +
        `a vaga de UBS (patients da ubs) NÃO é leito, mas veio ${beds.total}`,
    ).toBe(0);
    expect(
      beds.occupied,
      `sem nenhum hospital não há onde internar: occupied deveria ser 0, mas veio ${beds.occupied}`,
    ).toBe(0);
    // Sem hospital o relatório não pode mostrar leito nenhum: a regra aceita a linha ausente OU a
    // linha com 0 (a issue #174 diz "não tem a linha de leitos (ou mostra 0)"). O que não pode é
    // mostrar a vaga da UBS como se fosse leito.
    const texto = reportText(game);
    const linhaLeitos = texto.match(/Leitos de hospital: ([\d.]+) \(([\d.]+) ocupados\)/);
    if (linhaLeitos !== null) {
      const total = numeroDoRelatorio(linhaLeitos[1]!);
      const ocupados = numeroDoRelatorio(linhaLeitos[2]!);
      expect(
        total,
        `sem nenhum hospital a linha de leitos do relatório não pode contar a vaga da UBS ` +
          `(${ubs.length} UBS ativa(s), cada uma com capacidade de pacientes no catálogo): ` +
          `veio "${linhaLeitos[0]}"`,
      ).toBe(0);
      expect(
        ocupados,
        `sem nenhum hospital o relatório não pode mostrar leito ocupado: veio "${linhaLeitos[0]}"`,
      ).toBe(0);
    }
    const comNumeroDeLeito = texto
      .split("\n")
      .filter(
        (linha) =>
          !linha.startsWith("# ") &&
          /leito/i.test(linha) &&
          !/^Leitos de hospital: 0 \(0 ocupados\)$/.test(linha),
      );
    expect(
      comNumeroDeLeito,
      `o relatório de uma cidade sem hospital não deveria mostrar leito com número, mas mostrou: ` +
        `${JSON.stringify(comNumeroDeLeito)}`,
    ).toEqual([]);
  });

  it("2. com 4 hospitais ativos, total é 4 x capacidade do catálogo (UBS fora da conta)", {
    timeout: 300000,
  }, () => {
    const game = cidade("ubs-com-hospitais", HOSPITAL_COMMANDS);
    // Capacidades lidas do catálogo (data/buildings.yaml), sem número fixo no teste.
    const capHospital = capacidadeNoCatalogo(game, "hospital");
    const capUbs = capacidadeNoCatalogo(game, "ubs");
    if (capHospital === undefined || capUbs === undefined) return;
    expect(
      capHospital,
      'o tipo "hospital" deveria ter capacidade de pacientes (leitos) maior que 0 no catálogo',
    ).toBeGreaterThan(0);
    expect(
      capUbs,
      'o tipo "ubs" deveria ter capacidade de pacientes (vaga de atenção básica) maior que 0 no catálogo',
    ).toBeGreaterThan(0);
    // Pré-condições (passam na main): 4 hospitais ativos + UBS ativa presente.
    const hospitais = ativosDoTipo(game, "hospital");
    expect(
      hospitais.length,
      `os ${HOSPITAL_COMMANDS.length} hospitais deveriam estar ativos depois de ${DAYS} dias ` +
        "(a obra leva 30 meses = 2,5 dias): sem hospital ativo o teste não prova nada",
    ).toBe(HOSPITAL_COMMANDS.length);
    const ubs = ativosDoTipo(game, "ubs");
    expect(
      ubs.length,
      "o teste só vale se há UBS ativa presente nesta cidade: sem ela não dá para provar que a " +
        "vaga de UBS ficou fora da conta de leitos",
    ).toBeGreaterThan(0);
    // Soma das capacidades lida prédio a prédio (só hospitais ativos).
    let somaHospitais = 0;
    for (const id of hospitais) somaHospitais += game.sim.buildings.patientsCapacity(id);
    expect(
      somaHospitais,
      `cada hospital ativo deveria ter a capacidade do catálogo (${capHospital}): a soma dos ` +
        `${hospitais.length} hospitais deveria ser ${hospitais.length} x ${capHospital}`,
    ).toBe(hospitais.length * capHospital);
    // Chave nova (falha na main: a chave ainda não existe no contrato/stats).
    const beds = bedsOf(game);
    expect(typeof beds, SEM_CHAVE).toBe("object");
    if (beds === undefined) return;
    expect(typeof beds.total, `${SEM_CHAVE} (veio total do tipo ${typeof beds.total})`).toBe("number");
    expect(typeof beds.occupied, `${SEM_CHAVE} (veio occupied do tipo ${typeof beds.occupied})`).toBe(
      "number",
    );
    if (typeof beds.total !== "number" || typeof beds.occupied !== "number") return;
    expect(
      beds.total,
      `total deveria ser a soma das capacidades SÓ dos hospitais (${hospitais.length} x ${capHospital} ` +
        `lido do catálogo = ${somaHospitais}), sem a UBS, mas veio ${beds.total}`,
    ).toBe(somaHospitais);
    expect(
      beds.total,
      `total (${beds.total}) deveria ser bem menor que a conta errada que incluiria a UBS ativa ` +
        `(${capUbs} + ${somaHospitais} = ${capUbs + somaHospitais}): a vaga de UBS NÃO é leito`,
    ).toBeLessThan(capUbs + somaHospitais);
    expect(
      capUbs,
      `para o teste provar a exclusão, a capacidade da UBS (${capUbs}) tem que ser maior que o ` +
        `total de leitos (${beds.total}): senão o total caberia dentro da UBS e nada seria provado`,
    ).toBeGreaterThan(beds.total);
    expect(
      beds.occupied,
      `com ${hospitais.length} hospitais ativos era esperado ao menos 1 leito ocupado, mas veio ` +
        `${beds.occupied}: sem gente internada o teste não prova nada`,
    ).toBeGreaterThan(0);
    expect(
      beds.occupied,
      `occupied (${beds.occupied}) não pode passar do total de leitos (${beds.total})`,
    ).toBeLessThanOrEqual(beds.total);
  });

  it("3. occupied conta só pessoas com leito em hospital ativo", { timeout: 300000 }, () => {
    const game = cidade("ubs-com-hospitais", HOSPITAL_COMMANDS);
    // Chave nova (falha na main: a chave ainda não existe no contrato/stats).
    const beds = bedsOf(game);
    expect(typeof beds, SEM_CHAVE).toBe("object");
    if (beds === undefined) return;
    expect(typeof beds.total, `${SEM_CHAVE} (veio total do tipo ${typeof beds.total})`).toBe("number");
    expect(typeof beds.occupied, `${SEM_CHAVE} (veio occupied do tipo ${typeof beds.occupied})`).toBe(
      "number",
    );
    if (typeof beds.total !== "number" || typeof beds.occupied !== "number") return;
    const census = currentCensus(game);
    expect(
      census.population,
      "a cidade esvaziou (população 0): sem gente o teste não prova nada",
    ).toBeGreaterThan(0);
    expect(
      beds.occupied,
      `occupied (${beds.occupied}) não pode passar do total de leitos (${beds.total})`,
    ).toBeLessThanOrEqual(beds.total);
    expect(
      beds.occupied,
      `occupied (${beds.occupied}) não pode passar da população (${census.population})`,
    ).toBeLessThanOrEqual(census.population);
    // Contagem independente com o que é público: game.city.pop (array hospital por pessoa, -1 =
    // sem leito) e game.sim.buildings (isActive + typeOf, as mesmas APIs que o relatório usa).
    // Só conta quando o prédio do leito é um hospital ativo: leito em obra, abandonado ou
    // demolido não vale, e leito apontando para UBS (se um dia apontar) também não.
    const pop = game.city.pop;
    const predios = game.sim.buildings;
    let emHospitalAtivo = 0;
    for (let p = 0; p < pop.count; p++) {
      const leito = pop.hospital[p]!;
      if (leito < 0) continue;
      if (predios.isActive(leito) && predios.typeOf(leito).id === "hospital") emHospitalAtivo++;
    }
    expect(
      emHospitalAtivo,
      "era esperada ao menos 1 pessoa com leito em hospital ativo nesta cidade (há hospitais " +
        "ativos e gente sem UBS por perto): sem gente internada o teste não prova nada",
    ).toBeGreaterThan(0);
    expect(
      beds.occupied,
      `occupied (${beds.occupied}) deveria ser menor ou igual ao nº de pessoas com leito em ` +
        `hospital ativo (${emHospitalAtivo}): occupied não pode inventar gente internada`,
    ).toBeLessThanOrEqual(emHospitalAtivo);
  });

  it("4. o relatório mostra sem hospital e a linha de leitos com os valores do stats", {
    timeout: 300000,
  }, () => {
    const game = cidade("sem-ubs-com-hospitais", [BULLDOZE_UBS, ...HOSPITAL_COMMANDS]);
    const census = currentCensus(game);
    const s = statsView(game);
    expect(
      census.population,
      "a cidade esvaziou (população 0): sem gente o teste não prova nada",
    ).toBeGreaterThan(0);
    const texto = reportText(game);
    // "sem hospital: N" na linha de desejos não atendidos (falha na main: a linha não existe).
    // unmet.hospital já existe na main (issue #173), então esta parte só cobra o relatório.
    const achadoSem = texto.match(/sem hospital: ([\d.]+)/);
    expect(
      achadoSem,
      'o relatório deveria ter "sem hospital: N" na linha de desejos não atendidos ' +
        "(packages/sim/src/view/report.ts): a linha de desejos só tem sem UBS, sem água e sem luz",
    ).not.toBeNull();
    if (achadoSem === null) return;
    const nSem = numeroDoRelatorio(achadoSem[1]!);
    expect(
      nSem,
      `o "sem hospital: ${achadoSem[1]}" do relatório deveria valer unmet.hospital (${s.unmet.hospital})`,
    ).toBe(s.unmet.hospital);
    expect(
      nSem,
      `o "sem hospital: ${achadoSem[1]}" do relatório deveria valer withoutHospital do censo (${census.withoutHospital})`,
    ).toBe(census.withoutHospital);
    // Linha de leitos com os valores do stats (falha na main: chave e linha não existem).
    const beds = bedsOf(game);
    expect(typeof beds, SEM_CHAVE).toBe("object");
    if (beds === undefined) return;
    if (typeof beds.total !== "number" || typeof beds.occupied !== "number") {
      expect(typeof beds.total, `${SEM_CHAVE} (veio total do tipo ${typeof beds.total})`).toBe("number");
      return;
    }
    const achadoLeitos = texto.match(/Leitos de hospital: ([\d.]+) \(([\d.]+) ocupados\)/);
    expect(
      achadoLeitos,
      'o relatório deveria ter a linha "Leitos de hospital: X (Y ocupados)" ' +
        "(packages/sim/src/view/report.ts): a linha não existe",
    ).not.toBeNull();
    if (achadoLeitos === null) return;
    expect(
      numeroDoRelatorio(achadoLeitos[1]!),
      `o X da linha de leitos deveria ser hospitalBeds.total (${beds.total}), mas a linha diz "${achadoLeitos[0]}"`,
    ).toBe(beds.total);
    expect(
      numeroDoRelatorio(achadoLeitos[2]!),
      `o Y da linha de leitos deveria ser hospitalBeds.occupied (${beds.occupied}), mas a linha diz "${achadoLeitos[0]}"`,
    ).toBe(beds.occupied);
  });

  it("5. a cidade de referência não muda (só ganha a chave nova)", { timeout: 300000 }, () => {
    // Roda os cenários de referência e compara as chaves já existentes. O snapshot unitário
    // tem cobertura própria; este teste não lê o arquivo .snap para evitar acoplamento entre testes.
    // Roda o mesmo cenário do tests/unit/reference.test.ts e compara só as chaves já existentes
    // (ignora o bloco `hospitalBeds` de propósito: ele é a única mudança esperada).
    const scenario = loadScenario("bairro-basico");
    const { config, data } = loadConfigAndData({
      ...scenario.overrides,
      world: { width: 160, height: 256 },
    });
    const bairro = runGame({ config, data, seed: "referencia", days: 12, scenario });
    expect(
      impressaoParcial(bairro),
      "a cidade bairro-basico/12 dias mudou de comportamento: a entrega de leitos só pode " +
        "ADICIONAR a chave hospitalBeds, nunca mudar gente, prédio, evento ou unmet existente",
    ).toEqual(ESPERADO_BAIRRO);
    const padrao = loadConfigAndData();
    const bot = runGame({
      config: padrao.config,
      data: padrao.data,
      seed: "referencia-bot",
      days: 12,
      bot: true,
    });
    expect(
      impressaoParcial(bot),
      "a cidade do prefeito automático/12 dias mudou de comportamento: a entrega de leitos só pode " +
        "ADICIONAR a chave hospitalBeds, nunca mudar gente, prédio, evento ou unmet existente",
    ).toEqual(ESPERADO_BOT);
    // A chave nova existe e o restante do comportamento continua congelado acima.
    const beds = bedsOf(bairro);
    expect(
      typeof beds,
      "a entrega pede StatsView.hospitalBeds (total/occupied) no statsView: o snapshot do " +
        "tests/unit/reference.test.ts só pode mudar por essa chave nova (comportamento igual)",
    ).toBe("object");
  });
});

/**
 * Impressão parcial da cidade: as mesmas chaves do fingerprint do reference.test.ts, MENOS o
 * `lastYear` detalhado (receitas/despesas por categoria e viagens: continuam cobertos pelo
 * próprio snapshot) e SEM nenhuma chave nova. O unmet entra só com as chaves que já existem.
 */
function impressaoParcial(game: Game) {
  const s = statsView(game);
  const { city, sim } = game;
  const u = s.unmet;
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
    events: city.events.count,
    unmet: {
      school: u.school,
      university: u.university,
      health: u.health,
      hospital: u.hospital,
      housing: u.housing,
      job: u.job,
      transit: u.transit,
      parking: u.parking,
      water: u.water,
      power: u.power,
    },
  };
}

/** Números congelados do snapshot atual ("cenário bairro-basico, 12 dias"). */
const ESPERADO_BAIRRO = {
  tick: 17700,
  population: 2063,
  households: 739,
  employed: 973,
  unemployed: 63,
  children: 130,
  retired: 119,
  buildings: 274,
  cars: 272,
  money: 93332546,
  events: 13714,
  unmet: {
    school: 0,
    university: 0,
    health: 0,
    hospital: 2063,
    housing: 11,
    job: 63,
    transit: 0,
    parking: 0,
    water: 0,
    power: 0,
  },
};

/** Números congelados do snapshot atual ("prefeito automático, 12 dias"). */
const ESPERADO_BOT = {
  tick: 17700,
  population: 1404,
  households: 539,
  employed: 673,
  unemployed: 41,
  children: 109,
  retired: 64,
  buildings: 628,
  cars: 147,
  money: 3296044,
  events: 10362,
  unmet: {
    school: 0,
    university: 0,
    health: 0,
    hospital: 1404,
    housing: 0,
    job: 41,
    transit: 0,
    parking: 0,
    water: 0,
    power: 0,
  },
};
