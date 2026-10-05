/**
 * Teste de aceitação da issue #239, "Fila de internação e alta hospitalar" (papel QA).
 *
 * O que falta na main (por isso este teste FALHA antes da implementação):
 * - `City` (packages/sim/src/city.ts) não tem a fila `seekHospital` (IndexedSet),
 *   separada da `seekClinic`: hoje quem precisa de leito passa pela fila da UBS;
 * - não existe o `HospitalAdmissionSystem` (packages/sim/src/systems/), que a cada tick
 *   puxaria da fila `seekHospital`, acharia hospital com leito livre dentro de
 *   `config.health.hospitalMaxDistanceMeters` e chamaria `registerHospital`;
 *   ele entraria em packages/sim/src/game.ts entre `matching` e `lifecycle`;
 * - o `LifecycleSystem` (packages/sim/src/systems/lifecycle.ts) não sorteia no aniversário
 *   quem precisa de internação (chance `config.health.hospitalAdmissionRatePerYear` por ano,
 *   sorteio por `city.rng.life`): ninguém entra na fila `seekHospital`;
 * - ninguém recebe alta: falta a chance diária de alta `1 / hospitalAvgLengthOfStayDays`
 *   (sorteio por `city.rng.life`) chamando `unregisterHospital` para devolver o leito.
 * Os dois campos novos da config (`hospitalAdmissionRatePerYear` e
 * `hospitalAvgLengthOfStayDays`) ainda não existem nem em config/health.yaml nem no schema
 * (issue #238 separada). O schema é zod sem `strict` e descarta chaves desconhecidas em
 * silêncio: os overrides com esses campos são ignorados na main, então as cidades de
 * comparação ficam idênticas e os `it` 6 e 7 falham do jeito certo (nada muda), sem erro.
 *
 * Um `it` por critério do "tá pronto quando":
 * 1. a fila `seekHospital` existe e é um IndexedSet, separada da `seekClinic`;
 * 2. existe o sistema `hospitalAdmission` registrado entre `matching` e `lifecycle`;
 * 3. a fila é admitida em leito livre dentro de `hospitalMaxDistanceMeters`;
 * 4. respeita o limite de distância: pessoa longe do hospital continua na fila;
 * 5. sem leito livre a pessoa continua na fila (e não ocupa leito);
 * 6. no aniversário a internação é sorteada por `hospitalAdmissionRatePerYear`;
 * 7. a alta libera o leito e devolve a vaga ao mercado, na cadência de
 *    `hospitalAvgLengthOfStayDays`.
 *
 * Cidades: cenário "bairro-basico" com dinheiro infinito (sandbox) e UBS a 200 m
 * (mesmos overrides dos testes 119/174), mais 4 hospitais lado a lado (x 76/84/92/100,
 * y 141). O hospital leva 30 meses de obra = 2,5 dias, então DAYS = 80 basta.
 * Semente fixa em todas as cidades, sem relógio, sem `Math.random`. Cada cidade roda
 * uma única vez (Map memoizado); quando dois `it` comparam cidades, só o override
 * testado muda (mesma semente e mesmos comandos).
 */
import type { Command } from "@city/contract";
import { BSTATE, type Game } from "@city/sim";
import { describe, expect, it } from "vitest";
import { registerHospital, unregisterHospital } from "../../packages/sim/src/people/actions";
import { HospitalAdmissionSystem } from "../../packages/sim/src/systems/hospitalAdmission";
import { createTestGame } from "../helpers";

/** Fila nova da issue #239 (ainda não existe na main): mesmo formato da IndexedSet. */
interface FilaInternacao {
  size: number;
  add(v: number): void;
  has(v: number): boolean;
  delete(v: number): void;
  at(i: number): number;
  toArray(): number[];
}

/** A cidade com a fila nova (ainda ausente): acesso tolerante, sem `as any`. */
interface CidadeComFila {
  seekHospital?: FilaInternacao;
}

function filaDe(game: Game): FilaInternacao | undefined {
  return (game.city as unknown as CidadeComFila).seekHospital;
}

/** Campos novos da config da issue #239 (ainda não existem: issue #238 separada). */
interface SaudeNova {
  hospitalAdmissionRatePerYear?: unknown;
  hospitalAvgLengthOfStayDays?: unknown;
}

function saudeNova(game: Game): SaudeNova {
  return game.sim.config.health as unknown as SaudeNova;
}

/** Semente fixa do arquivo (nada de relógio nem `Math.random`). */
const SEED = "fila-internacao-alta";
/** Dias de jogo (o hospital leva 30 meses de obra = 2,5 dias, então 80 basta). */
const DAYS = 80;

/** Dinheiro infinito + UBS a 200 m (iguais aos dos testes 119/174). */
const OVERRIDES_BASE = { economy: { mode: "sandbox" }, health: { maxDistanceMeters: 200 } };

/** Quatro hospitais lado a lado (mesmos dos testes 119/174, para ter leito de sobra). */
const HOSPITAL_COMMANDS: Command[] = [
  { type: "placeService", service: "hospital", x: 76, y: 141 },
  { type: "placeService", service: "hospital", x: 84, y: 141 },
  { type: "placeService", service: "hospital", x: 92, y: 141 },
  { type: "placeService", service: "hospital", x: 100, y: 141 },
];

/** Cidades já rodadas (não roda a mesma cidade duas vezes). */
const jogos = new Map<string, Game>();

function cidade(chave: string, overrides: Record<string, unknown>): Game {
  const pronto = jogos.get(chave);
  if (pronto) return pronto;
  const game = createTestGame({
    seed: SEED,
    scenario: "bairro-basico",
    days: DAYS,
    overrides,
    commands: HOSPITAL_COMMANDS,
  });
  jogos.set(chave, game);
  return game;
}

/** Ids dos prédios ativos de um tipo do catálogo (ex.: "hospital"). */
function ativosDoTipo(game: Game, tipo: string): number[] {
  const b = game.sim.buildings;
  const ids: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (b.state[i] !== BSTATE.active) continue;
    if (b.typeOf(i).id !== tipo) continue;
    ids.push(i);
  }
  return ids;
}

/** Capacidade de pacientes de um tipo, lida do catálogo (data/buildings.yaml). */
function capacidadeNoCatalogo(game: Game, tipo: string): number | undefined {
  const achado = game.sim.buildings.catalog.find((b) => b.id === tipo);
  expect(
    achado,
    `o tipo "${tipo}" deveria existir no catálogo data/buildings.yaml: ` + `sem ele o teste não prova nada`,
  ).toBeDefined();
  return achado?.patients;
}

/** Leito de cada pessoa (-1 = sem leito). Existe na main (issue #119). */
function leitosPorPessoa(game: Game): Int32Array | undefined {
  return (game.city.pop as unknown as { hospital?: Int32Array }).hospital;
}

/** Pessoas vivas com leito em hospital ativo (só conta o que o mercado conta). */
function pessoasComLeito(game: Game): number {
  const leitos = leitosPorPessoa(game);
  if (leitos === undefined) return 0;
  const pop = game.city.pop;
  let n = 0;
  for (let p = 0; p < pop.count; p++) {
    if (pop.status[p] !== 1) continue; // 1 = viva (PSTATUS.alive)
    const b = leitos[p]!;
    if (b < 0) continue;
    if (game.sim.buildings.isActive(b) && game.sim.buildings.typeOf(b).id === "hospital") n++;
  }
  return n;
}

/** Pessoas vivas (1 = viva, como em PSTATUS.alive). */
function contaVivos(game: Game): number {
  const pop = game.city.pop;
  let n = 0;
  for (let p = 0; p < pop.count; p++) if (pop.status[p] === 1) n++;
  return n;
}

/**
 * Primeira pessoa viva com casa, sem leito e (se pedido) fora da fila da UBS.
 * Fora da `seekClinic` de propósito: senão o `matching` a internaria pelo caminho
 * antigo e o teste não provaria que foi o sistema novo. Pessoas já usadas vão em
 * `exceto` para não repetir.
 */
function primeiraPessoaComCasa(game: Game, foraDaFilaDaUbs: boolean, exceto?: Set<number>): number {
  const city = game.city;
  const leitos = leitosPorPessoa(game);
  for (let p = 0; p < city.pop.count; p++) {
    if (city.pop.status[p] !== 1) continue; // 1 = viva (PSTATUS.alive)
    if (exceto?.has(p)) continue;
    if (city.homeAccess(p) < 0) continue;
    if (leitos !== undefined && leitos[p]! >= 0) continue;
    if (foraDaFilaDaUbs && city.seekClinic.has(p)) continue;
    return p;
  }
  return -1;
}

/** Menor distância (Manhattan, em metros) da casa da pessoa até um hospital ativo. */
function distanciaMinimaAteHospital(game: Game, p: number, hospitais: number[]): number {
  const de = game.city.homeAccess(p);
  let menor = Number.POSITIVE_INFINITY;
  for (const h of hospitais) {
    const dist = game.sim.world.manhattanMeters(de, game.sim.buildings.access[h]!);
    if (dist < menor) menor = dist;
  }
  return menor;
}

describe("issue #239: fila de internação e alta hospitalar", () => {
  it("1. a fila `seekHospital` existe e é um IndexedSet, separada da `seekClinic`", () => {
    const game = cidade("base", OVERRIDES_BASE);
    const fila = filaDe(game);
    expect(
      typeof fila,
      "a cidade ainda não tem a fila `seekHospital` (packages/sim/src/city.ts, uma IndexedSet " +
        "como a `seekClinic`): sem essa fila separada não há onde pedir internação",
    ).not.toBe("undefined");
    if (fila === undefined) return;
    expect(
      typeof fila.size,
      "a fila `seekHospital` deveria ter `size` number como a IndexedSet " +
        `(packages/sim/src/core/indexedSet.ts), mas veio ${typeof fila.size}`,
    ).toBe("number");
    for (const metodo of ["add", "has", "delete", "at", "toArray"] as const) {
      expect(
        typeof fila[metodo],
        `a fila \`seekHospital\` deveria ter o método \`${metodo}\` como a IndexedSet, ` +
          `mas veio ${typeof fila[metodo]}`,
      ).toBe("function");
    }
    const p = primeiraPessoaComCasa(game, true);
    expect(
      p,
      "a cidade esvaziou ou ninguém tem casa fora da fila da UBS: sem gente o teste não prova nada",
    ).toBeGreaterThanOrEqual(0);
    if (p < 0) return;
    const tamanhoClinicaAntes = game.city.seekClinic.size;
    fila.add(p);
    expect(
      fila.has(p),
      `a fila \`seekHospital\` não guardou a pessoa ${p} depois de add: o add não funciona`,
    ).toBe(true);
    expect(
      fila.toArray(),
      `a fila \`seekHospital\` deveria listar a pessoa ${p} em toArray() depois de add`,
    ).toContain(p);
    expect(
      game.city.seekClinic.has(p),
      `colocar a pessoa ${p} na fila \`seekHospital\` mexeu na \`seekClinic\`: ` +
        `as filas têm que ser separadas (internação não é consulta na UBS)`,
    ).toBe(false);
    expect(
      game.city.seekClinic.size,
      "colocar alguém na fila `seekHospital` mudou o tamanho da `seekClinic` " +
        `(${tamanhoClinicaAntes} -> ${game.city.seekClinic.size}): as filas têm que ser separadas`,
    ).toBe(tamanhoClinicaAntes);
    fila.delete(p);
    expect(
      fila.has(p),
      `a fila \`seekHospital\` ainda tem a pessoa ${p} depois de delete: o delete não funciona`,
    ).toBe(false);
  });

  it("2. existe o sistema `hospitalAdmission` registrado entre `matching` e `lifecycle`", () => {
    const game = cidade("base", OVERRIDES_BASE);
    const nomes = game.sim.systems.map((s) => s.name);
    const iMatch = nomes.indexOf("matching");
    const iAdm = nomes.indexOf("hospitalAdmission");
    const iLife = nomes.indexOf("lifecycle");
    expect(
      nomes,
      "o motor ainda não tem o `HospitalAdmissionSystem` registrado em packages/sim/src/game.ts " +
        `(sistemas de hoje: ${nomes.join(", ")}): sem ele ninguém sai da fila de internação`,
    ).toContain("hospitalAdmission");
    if (iAdm < 0) return;
    expect(
      iMatch,
      "o sistema `matching` sumiu da lista de sistemas: sem ele a ordem não prova nada",
    ).toBeGreaterThanOrEqual(0);
    expect(
      iLife,
      "o sistema `lifecycle` sumiu da lista de sistemas: sem ele a ordem não prova nada",
    ).toBeGreaterThanOrEqual(0);
    expect(
      iLife < iMatch,
      `a ordem histórica lifecycle -> matching precisa ser preservada (lifecycle=${iLife}, matching=${iMatch}): ` +
        "reordená-los muda escola, UBS e comportamento do prefeito em cidades sem hospital",
    ).toBe(true);
    expect(
      iAdm > iMatch,
      `o \`hospitalAdmission\` (posição ${iAdm}) deveria rodar DEPOIS do \`matching\` ` +
        `(posição ${iMatch}) em packages/sim/src/game.ts: a fila da UBS resolve primeiro`,
    ).toBe(true);
  });

  it("3. a fila é admitida em leito livre dentro de `hospitalMaxDistanceMeters`", () => {
    const game = cidade("adm", OVERRIDES_BASE);
    const cap = capacidadeNoCatalogo(game, "hospital");
    if (cap === undefined) return;
    expect(
      cap,
      'o tipo "hospital" deveria ter capacidade de pacientes (leitos) maior que 0 no catálogo',
    ).toBeGreaterThan(0);
    const hospitais = ativosDoTipo(game, "hospital");
    expect(
      hospitais.length,
      `os ${HOSPITAL_COMMANDS.length} hospitais deveriam estar ativos depois de ${DAYS} dias ` +
        `(a obra leva 30 meses = 2,5 dias): sem hospital ativo o teste não prova nada`,
    ).toBe(HOSPITAL_COMMANDS.length);
    // Garante vaga: se o mercado secou, libera um leito existente (cidade só deste `it`).
    if (game.city.markets.hospitals.vacancies() === 0) {
      const leitos = leitosPorPessoa(game);
      if (leitos !== undefined) {
        for (let q = 0; q < game.city.pop.count; q++) {
          if (game.city.pop.status[q] !== 1) continue;
          if (leitos[q]! >= 0) {
            unregisterHospital(game.city, q);
            break;
          }
        }
      }
    }
    expect(
      game.city.markets.hospitals.vacancies(),
      "o mercado de hospitais não tem vaga nem depois de liberar um leito: sem vaga " +
        "o teste não prova nada",
    ).toBeGreaterThan(0);
    const p = primeiraPessoaComCasa(game, true);
    expect(
      p,
      "ninguém vivo com casa fora da fila da UBS: sem essa pessoa o teste não prova nada " +
        "(ela prova que foi o sistema novo, não o caminho antigo do `matching`)",
    ).toBeGreaterThanOrEqual(0);
    if (p < 0) return;
    const fila = filaDe(game);
    expect(
      typeof fila,
      "a cidade ainda não tem a fila `seekHospital` (packages/sim/src/city.ts): " +
        "sem ela não há pedido de internação para admitir",
    ).not.toBe("undefined");
    if (fila === undefined) return;
    let ocupadosAntes = 0;
    for (const h of hospitais) ocupadosAntes += game.sim.buildings.patients[h]!;
    fila.add(p);
    // Testa somente a admissão: um sim.step() também rodaria LifecycleSystem e poderia
    // liberar um leito por alta antes da admissão, deixando de ser um cenário "sem vaga".
    new HospitalAdmissionSystem(game.city).tick();
    expect(
      fila.has(p),
      `a pessoa ${p} continua na fila \`seekHospital\` depois de 1 tick: ` +
        `sem o \`HospitalAdmissionSystem\` ninguém sai da fila (nada consome o pedido)`,
    ).toBe(false);
    const leitos = leitosPorPessoa(game);
    expect(
      leitos?.[p],
      `a pessoa ${p} saiu da fila mas não ganhou leito (pop.hospital vale ${leitos?.[p]}): ` +
        "a admissão deveria chamar `registerHospital`",
    ).toBeGreaterThanOrEqual(0);
    if (leitos === undefined || leitos[p]! < 0) return;
    const leito = leitos[p]!;
    expect(
      game.sim.buildings.typeOf(leito).id,
      `a pessoa ${p} foi registrada no prédio ${leito}, que é do tipo ` +
        `"${game.sim.buildings.typeOf(leito).id}" e não "hospital": o leito tem que ser de hospital`,
    ).toBe("hospital");
    expect(
      game.sim.buildings.state[leito],
      `o prédio ${leito} do leito da pessoa ${p} não está ativo (state ` +
        `${game.sim.buildings.state[leito]}): o leito tem que ser de hospital funcionando`,
    ).toBe(BSTATE.active);
    let ocupadosDepois = 0;
    for (const h of hospitais) ocupadosDepois += game.sim.buildings.patients[h]!;
    expect(
      ocupadosDepois,
      `a ocupação dos hospitais deveria ter subido de ${ocupadosAntes} com a internação ` +
        `da pessoa ${p}, mas vale ${ocupadosDepois}: o leito não foi ocupado de verdade`,
    ).toBeGreaterThan(ocupadosAntes);
  });

  it("4. respeita o limite de distância: pessoa longe do hospital continua na fila", () => {
    const limite = 50;
    const game = cidade("dist-curta", {
      economy: { mode: "sandbox" },
      health: { maxDistanceMeters: 200, hospitalMaxDistanceMeters: limite },
    });
    expect(
      game.sim.config.health.hospitalMaxDistanceMeters,
      `o override deveria fixar health.hospitalMaxDistanceMeters em ${limite} m, mas veio ` +
        `${game.sim.config.health.hospitalMaxDistanceMeters} m: sem o alcance curto o teste não prova`,
    ).toBe(limite);
    const hospitais = ativosDoTipo(game, "hospital");
    expect(
      hospitais.length,
      `os ${HOSPITAL_COMMANDS.length} hospitais deveriam estar ativos depois de ${DAYS} dias ` +
        `(a obra leva 30 meses = 2,5 dias): sem hospital ativo o teste não prova nada`,
    ).toBe(HOSPITAL_COMMANDS.length);
    const fila = filaDe(game);
    expect(
      typeof fila,
      "a cidade ainda não tem a fila `seekHospital` (packages/sim/src/city.ts): " +
        "sem ela não há como provar que a distância segura a pessoa na fila",
    ).not.toBe("undefined");
    if (fila === undefined) return;
    // Pessoa cuja casa fica a mais de `limite` de TODO hospital ativo (senão o alcance
    // curto não a barraria). A conta usa world.manhattanMeters, que já dá metros.
    let p = -1;
    let dist = 0;
    const exceto = new Set<number>();
    for (let t = 0; t < game.city.pop.count; t++) {
      const cand = primeiraPessoaComCasa(game, true, exceto);
      if (cand < 0) break;
      exceto.add(cand);
      const d = distanciaMinimaAteHospital(game, cand, hospitais);
      if (d > limite) {
        p = cand;
        dist = d;
        break;
      }
    }
    expect(
      p,
      `ninguém mora a mais de ${limite} m de todos os ${hospitais.length} hospitais ativos: ` +
        "sem essa pessoa longe o alcance curto não barra ninguém e o teste não prova nada",
    ).toBeGreaterThanOrEqual(0);
    if (p < 0) return;
    fila.add(p);
    game.sim.step(1);
    expect(
      fila.has(p),
      `a pessoa ${p} (casa a ${dist} m do hospital mais próximo) saiu da fila com o limite ` +
        `em ${limite} m: a admissão deveria respeitar hospitalMaxDistanceMeters da config`,
    ).toBe(true);
    expect(
      leitosPorPessoa(game)?.[p],
      `a pessoa ${p} (casa a ${dist} m do hospital mais próximo, limite ${limite} m) ganhou ` +
        "leito mesmo longe: a admissão ignorou hospitalMaxDistanceMeters da config",
    ).toBe(-1);
    // Nota: o mesmo override encurta o caminho antigo do `matching` (que também usa
    // hospitalMaxDistanceMeters), e é justamente isso que deixa a cidade controlada:
    // nenhum dos dois caminhos alcança a pessoa, então ela prova o limite do sistema novo.
  });

  it("5. sem leito livre a pessoa continua na fila (e não ocupa leito)", () => {
    const game = cidade("cheio", OVERRIDES_BASE);
    const cap = capacidadeNoCatalogo(game, "hospital");
    if (cap === undefined) return;
    expect(
      cap,
      'o tipo "hospital" deveria ter capacidade de pacientes (leitos) maior que 0 no catálogo',
    ).toBeGreaterThan(0);
    const hospitais = ativosDoTipo(game, "hospital");
    expect(
      hospitais.length,
      `os ${HOSPITAL_COMMANDS.length} hospitais deveriam estar ativos depois de ${DAYS} dias ` +
        `(a obra leva 30 meses = 2,5 dias): sem hospital ativo o teste não prova nada`,
    ).toBe(HOSPITAL_COMMANDS.length);
    // Enche TODOS os hospitais até patients == patientsCapacity (usa a capacidade do
    // catálogo, sem número fixo). Cidade só deste `it`, então pode lotar e esvaziar.
    const enchidos: number[] = [];
    const usados = new Set<number>();
    for (const h of hospitais) {
      while (game.sim.buildings.patients[h]! < game.sim.buildings.patientsCapacity(h)) {
        const q = primeiraPessoaComCasa(game, false, usados);
        if (q < 0) break;
        usados.add(q);
        registerHospital(game.city, q, h);
        enchidos.push(q);
      }
    }
    for (const h of hospitais) {
      expect(
        game.sim.buildings.patients[h],
        `o hospital ${h} deveria estar cheio (patients == patientsCapacity == ` +
          `${game.sim.buildings.patientsCapacity(h)} lido do catálogo), mas tem ` +
          `${game.sim.buildings.patients[h]}: sem lotar não dá para provar a falta de vaga`,
      ).toBe(game.sim.buildings.patientsCapacity(h));
    }
    expect(
      game.city.markets.hospitals.vacancies(),
      "com todos os hospitais cheios o mercado ainda anuncia vaga: a conta de vacancies() " +
        "não bate com a capacidade do catálogo",
    ).toBe(0);
    const fila = filaDe(game);
    expect(
      typeof fila,
      "a cidade ainda não tem a fila `seekHospital` (packages/sim/src/city.ts): " +
        "sem ela não há como provar que a falta de leito segura a pessoa na fila",
    ).not.toBe("undefined");
    if (fila === undefined) return;
    const p = primeiraPessoaComCasa(game, true, usados);
    expect(
      p,
      "não sobrou ninguém vivo com casa fora da fila da UBS para pedir leito: sem essa " +
        "pessoa nova o teste não prova nada",
    ).toBeGreaterThanOrEqual(0);
    if (p < 0) return;
    game.city.seekClinic.delete(p);
    fila.add(p);
    game.sim.step(1);
    expect(
      fila.has(p),
      `a pessoa ${p} saiu da fila \`seekHospital\` sem haver leito livre: ` +
        "a admissão deveria segurar o pedido na fila quando patients == patientsCapacity",
    ).toBe(true);
    expect(
      leitosPorPessoa(game)?.[p],
      `a pessoa ${p} ganhou leito (pop.hospital vale ${leitosPorPessoa(game)?.[p]}) mesmo ` +
        "com todos os hospitais cheios: a admissão ocupou leito que não existe",
    ).toBe(-1);
    expect(
      game.city.markets.hospitals.vacancies(),
      "depois de 1 tick o mercado anuncia vaga que não existe (todos os hospitais " +
        "continuam cheios): vacancies() deveria continuar 0",
    ).toBe(0);
    // Desfaz a lotação: os leitos voltam ao mercado (prova de que a capacidade usada
    // é a do catálogo, não um número fixo do teste).
    for (const q of enchidos) unregisterHospital(game.city, q);
    expect(
      game.city.markets.hospitals.vacancies(),
      `depois de desregistrar as ${enchidos.length} pessoas lotadas, o mercado deveria ` +
        "anunciar vaga de novo (vacancies() > 0): o leito não voltou ao mercado",
    ).toBeGreaterThan(0);
  });

  it("6. no aniversário a internação é sorteada por `hospitalAdmissionRatePerYear`", () => {
    const jogo1 = cidade("taxa-1", {
      economy: { mode: "sandbox" },
      health: { maxDistanceMeters: 200, hospitalAdmissionRatePerYear: 1 },
    });
    const jogo0 = cidade("taxa-minima", {
      economy: { mode: "sandbox" },
      health: { maxDistanceMeters: 200, hospitalAdmissionRatePerYear: 0.0001 },
    });
    // Pré-condições (passam na main): mesma gente e mesmos leitos nas duas cidades.
    for (const [nome, jogo] of [
      ["taxa 1", jogo1],
      ["taxa mínima (0.0001)", jogo0],
    ] as const) {
      expect(
        contaVivos(jogo),
        `a cidade ${nome} esvaziou (população 0): sem gente o teste não prova nada`,
      ).toBeGreaterThan(0);
      expect(
        ativosDoTipo(jogo, "hospital").length,
        `a cidade ${nome} deveria ter os ${HOSPITAL_COMMANDS.length} hospitais ativos ` +
          `depois de ${DAYS} dias: sem hospital o teste não prova nada`,
      ).toBe(HOSPITAL_COMMANDS.length);
    }
    // Só muda o override da taxa (mesma semente, mesmos comandos, mesmos dias).
    const n1 = pessoasComLeito(jogo1);
    const n0 = pessoasComLeito(jogo0);
    expect(
      n1 > n0,
      `a cidade com taxa 1 internou ${n1} pessoas e a com taxa mínima (0.0001) internou ${n0}: ` +
        "com hospitalAdmissionRatePerYear = 1 todo aniversário com doença pede internação " +
        "(sorteio por city.rng.hospital no LifecycleSystem), então a taxa 1 deveria ter MAIS " +
        "gente internada; a taxa mínima usa 0.0001 (e não 0) porque o schema exige valor >0 " +
        "(pos.max(1)); na main sem o sorteio do LifecycleSystem ninguém entra na fila nova " +
        "e as cidades ficam iguais",
    ).toBe(true);
    let totalLeitos = 0;
    for (const h of ativosDoTipo(jogo1, "hospital")) totalLeitos += jogo1.sim.buildings.patientsCapacity(h);
    expect(
      totalLeitos,
      `os ${HOSPITAL_COMMANDS.length} hospitais ativos deveriam somar leitos ` +
        `(patientsCapacity): sem leito o teste não prova nada`,
    ).toBeGreaterThan(0);
    expect(
      n1 > 0,
      `a cidade com taxa 1 tem ${n1} internados: ` +
        "com taxa máxima algum aniversário sorteia internação (sorteio por city.rng.life no " +
        "LifecycleSystem), então deveria ter gente internada; na main sem o sorteio ninguém " +
        "entra na fila nova por esse caminho",
    ).toBe(true);
    expect(
      n1 <= totalLeitos,
      `a cidade com taxa 1 tem ${n1} internados para ${totalLeitos} leitos no total: ` +
        "a admissão respeita o limite de leitos, ninguém pode ocupar leito que não existe; " +
        "nem todo mundo fica doente no aniversário, então a cidade não precisa ficar cheia",
    ).toBe(true);
    // A cidade da taxa mínima (0.0001, positiva porque o schema exige >0) NÃO tem limiar de ocupação: sem o sorteio do aniversário, o caminho
    // antigo (sem UBS por perto, o `matching` tenta o hospital) continua internando gente, e
    // com taxa 1 o lifecycle empurra a cidade inteira contra o mesmo limite de leitos. Por isso
    // a prova aqui é a diferença entre as duas cidades (n1 > n0), não um número de ocupação.
  });

  it("7. a alta libera o leito e devolve a vaga ao mercado, na cadência de `hospitalAvgLengthOfStayDays`", () => {
    // (a) Controle pontual: internação forçada, espera curta, alta forçada.
    const pontual = cidade("alta-pontual", OVERRIDES_BASE);
    const permanencia = saudeNova(pontual).hospitalAvgLengthOfStayDays;
    expect(
      typeof permanencia,
      "a config ainda não tem `health.hospitalAvgLengthOfStayDays` (config/health.yaml + " +
        "schema, issue #238 separada): sem esse número não há cadência de alta",
    ).toBe("number");
    if (typeof permanencia !== "number") return;
    expect(
      permanencia,
      `a permanência média padrão deveria ser maior que 1 dia, mas vale ${permanencia}: ` +
        "sem uma permanência padrão de dias o controle pontual não prova nada",
    ).toBeGreaterThan(1);
    const hospitais = ativosDoTipo(pontual, "hospital");
    expect(
      hospitais.length,
      `os ${HOSPITAL_COMMANDS.length} hospitais deveriam estar ativos depois de ${DAYS} dias: ` +
        "sem hospital ativo o teste não prova nada",
    ).toBe(HOSPITAL_COMMANDS.length);
    const h = hospitais[0]!;
    const p = primeiraPessoaComCasa(pontual, true);
    expect(
      p,
      "ninguém vivo com casa fora da fila da UBS: sem essa pessoa o teste não prova nada",
    ).toBeGreaterThanOrEqual(0);
    if (p < 0) return;
    const antes = pontual.sim.buildings.patients[h]!;
    registerHospital(pontual.city, p, h);
    expect(
      pontual.sim.buildings.patients[h],
      `registrar a pessoa ${p} no hospital ${h} deveria ocupar 1 leito ` +
        `(${antes} -> ${antes + 1}), mas vale ${pontual.sim.buildings.patients[h]}`,
    ).toBe(antes + 1);
    // Como 1 dia do jogo representa 1 ano, 5,3 dias reais são só ~21 ticks com
    // minutesPerTick=1. A cadência probabilística é verificada abaixo comparando permanências.
    const meanStayTicks = (permanencia / 365) * pontual.sim.clock.ticksPerDay;
    expect(meanStayTicks, "a permanência padrão deveria ocupar mais de um tick").toBeGreaterThan(1);
    const antesDaAlta = pontual.sim.buildings.patients[h]!;
    unregisterHospital(pontual.city, p);
    expect(
      leitosPorPessoa(pontual)?.[p],
      `a pessoa ${p} continua com leito (${leitosPorPessoa(pontual)?.[p]}) depois da alta: ` +
        "unregisterHospital deveria soltar o leito (pop.hospital = -1)",
    ).toBe(-1);
    expect(
      pontual.sim.buildings.patients[h],
      `a alta da pessoa ${p} deveria liberar exatamente o leito dela no hospital ${h} ` +
        `(${antesDaAlta} -> ${antesDaAlta - 1}), mas vale ${pontual.sim.buildings.patients[h]}`,
    ).toBe(antesDaAlta - 1);
    expect(
      pontual.city.markets.hospitals.open.has(h),
      `depois da alta o hospital ${h} deveria voltar ao mercado (open.has): ` +
        "o leito liberado não voltou ao mercado de hospitais",
    ).toBe(true);
    // (b) Cadência: só muda a permanência (mesma semente, mesmos comandos, mesmos dias).
    const curta = cidade("stay-curta", {
      economy: { mode: "sandbox" },
      health: { maxDistanceMeters: 200, hospitalAvgLengthOfStayDays: 0.01 },
    });
    const padrao = cidade("base", OVERRIDES_BASE);
    for (const [nome, jogo] of [
      ["permanência curta", curta],
      ["permanência padrão", padrao],
    ] as const) {
      expect(
        contaVivos(jogo),
        `a cidade ${nome} esvaziou (população 0): sem gente o teste não prova nada`,
      ).toBeGreaterThan(0);
      expect(
        ativosDoTipo(jogo, "hospital").length,
        `a cidade ${nome} deveria ter os ${HOSPITAL_COMMANDS.length} hospitais ativos: ` +
          "sem hospital o teste não prova nada",
      ).toBe(HOSPITAL_COMMANDS.length);
    }
    const leitosPorLeito = (jogo: Game): number => {
      const ids = ativosDoTipo(jogo, "hospital");
      let total = 0;
      for (const id of ids) total += jogo.sim.buildings.patientsCapacity(id);
      if (total === 0) return 0;
      return pessoasComLeito(jogo) / total;
    };
    const taxaCurta = leitosPorLeito(curta);
    const taxaPadrao = leitosPorLeito(padrao);
    expect(
      taxaCurta < taxaPadrao / 4,
      `a cidade de permanência curta (0,01 dia) tem ${taxaCurta.toFixed(3)} internados por ` +
        `leito e a padrão tem ${taxaPadrao.toFixed(3)}: com alta quase todo dia a ocupação ` +
        "deveria ser bem menos de um quarto da padrão; na main o campo nem existe no " +
        "schema e as duas cidades ficam iguais. Sem este critério a alta poderia ser " +
        "instantânea ou nunca acontecer e ninguém perceberia",
    ).toBe(true);
  });
});
