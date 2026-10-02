/**
 * Issue #223 (item #28/5) - sem esgoto aumenta o risco de morte das crianças.
 *
 * O que ainda falta na main (por isso este arquivo FALHA antes da implementação):
 * hoje o esgoto é só desejo não atendido e número. `config/health.yaml` não tem nenhum
 * número de esgoto e `packages/sim/src/systems/lifecycle.ts:56` é o único lugar do motor que mexe
 * no risco de morte (o da UBS). Busca por `hasSewage` no motor só acha `world/buildings.ts` (o array),
 * `systems/utilities.ts` (quem preenche) e `people/census.ts` (quem conta): nenhum efeito na saúde.
 *
 * Um `it` por critério do "tá pronto quando":
 *
 * 1. `config/health.yaml` tem `unseweredChildMortalityMultiplier` com o valor da fonte (1,39 = 1 / 0,72),
 *    a fonte do RR 0,72 (Wolf et al., 2014, doi 10.1111/tmi.12329) e o comentário do limite etário
 *    (só menor de 5 anos). A chave também tem que passar pelo schema da config.
 * 2. Mesma cidade e mesma semente, só o multiplicador muda: uma execução com ele colado em 1
 *    (quer dizer "sem o efeito") e outra com ele alto. A segunda tem MAIS mortes de recém-nascidos na
 *    janela, e a `mortalidade infantil` do placar sobe.
 * 3. O efeito é só nas crianças: as mortes de quem já passou da primeira infância (adultos de
 *    25 anos, na MESMA casa sem esgoto) são exatamente as mesmas nas duas execuções. A fonte
 *    é de diarréia infantil: acima de 5 anos o número não tem fonte, então não pode mudar.
 * 4. Com a ETE atendendo a malha (`hasSewage = 1` em todo mundo), o multiplicador não muda nada:
 *    quem tem esgoto não paga o número.
 * 5. Com `utilities.enabled: false` o número não muda: com saneamento desligado ninguém está sem
 *    esgoto, do mesmo jeito que ninguém está sem água.
 *
 * Desenho (tudo medido antes de escrever, nenhum número chutado):
 *
 * - A cidade é a malha do teste #108 (`achaPontoDaEte` + `montaMalhaDaEte`, os mesmos dois helpers),
 *   com `regionalSewage: 15`: a cidade cresce e o esgoto regional não acompanha, então existem casas
 *   COM água e SEM esgoto. Medido: sem ETE, 5 casas com esgoto e 22 sem; com a ETE, 24 com e 0 sem.
 *   O ponto da ETE é procurado no mapa (a ETE tem `nearWater: 3`) e a via que liga a malha á borda
 *   também é verificada contra a água, então a montagem não depende do rio cair num canto.
 * - A população das casas vem do caminho real do jogo (imigração) em 60 dias de cidade, e a
 *   comparação de mortes é uma COORTE injetada (o mesmo desenho do teste da #121): uma mãe por
 *   familia e, alternadamente, um recém-nascido e um adulto de 25 anos, todos na MESMA casa. A única
 *   variável entre as duas execuções é `unseweredChildMortalityMultiplier` (1 x 4), então a
 *   diferença de mortes só pode vir do esgoto. Depois de 76 dias (~1 ano), o recém-nascido já
 *   passou pelo risco do primeiro ano de vida (a tábua do `yearly` conta o bebê com 1 ano de vida).
 * - Semente fixa única, sem relógio e sem `Math.random`; cada cidade roda uma vez só (`Map` memoizado).
 */
import { readFileSync } from "node:fs";
import type { Command } from "@city/contract";
import type { Game, Simulation } from "@city/sim";
import { describe, expect, it } from "vitest";
import { joinHousehold, newPerson } from "../../packages/sim/src/people/actions";
import { EV } from "../../packages/sim/src/people/events";
import { createTestGame } from "../helpers";

/** Semente fixa do arquivo (nada de relógio nem `Math.random`). */
const SEED = "esgoto-crianca";
/** Regional de água e luz (mesma ordem do teste antigo de água/luz, #108). */
const REGIONAL = 60;
/** Regional de esgoto apertado: a cidade cresce, mas o esgoto não acompanha. */
const REGIONAL_ESGOTO = 15;
/** Recém-nascidos e adultos de 25 anos em cada grupo da coorte (peso da comparação). */
const COORTE = 3000;
/** Dias de cidade antes da coorte (as casas se enchem pelo caminho real do jogo). */
const DIAS_CIDADE = 60;
/** Dias depois da coorte: ~1 ano, o bastante para o bebê passar pelo risco do primeiro ano. */
const DIAS_COHORTE = 76;
/** Multiplicador colado para provar a regra sem depender de calibração (o da fonte é 1,39). */
const MULT_ALTO = 4;

/** `health.unseweredChildMortalityMultiplier` ainda não existe na main: acesso tolerante. */
interface HealthComEsgoto {
  unseweredChildMortalityMultiplier?: number;
}

/** Onde a ETE cabe: canto 3x3 encostado na água e a malha de ruas em volta. */
interface Malha {
  /** Canto da ETE (3x3). */
  x: number;
  y: number;
  /** Rua vertical da malha. */
  X: number;
  /** Rua de serviço (poço e subestação), na outra ponta. */
  Y: number;
}

/** Casas residenciais ativas, divididas pelo que o `UtilitiesSystem` marcou em `hasSewage`. */
type Casas = { comEsgoto: number[]; semEsgoto: number[] };

/** Os dois grupos da coorte. */
type Coorte = { bebes: number[]; adultos: number[] };

/** Cidades já rodadas (não roda a mesma cidade duas vezes). */
const cidades = new Map<string, Game>();

/** Lê um arquivo do repositório como texto. */
function readRepoText(caminho: string): string {
  return readFileSync(caminho, "utf8");
}

/**
 * Ponto para a malha da ETE: canto 3x3 seco e livre, com água perto (a ETE tem `nearWater: 3`), rua
 * vertical e rua de serviço inteiras sem água (o jogo não tem ponte) e a via até a borda oeste
 * (sem essa via a malha não tem saída e `growth` não constrói nada). A varredura é na ordem
 * dos índices do mapa, então o ponto é determinístico para a semente. Igual ao teste #108.
 */
function achaPontoDaEte(game: Game): Malha | null {
  const w = game.sim.world;
  const seca = (x: number, y: number): boolean => w.inBounds(x, y) && !w.water[w.idx(x, y)];
  const agua = (x: number, y: number): boolean => w.inBounds(x, y) && !!w.water[w.idx(x, y)];
  for (let i = 0; i < w.size; i++) {
    const x = w.xOf(i);
    const y = w.yOf(i);
    const X = x - 4;
    const Y = y - 14;
    if (X < 8 || X + 8 > w.width || Y - 2 < 0 || Y + 16 >= w.height) continue;
    let ok = true;
    // Canto 3x3 da ETE seco (o efluente pode ir para o rio, então a ETE em si não encosta na água).
    for (let ty = y + 1; ok && ty <= y + 3; ty++)
      for (let tx = x - 3; ok && tx <= x - 1; tx++) ok = seca(tx, ty);
    if (!ok) continue;
    let perto = false;
    for (let ty = y - 2; !perto && ty <= y + 6; ty++)
      for (let tx = x - 6; !perto && tx <= x + 2; tx++) perto = agua(tx, ty);
    if (!perto) continue;
    // Rua vertical e rua de serviço sem água, e a via até a borda oeste (tem que existir).
    for (let ty = Y; ok && ty <= y + 14; ty++) ok = seca(X, ty);
    for (let tx = 0; ok && tx <= X + 6; tx++) ok = seca(tx, Y);
    for (let ty = Y + 1; ok && ty <= Y + 2; ty++) ok = ok && seca(X + 1, ty) && seca(X + 3, ty);
    if (ok) return { x, y, X, Y };
  }
  return null;
}

/** A malha da ETE: rua vertical, zonas dos dois lados, rua de serviço e a via até a borda oeste. */
function montaMalhaDaEte(sim: Simulation, m: Malha): void {
  const comandos: Command[] = [
    { type: "buildRoad", kind: "street", x0: m.X, y0: m.Y, x1: m.X, y1: m.y + 14 },
    { type: "zone", zone: "residential_low", x0: m.X + 1, y0: m.Y + 1, x1: m.X + 2, y1: m.y + 13 },
    { type: "zone", zone: "commercial", x0: m.X - 2, y0: m.Y + 1, x1: m.X - 1, y1: m.y + 13 },
    { type: "buildRoad", kind: "street", x0: m.X, y0: m.Y, x1: m.X + 6, y1: m.Y },
    { type: "buildRoad", kind: "street", x0: 0, y0: m.Y, x1: m.X, y1: m.Y },
    { type: "placeService", service: "poco", x: m.X + 1, y: m.Y + 1 },
    { type: "placeService", service: "subestacao", x: m.X + 3, y: m.Y + 1 },
  ];
  for (const c of comandos) sim.enqueue(c);
}

/** Casas residenciais ativas, divididas pelo `hasSewage` que o `UtilitiesSystem` calculou. */
function casas(game: Game): Casas {
  const bs = game.sim.buildings;
  const comEsgoto: number[] = [];
  const semEsgoto: number[] = [];
  for (let b = 0; b < bs.count; b++) {
    if (!bs.isActive(b)) continue;
    if (bs.homesCapacity(b) <= 0) continue;
    if (bs.hasSewage[b] === 1) comEsgoto.push(b);
    else semEsgoto.push(b);
  }
  return { comEsgoto, semEsgoto };
}

/**
 * Mortes (EV.died) de uma lista de pessoas. Conta o evento `EV.died` e não "não está mais vivo":
 * quem deixa a cidade (imigração invertida) também sai da lista de vivos, e essa pessoa não morreu.
 */
function mortesDe(game: Game, pessoas: readonly number[]): number {
  const ev = game.city.events;
  const mortos = new Set<number>();
  for (let e = 0; e < ev.count; e++) if (ev.type[e] === EV.died) mortos.add(ev.person[e]!);
  let mortes = 0;
  for (const p of pessoas) if (mortos.has(p)) mortes++;
  return mortes;
}

/**
 * Taxa de morte de um grupo da coorte (mortes por pessoa da coorte). Serve para comparar a mesma
 * faixa etária entre as duas execuções sem depender da contagem bruta (que muda junto com a cidade).
 */
function taxa(game: Game, pessoas: readonly number[]): number {
  return mortesDe(game, pessoas) / pessoas.length;
}

/** `mortalidade infantil` do placar (por mil): o número que o jogador vê. */
function mortalidadeInfantil(game: Game): number | null {
  const w = game.demo.window();
  return w.births > 0 ? (w.infantDeaths / w.births) * 1000 : null;
}

/**
 * Cidade do critério: mesma semente, dinheiro de sandbox e `regionalSewage` apertado. A ETE só entra
 * quando pedida (atende a malha dela, então depois dela ninguém fica sem esgoto). Com
 * `utilities: false` o saneamento inteiro desliga e ninguém fica sem água nem sem esgoto.
 */
function cidade(chave: string, opcoes: { multiplier?: number; utilities?: boolean; ete?: boolean }): Game {
  const pronto = cidades.get(chave);
  if (pronto) return pronto;
  const utilities =
    opcoes.utilities === false
      ? { enabled: false, regionalWater: REGIONAL, regionalPower: REGIONAL, regionalSewage: REGIONAL_ESGOTO }
      : { regionalWater: REGIONAL, regionalPower: REGIONAL, regionalSewage: REGIONAL_ESGOTO };
  const game = createTestGame({
    seed: SEED,
    overrides: {
      economy: { mode: "sandbox" },
      utilities,
      // Sem imigração, sem trabalho, sem casamento e sem saída de casa: depois da coorte injetada a
      // única coisa que muda na cidade é o sorteio de morte no aniversário (o RNG não se dispersa).
      population: { immigration: { enabled: false } },
      lifecycle: {
        marriage: { hazardByAge: { "0": 0 } },
        labor: { participation: 0 },
        leaveParentsHome: { annualChance: 0 },
      },
      health: { unseweredChildMortalityMultiplier: opcoes.multiplier ?? 1 },
    },
  });
  const malha = achaPontoDaEte(game);
  expect(malha, "a semente tem que ter um ponto seco com água perto e rua até a borda").not.toBeNull();
  if (!malha) throw new Error("ponto da ETE não encontrado na semente do teste");
  montaMalhaDaEte(game.sim, malha);
  if (opcoes.ete) game.sim.enqueue({ type: "placeService", service: "ete", x: malha.x - 3, y: malha.y + 1 });
  game.sim.step(1);
  for (const r of game.sim.drainResults()) {
    expect(r.ok, `o comando ${r.command.type} foi recusado: ${r.reason}`).toBe(true);
  }
  game.sim.step(DIAS_CIDADE * game.sim.clock.ticksPerDay);
  cidades.set(chave, game);
  return game;
}

/**
 * Injeta a coorte na casa `casaId`: uma mãe por familia (como em `tests/slow/demography.test.ts`)
 * e, alternadamente, um recém-nascido e um adulto de 25 anos. Os dois grupos ficam na MESMA casa, que
 * tem água e luz nos dois casos: a única diferença entre eles é a idade.
 */
function injetaCoorte(game: Game, casaId: number): Coorte {
  const { city, sim } = game;
  const tpd = sim.clock.ticksPerDay;
  const bebes: number[] = [];
  const adultos: number[] = [];
  let familia = -1;
  for (let i = 0; i < 2 * COORTE; i++) {
    if (i % 2 === 0) {
      familia = city.hh.create();
      city.hh.home[familia] = casaId;
    }
    const mae = newPerson(city, {
      sex: 0,
      birthTick: sim.clock.tick - 30 * tpd,
      first: 0,
      surnameA: 0,
      surnameB: 0,
    });
    city.pop.laborWilling[mae] = 2;
    city.log(EV.arrived, mae);
    joinHousehold(city, mae, familia);
    const filho = newPerson(city, {
      sex: i % 4 < 2 ? 0 : 1,
      birthTick: i % 2 === 0 ? sim.clock.tick : sim.clock.tick - 25 * tpd,
      first: 0,
      surnameA: 0,
      surnameB: 0,
    });
    if (i % 2 === 0) city.log(EV.born, filho, mae, -1);
    else city.log(EV.arrived, filho);
    joinHousehold(city, filho, familia);
    if (i % 2 === 0) bebes.push(filho);
    else adultos.push(filho);
  }
  return { bebes, adultos };
}

/**
 * Injeta a coorte na casa, roda `DIAS_COHORTE` e devolve as mortes de cada grupo, com a lista de
 * pessoas de cada grupo (para a taxa).
 */
function rodacoorte(game: Game, casaId: number): { bebes: number; adultos: number; grupoAdultos: number[] } {
  const coorte = injetaCoorte(game, casaId);
  game.sim.step(DIAS_COHORTE * game.sim.clock.ticksPerDay);
  return {
    bebes: mortesDe(game, coorte.bebes),
    adultos: mortesDe(game, coorte.adultos),
    grupoAdultos: coorte.adultos,
  };
}

/** As duas cidades do critério, na mesma semente, mudando Só o multiplicador. */
function parDeCidades(sufixo: string, opcoes: { utilities?: boolean; ete?: boolean } = {}) {
  const semEfeito = cidade(`${sufixo}-mult1`, { ...opcoes, multiplier: 1 });
  const comEfeito = cidade(`${sufixo}-mult${MULT_ALTO}`, { ...opcoes, multiplier: MULT_ALTO });
  for (const [nome, game] of [
    ["multiplicador 1", semEfeito],
    [`multiplicador ${MULT_ALTO}`, comEfeito],
  ] as const) {
    expect(
      (game.sim.config.health as HealthComEsgoto).unseweredChildMortalityMultiplier,
      `a cidade com ${nome} não recebeu o override de health.unseweredChildMortalityMultiplier: o ` +
        "motor ainda está sem o número de esgoto (config/health.yaml e config/schema.ts)",
    ).toBe(nome === "multiplicador 1" ? 1 : MULT_ALTO);
  }
  return { semEfeito, comEfeito };
}

describe("issue #223: sem esgoto aumenta o risco de morte das crianças", () => {
  it("o número do esgoto está na config de saúde com a fonte do RR 0,72 e o limite etário", () => {
    const yaml = readRepoText("config/health.yaml");
    const achado = /unseweredChildMortalityMultiplier:\s*([\d.]+)/.exec(yaml);
    expect(
      achado,
      "config/health.yaml deveria ter `unseweredChildMortalityMultiplier` (o multiplicador de risco de " +
        "quem tem menos de 5 anos e mora sem coleta de esgoto)",
    ).not.toBeNull();
    if (!achado) return;
    expect(
      Number(achado[1]),
      "o multiplicador saiu do valor da fonte (Wolf et al., 2014, doi 10.1111/tmi.12329: sanitário " +
        "melhorado reduz a morbidade por diarréia em 28%, RR 0,72, então 1 / 0,72 = 1,39)",
    ).toBeCloseTo(1.39, 2);
    expect(
      yaml,
      "o comentário do número deveria citar a fonte do RR 0,72 (Wolf et al., 2014, doi 10.1111/tmi.12329)",
    ).toMatch(/0,72|tmi\.12329/);
    expect(
      yaml,
      "o comentário do número deveria dizer que o efeito é só para menor de 5 anos (a fonte é de " +
        "diarréia infantil e o jogo não modela causa de morte: acima de 5 anos o número não tem fonte)",
    ).toMatch(/5 anos|menor de 5/);
    // A chave tem que passar pelo schema: valor inválido tem que dar erro de config, não sumir.
    expect(() =>
      createTestGame({ seed: SEED, overrides: { health: { unseweredChildMortalityMultiplier: -1 } } }),
    ).toThrow();
  });

  it("mesma cidade e semente: o multiplicador colado em 4 mata mais crianças e sobe a mortalidade infantil", {
    timeout: 600000,
  }, () => {
    const { semEfeito, comEfeito } = parDeCidades("sem-ete");
    const listaSem = casas(semEfeito);
    const listaCom = casas(comEfeito);
    expect(
      listaSem.semEsgoto.length,
      `a cidade sem ETE tem ${listaSem.semEsgoto.length} casas sem esgoto: com o regional de esgoto ` +
        "apertado a cidade cresce e o esgoto não acompanha, e sem uma casa sem esgoto o teste não prova nada",
    ).toBeGreaterThan(0);
    const casaSem = listaSem.semEsgoto[0];
    const casaCom = listaCom.semEsgoto[0];
    expect(casaCom, "sanidade: a cidade do multiplicador alto também tem casa sem esgoto").toBeDefined();
    if (casaSem === undefined || casaCom === undefined) return;
    const bs = semEfeito.sim.buildings;
    expect(bs.hasWater[casaSem]!, "sanidade: a casa sem esgoto tem água (falta só de esgoto)").toBe(1);
    expect(bs.hasPower[casaSem]!, "sanidade: a casa sem esgoto tem luz").toBe(1);

    const sem = rodacoorte(semEfeito, casaSem);
    const com = rodacoorte(comEfeito, casaCom);
    expect(
      sem.bebes,
      `o grupo de recém-nascidos com o multiplicador 1 (${COORTE} pessoas na casa sem esgoto) não teve ` +
        `nenhuma morte em ${DIAS_COHORTE} dias: sem mortes o grupo de comparação não prova nada`,
    ).toBeGreaterThan(0);
    expect(
      sem.adultos,
      `o grupo de adultos de 25 anos (${COORTE} pessoas na MESMA casa sem esgoto) não teve nenhuma morte ` +
        `em ${DIAS_COHORTE} dias: o teste precisa das duas taxas para mostrar que o efeito é só das crianças`,
    ).toBeGreaterThan(0);
    expect(
      com.bebes,
      `morreram ${com.bebes} recém-nascidos com o multiplicador ${MULT_ALTO} e ${sem.bebes} com o ` +
        "multiplicador 1 (1 = sem efeito), todos na mesma casa sem esgoto: o esgoto está aumentando a " +
        "mortalidade das crianças, que era o que faltava no motor",
    ).toBeGreaterThan(sem.bebes);
    const imSem = mortalidadeInfantil(semEfeito);
    const imCom = mortalidadeInfantil(comEfeito);
    expect(imSem, "a mortalidade infantil tem denominador na cidade do multiplicador 1").not.toBeNull();
    expect(imCom, "a mortalidade infantil tem denominador na cidade do multiplicador alto").not.toBeNull();
    if (imSem === null || imCom === null) return;
    expect(
      imCom,
      `a mortalidade infantil do placar subiu de ${imSem.toFixed(1)} para ${imCom.toFixed(1)} por mil: ` +
        "quem joga precisa ver o efeito do esgoto em algum lugar do placar",
    ).toBeGreaterThan(imSem);
  });

  it("o efeito é só das crianças: os adultos da mesma casa morrem igual", { timeout: 600000 }, () => {
    const { semEfeito, comEfeito } = parDeCidades("sem-ete-idade");
    const casaSem = casas(semEfeito).semEsgoto[0];
    const casaCom = casas(comEfeito).semEsgoto[0];
    expect(casaSem, "sanidade: há casa sem esgoto na cidade do multiplicador 1").toBeDefined();
    expect(casaCom, "sanidade: há casa sem esgoto na cidade do multiplicador alto").toBeDefined();
    if (casaSem === undefined || casaCom === undefined) return;
    const sem = rodacoorte(semEfeito, casaSem);
    const com = rodacoorte(comEfeito, casaCom);
    expect(sem.adultos, "sanidade: o grupo de adultos do multiplicador 1 teve alguma morte").toBeGreaterThan(
      0,
    );
    // Taxas de morte, não contagens: o contador bruto muda junto com o tamanho da cidade, e uma
    // diferença de 1 em 3.000 é só o sorteio (o multiplicador 4 nos adultos daria ~3x as mortes,
    // ou seja ~+100%, muito acima da tolerância de 5% aqui).
    const taxaSem = taxa(semEfeito, sem.grupoAdultos);
    const taxaCom = taxa(comEfeito, com.grupoAdultos);
    expect(
      taxaCom,
      `adultos de 25 anos na MESMA casa sem esgoto morrem a ${(taxaCom * 100).toFixed(2)}% com o ` +
        `multiplicador ${MULT_ALTO} e a ${(taxaSem * 100).toFixed(2)}% com o multiplicador 1. A fonte ` +
        "(Wolf et al., 2014) é de diarréia infantil: o efeito tem que ser SÓ para menor de 5 anos, senão é " +
        "um número sem fonte (e o multiplicador sobre os adultos daria +100% de mortes, não este valor)",
    ).toBeLessThan(taxaSem * 1.05);
    expect(
      taxaCom,
      "mesma faixa etária, mesmas casas: a taxa dos adultos tem que ser praticamente igual",
    ).toBeGreaterThan(taxaSem * 0.95);
  });

  it("com a ETE atendendo a malha o multiplicador não muda nada", { timeout: 600000 }, () => {
    const { semEfeito, comEfeito } = parDeCidades("com-ete", { ete: true });
    for (const [nome, game] of [
      ["multiplicador 1", semEfeito],
      [`multiplicador ${MULT_ALTO}`, comEfeito],
    ] as const) {
      const lista = casas(game);
      expect(
        lista.semEsgoto.length,
        `sanidade: com a ETE na malha (${nome}) ninguém fica sem esgoto, mas há ` +
          `${lista.semEsgoto.length} casas sem esgoto de ${lista.comEsgoto.length + lista.semEsgoto.length}`,
      ).toBe(0);
      expect(
        lista.comEsgoto.length,
        `sanidade: há casas residenciais ativas na cidade com ETE (${nome})`,
      ).toBeGreaterThan(0);
    }
    const casaSem = casas(semEfeito).comEsgoto[0];
    const casaCom = casas(comEfeito).comEsgoto[0];
    expect(casaSem, "sanidade: há casa com esgoto na cidade com ETE e multiplicador 1").toBeDefined();
    expect(casaCom, "sanidade: há casa com esgoto na cidade com ETE e multiplicador alto").toBeDefined();
    if (casaSem === undefined || casaCom === undefined) return;
    const sem = rodacoorte(semEfeito, casaSem);
    const com = rodacoorte(comEfeito, casaCom);
    expect(
      sem.bebes,
      `sanidade: os recém-nascidos na casa COM esgoto (${COORTE} pessoas) não tiveram nenhuma morte: ` +
        "sem esse grupo a comparação não prova nada",
    ).toBeGreaterThan(0);
    expect(
      com.bebes,
      `com a ETE atendendo a malha (todo mundo com esgoto), os recém-nascidos morrem ${com.bebes} com o ` +
        `multiplicador ${MULT_ALTO} e ${sem.bebes} com o multiplicador 1: quem tem esgoto não paga o ` +
        "multiplicador, então os números tãm de ser iguais",
    ).toBe(sem.bebes);
  });

  it("com utilities.enabled: false ninguém está sem esgoto e o número não muda", { timeout: 600000 }, () => {
    const { semEfeito, comEfeito } = parDeCidades("desligado", { utilities: false });
    const bs = comEfeito.sim.buildings;
    let casa = -1;
    for (let b = 0; b < bs.count; b++)
      if (bs.isActive(b) && bs.homesCapacity(b) > 0) {
        casa = b;
        break;
      }
    expect(
      casa,
      "sanidade: há casa residencial ativa na cidade com saneamento desligado",
    ).toBeGreaterThanOrEqual(0);
    if (casa < 0) return;
    const sem = rodacoorte(semEfeito, casa);
    const com = rodacoorte(comEfeito, casa);
    expect(
      sem.bebes,
      "sanidade: o grupo de recém-nascidos com o multiplicador 1 não teve nenhuma morte",
    ).toBeGreaterThan(0);
    expect(
      com.bebes,
      `com utilities.enabled false os recém-nascidos morrem ${com.bebes} com o multiplicador ${MULT_ALTO} e ` +
        `${sem.bebes} com o multiplicador 1: com o saneamento desligado ninguém está sem esgoto, então ` +
        "o número não pode mudar",
    ).toBe(sem.bebes);
  });
});
