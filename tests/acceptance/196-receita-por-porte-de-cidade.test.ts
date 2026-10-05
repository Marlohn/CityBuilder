/**
 * Teste de aceitacao da issue #196 (papel QA). SO o teste, sem codigo do jogo.
 *
 * A receita da prefeitura hoje e um numero fixo: `revenuePerResidentPerYear: 5300`
 * em config/economy.yaml, lido direto em packages/sim/src/systems/economy.ts
 * (`aliveCount * valor / 24` a cada hora do ano). A issue pede trocar o numero fixo
 * por uma TABELA `revenuePerResidentByPopulation` ("populacao -> R$ por habitante
 * por ano"), lida com `makeTableLookup` dentro do EconomySystem. A receita continua
 * so na categoria `impostos_e_repasses`, e no sandbox ela e registrada sem mexer
 * no saldo (packages/sim/src/economy/treasury.ts).
 *
 * POR QUE a medicao e por hora: a receita e ganha hora a hora com a populacao de
 * cada hora, entao a receita esperada do ano e
 *   esperado = soma over cada hora do ano de (lookup(tabela, pop_daquela_hora) / 24).
 * Dividir a receita anual pela populacao FINAL do ano e fragil: medido na main com
 * a semente abaixo + bot + 20 dias, a media ponderada do ano e 816, a populacao
 * final e 938 e a receita de `impostos_e_repasses` e ~5,53 milhoes. Dividir por 938
 * da ~4.600 por habitante, e a tolerancia de 25% "por acaso" passa perto de 5.300
 * sem provar regra nenhuma. Aqui cada `it` amostra a populacao em todo tick de
 * hora do ultimo ano fechado e compara a receita registrada com a soma horaria.
 *
 * ONDE o ano fecha (lido no codigo, nao adivinhado): em packages/sim/src/game.ts
 * o onYearEnd roda quando `clock.tickOfDay === 0 && clock.tick > 0`; ele copia o
 * breakdown para `city.year.revenueByCategory` e faz `city.lastYear = city.year`
 * (packages/sim/src/city.ts guarda `lastYear` e `yearlyHistory`). Em
 * packages/sim/src/systems/economy.ts o ganho so acontece quando
 * `clock.tick % ticksPerHour === 0`, com
 * `ticksPerHour = Math.max(1, Math.round(60 / config.time.minutesPerTick))`.
 * A amostra e coletada exatamente nesses ticks, antes de cada `sim.step(1)`.
 *
 * Estes testes devem FALHAR na main de hoje, porque:
 * - it 1: config/economy.yaml nao tem a tabela (tem o numero fixo 5300) nem fonte.
 * - it 2: o schema aceita a chave antiga `revenuePerResidentPerYear` (ela existe).
 * - it 3: o override da tabela e ignorado (o schema descarta a chave nova), entao
 *   padrao e override dao a mesma receita por habitante; e a config padrao nao tem
 *   tabela para cair com o porte.
 * - it 4: com o numero fixo, a receita e exatamente media_do_ano x 5300, entao a
 *   distancia ate 5300 fica perto de zero e o teste que cobra distancia falha.
 * - it 5: o override da tabela e ignorado ate no sandbox, entao a receita vem
 *   ~media x 5300 em vez da soma horaria da tabela do override (so a parte do saldo passa
 *   na main, de proposito: ela trava o que nao pode regredir).
 *
 * Um `it` por criterio, semente fixa unica, sem Math.random, sem relogio, sem
 * medir ms. Cidades pesadas memoizadas (uma por config). Cada `it` com cidade
 * primeiro prova que a cidade tem gente (population > 0). Dinheiro nunca com
 * `toBe` exato: sempre `toBeCloseTo` ou tolerancia relativa explicita.
 */

import { readFileSync } from "node:fs";
import { createRun, loadConfigAndData } from "@city/cli";
import { type Game, makeTableLookup, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";

/** Semente fixa unica do arquivo (nada de relogio nem `Math.random`). */
const SEED = "receita-porte-196";
/** Dias de jogo (1 dia = 1 ano). Com bot a cidade passa de 800 habitantes. */
const DAYS = 20;
/** O numero fixo de hoje, que era para deixar de mandar na receita. */
const OLD_FLAT_VALUE = 5300;
/** So esta categoria pode ter receita (a troca nao cria categoria nova). */
const REVENUE_CATEGORY = "impostos_e_repasses";
/** O EconomySystem divide a receita anual por 24 (uma parcela por hora do ano). */
const HOURS_PER_YEAR = 24;

/** Tabela "chave numerica -> valor" vinda da config, ou null quando nao e isso. */
function asNumericTable(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return null;
  for (const [k, val] of entries) {
    if (!Number.isFinite(Number(k))) return null;
    if (typeof val !== "number" || !Number.isFinite(val)) return null;
  }
  return v as Record<string, number>;
}

/** Distancia relativa entre dois valores (tolerancia explicita para dinheiro). */
function relDiff(got: number, expected: number): number {
  return Math.abs(got - expected) / Math.abs(expected);
}

/** Media simples de uma lista (a populacao media do ano amostrado por hora). */
function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Receita esperada do ano: a cada hora o motor ganha
 * `aliveCount * lookup(aliveCount) / 24` (packages/sim/src/systems/economy.ts), ou seja
 * a receita por habitante da tabela vezes a populacao viva daquela hora. Somando as
 * 24 horas do ano, o esperado e `soma over h de (pop_h * lookup(pop_h)) / 24`.
 */
function expectedRevenue(lookup: (pop: number) => number, hourlyPop: number[]): number {
  let s = 0;
  for (const pop of hourlyPop) s += pop * lookup(pop);
  return s / HOURS_PER_YEAR;
}

interface ClosedYear {
  game: Game;
  /** Uma amostra de aliveCount por tick de hora do ultimo ano fechado. */
  hourlyPop: number[];
}

/**
 * Roda a cidade com o bot e volta com o jogo mais a populacao amostrada hora a
 * hora do ULTIMO ano fechado. Avanca dia a dia com `run.nextDay()` ate a vespera
 * do fim e percorre o ultimo ano tick a tick, amostrando `aliveCount` exatamente
 * nos ticks em que o EconomySystem ganha receita (`tick % ticksPerHour === 0`).
 * O `sim.step(1)` final processa o tick da meia-noite, quando o onYearEnd fecha
 * o ano e `city.lastYear` recebe o breakdown desse ano.
 */
const closedYears = new Map<string, ClosedYear>();
function closedYear(overrides?: Record<string, unknown>): ClosedYear {
  const key = JSON.stringify(overrides ?? {});
  const ready = closedYears.get(key);
  if (ready) return ready;
  const { config, data } = loadConfigAndData(overrides);
  const ticksPerHour = Math.max(1, Math.round(60 / config.time.minutesPerTick));
  const run = createRun({ config, data, seed: SEED, days: DAYS, bot: true });
  while (run.game.sim.clock.day < DAYS - 1) {
    if (!run.nextDay()) break;
  }
  const hourlyPop: number[] = [];
  while (run.game.sim.clock.day === DAYS - 1) {
    if (run.game.sim.clock.tick % ticksPerHour === 0) {
      hourlyPop.push(run.game.city.pop.aliveCount);
    }
    run.game.sim.step(1);
  }
  // O laco acima para no primeiro tick do dia seguinte, sem processa-lo: este
  // passo extra roda o onYearEnd da meia-noite, que fecha o ano amostrado.
  run.game.sim.step(1);
  const out = { game: run.game, hourlyPop };
  closedYears.set(key, out);
  return out;
}

/** Receita de `impostos_e_repasses` do ultimo ano fechado (via city.lastYear). */
function lastYearRevenue(game: Game): number {
  return game.city.lastYear.revenueByCategory[REVENUE_CATEGORY] ?? 0;
}

describe("issue #196: receita por habitante varia com o porte da cidade", () => {
  it("config/economy.yaml tem a tabela revenuePerResidentByPopulation com fonte", () => {
    const text = readFileSync(new URL("../../config/economy.yaml", import.meta.url), "utf-8");
    // Trecho legivel na mensagem de falha (a config inteira e grande demais).
    const linesTrecho = (t: string) =>
      t
        .split("\n")
        .filter((l) => /revenue/i.test(l))
        .join("\n");
    expect(
      text,
      `config/economy.yaml ainda nao tem a tabela revenuePerResidentByPopulation: ` +
        `a receita continua fixa em revenuePerResidentPerYear ` +
        `(ver config/economy.yaml e packages/sim/src/systems/economy.ts)`,
    ).toContain("revenuePerResidentByPopulation");
    // A chave antiga pode continuar citada num comentario, mas nao pode mais
    // existir como chave de config (`revenuePerResidentPerYear:` sem "#").
    expect(
      text,
      `config/economy.yaml ainda traz a chave de config revenuePerResidentPerYear: ` +
        `o numero fixo era para ter saido (a receita agora vem da tabela). ` +
        `Trecho:\n${linesTrecho(text)}`,
    ).not.toMatch(/^[ \t]*revenuePerResidentPerYear\s*:/m);
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.includes("revenuePerResidentByPopulation"));
    const near = lines.slice(Math.max(0, at - 8), at + 20).join("\n");
    // Fonte: a tabela vem com a fonte de cada ponto no comentario (link, IBGE, FPM,
    // Censo, Anuário, STN, Gazette, lei do FPM...). O bloco conta do comentario
    // acima da chave ate o fim da tabela.
    const comFonte =
      /https?:\/\/|\bibge\b|\bfpm\b|censo|anuar[iú]o|\bstn\b|gazeta|lei n|p\.?\s?\d{2,5}\/\d{4}/i;
    expect(
      near,
      `a tabela revenuePerResidentByPopulation em config/economy.yaml esta sem fonte: ` +
        `todo numero de regra precisa da fonte ao lado (link, IBGE, FPM, Censo, Anuário, ` +
        `STN, gazeta ou lei do FPM). Trecho encontrado:\n${near}`,
    ).toMatch(comFonte);
    // Cada ponto da tabela: linhas "populacao: valor" dentro do bloco da tabela.
    const entryLines = lines.slice(at, at + 20).filter((l) => /^\s*"?\d+"?\s*:/.test(l));
    expect(
      entryLines.length,
      `a tabela revenuePerResidentByPopulation em config/economy.yaml precisa de ` +
        `pelo menos 2 pontos "populacao: valor", mas achei ${entryLines.length} ` +
        `no trecho:\n${near}`,
    ).toBeGreaterThanOrEqual(2);
    for (const l of entryLines) {
      // Valor do ponto: o que vem depois dos dois-pontos, sem o comentario da linha.
      const value = Number(l.split(":")[1]?.split("#")[0]?.trim());
      expect(
        value,
        `ponto sem valor positivo na tabela revenuePerResidentByPopulation ` +
          `(linha: "${l.trim()}"): todo ponto precisa de R$ por habitante maior que 0`,
      ).toBeGreaterThan(0);
      // PENDENTE só pode aparecer no comentario, nunca no valor: a issue pede o
      // valor de jogo anotado ao lado de todo ponto pendente de fonte.
      expect(
        /:\s*\d/.test(l.split("#")[0] ?? ""),
        `ponto sem numero de jogo ao lado (linha: "${l.trim()}"): ` +
          `mesmo pendente de fonte, a tabela precisa de um valor jogavel`,
      ).toBe(true);
    }
    const { config } = loadConfigAndData();
    const raw = (config.economy as unknown as Record<string, unknown>).revenuePerResidentByPopulation;
    const table = asNumericTable(raw);
    expect(
      table,
      `a config padrao nao tem economy.revenuePerResidentByPopulation como tabela ` +
        `"populacao -> R$ por habitante por ano" (veio: ${String(raw)}): ` +
        `a receita continua vindo do numero fixo`,
    ).not.toBeNull();
    expect(
      Object.keys(table as Record<string, number>).length,
      `a tabela padrao revenuePerResidentByPopulation precisa de pelo menos 2 pontos: ` +
        `tabela de um ponto so nao varia por porte`,
    ).toBeGreaterThanOrEqual(2);
  });

  it("o schema rejeita a chave antiga revenuePerResidentPerYear", () => {
    const { config } = loadConfigAndData();
    const old = (config.economy as unknown as Record<string, unknown>).revenuePerResidentPerYear;
    expect(
      old,
      `a config padrao ainda traz economy.revenuePerResidentPerYear = ${String(old)}: ` +
        `a chave fixa era para ter saido (ver config/economy.yaml e o schema em ` +
        `packages/sim/src/config/schema.ts, bloco economy)`,
    ).toBeUndefined();
    let threw: string | null = null;
    try {
      loadConfigAndData({ economy: { revenuePerResidentPerYear: OLD_FLAT_VALUE } });
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    expect(
      threw,
      `o schema aceitou economy.revenuePerResidentPerYear = ${OLD_FLAT_VALUE} sem reclamar: ` +
        `a chave antiga era para ser rejeitada (parseGameConfig em ` +
        `packages/sim/src/config/load.ts deveria lancar ConfigError)`,
    ).not.toBeNull();
    expect(
      threw ?? "",
      `o erro da config invalida nao cita a chave antiga (veio: ${threw ?? "sem erro"}): ` +
        `quem usa a chave antiga precisa descobrir o que trocar`,
    ).toMatch(/revenuePerResidentPerYear/);
  });

  it("com override a cidade pequena recebe mais por habitante que com a tabela padrao", {
    timeout: 300000,
  }, () => {
    const { config } = loadConfigAndData();
    const table = asNumericTable(
      (config.economy as unknown as Record<string, unknown>).revenuePerResidentByPopulation,
    );
    expect(
      table,
      `a config padrao ainda nao tem economy.revenuePerResidentByPopulation: ` +
        `sem a tabela nao ha o que variar por porte`,
    ).not.toBeNull();
    const lookupStd = makeTableLookup(table as Record<string, number>);
    expect(
      lookupStd(800),
      `a tabela padrao nao cai com o porte (lookup(800) = R$ ${lookupStd(800)} contra ` +
        `lookup(20000) = R$ ${lookupStd(20000)}): cidade pequena era para receber mais ` +
        `por habitante que cidade grande`,
    ).toBeGreaterThan(lookupStd(20000));
    const base = closedYear(undefined);
    const over = closedYear({
      economy: { revenuePerResidentByPopulation: { "0": 20000, "50000": 5000 } },
    });
    const lookupOver = makeTableLookup({ "0": 20000, "50000": 5000 });
    for (const [c, label] of [
      [base, "tabela padrao"],
      [over, 'override {"0": 20000, "50000": 5000}'],
    ] as const) {
      expect(
        mean(c.hourlyPop),
        `a cidade do bot com ${label} esvaziou (populacao 0 o ano todo): ` +
          `sem gente o teste nao prova nada`,
      ).toBeGreaterThan(0);
      expect(
        c.hourlyPop.length,
        `nenhuma amostra horaria no ultimo ano com ${label}: sem amostras a soma ` + `horaria nao prova nada`,
      ).toBeGreaterThan(0);
    }
    // Sanidade: a receita registrada bate com a soma horaria da tabela de cada run.
    for (const [c, lookup, label] of [
      [base, lookupStd, "tabela padrao"],
      [over, lookupOver, "override"],
    ] as const) {
      const revenue = lastYearRevenue(c.game);
      const expected = expectedRevenue(lookup, c.hourlyPop);
      expect(
        revenue,
        `a cidade com ${label} nao registrou receita em ${REVENUE_CATEGORY} no ultimo ` +
          `ano fechado: sem receita a conta por habitante nao prova nada`,
      ).toBeGreaterThan(0);
      expect(
        relDiff(revenue, expected),
        `com ${label} era esperado R$ ${expected} (soma horaria de pop * lookup(pop) / 24 ` +
          `sobre ${c.hourlyPop.length} horas), mas veio R$ ${revenue}: o EconomySystem ` +
          `nao esta lendo a tabela com makeTableLookup`,
      ).toBeLessThan(0.02);
    }
    // A cidade tem ~1.000 habitantes, abaixo do segundo ponto do override: la o
    // valor esperado e ~20.000, bem acima do valor da tabela padrao em ~1.000.
    const perBase = lastYearRevenue(base.game) / mean(base.hourlyPop);
    const perOver = lastYearRevenue(over.game) / mean(over.hourlyPop);
    expect(
      perOver,
      `com o override {"0": 20000, "50000": 5000} era esperado bem mais que ` +
        `R$ ${perBase} por habitante da tabela padrao (veio R$ ${perOver}): o override ` +
        `da tabela nao mudou a receita (o EconomySystem ignora a tabela e usa o fixo)`,
    ).toBeGreaterThan(perBase * 1.3);
  });

  it("a receita nao e mais pop x 5300", { timeout: 300000 }, () => {
    const c = closedYear(undefined);
    expect(
      mean(c.hourlyPop),
      `a cidade do bot esvaziou (populacao 0 o ano todo): sem gente o teste nao prova nada`,
    ).toBeGreaterThan(0);
    const s = statsView(c.game);
    const keys = Object.keys(s.finance.revenueByCategory);
    expect(
      keys,
      `a receita saiu da categoria unica ${REVENUE_CATEGORY} (categorias com receita: ` +
        `${keys.length > 0 ? keys.join(", ") : "nenhuma"}): a troca nao pode criar categoria nova`,
    ).toEqual([REVENUE_CATEGORY]);
    const revenue = lastYearRevenue(c.game);
    expect(
      revenue,
      `a cidade com media de ${mean(c.hourlyPop)} habitantes no ano nao registrou ` +
        `receita em ${REVENUE_CATEGORY}: sem receita nao da para conferir a conta`,
    ).toBeGreaterThan(0);
    expect(
      relDiff(revenue, s.lastYearRevenue),
      `a soma do breakdown de receita (R$ ${revenue}) nao bate com lastYearRevenue ` +
        `(R$ ${s.lastYearRevenue}): a categoria ${REVENUE_CATEGORY} deixou de refletir o total`,
    ).toBeLessThan(1e-6);
    const avgPop = mean(c.hourlyPop);
    expect(
      relDiff(revenue, avgPop * OLD_FLAT_VALUE),
      `a receita continua R$ ${revenue}, colada em media x 5300 ` +
        `(R$ ${avgPop * OLD_FLAT_VALUE} para media de ${avgPop} habitantes): ` +
        `o numero fixo ainda manda`,
    ).toBeGreaterThan(0.05);
    const { config } = loadConfigAndData();
    const table = asNumericTable(
      (config.economy as unknown as Record<string, unknown>).revenuePerResidentByPopulation,
    );
    expect(
      table,
      `a config padrao ainda nao tem economy.revenuePerResidentByPopulation: ` +
        `sem a tabela nao da para conferir a soma horaria`,
    ).not.toBeNull();
    const expected = expectedRevenue(makeTableLookup(table as Record<string, number>), c.hourlyPop);
    expect(
      relDiff(revenue, expected),
      `era esperado R$ ${expected} (soma horaria de pop * lookup(pop) / 24 sobre ` +
        `${c.hourlyPop.length} horas com media de ${avgPop} habitantes), mas veio ` +
        `R$ ${revenue}: o EconomySystem nao segue a tabela por porte`,
    ).toBeLessThan(0.02);
  });

  it("no sandbox a receita e registrada e o saldo nao muda", { timeout: 300000 }, () => {
    const table = { "0": 20000, "50000": 5000 };
    const c = closedYear({ economy: { mode: "sandbox", revenuePerResidentByPopulation: table } });
    expect(
      mean(c.hourlyPop),
      `a cidade do bot em sandbox esvaziou (populacao 0 o ano todo): ` + `sem gente o teste nao prova nada`,
    ).toBeGreaterThan(0);
    const s = statsView(c.game);
    expect(
      Object.keys(s.finance.revenueByCategory),
      `no sandbox a receita saiu da categoria unica ${REVENUE_CATEGORY} ` +
        `(categorias com receita: ${Object.keys(s.finance.revenueByCategory).join(", ") || "nenhuma"})`,
    ).toEqual([REVENUE_CATEGORY]);
    const revenue = lastYearRevenue(c.game);
    expect(
      revenue,
      `no sandbox nenhuma receita foi registrada em ${REVENUE_CATEGORY} com media de ` +
        `${mean(c.hourlyPop)} habitantes no ano: o modo sandbox nao pode apagar a receita, ` +
        `so o efeito dela no saldo (ver Treasury.earn em packages/sim/src/economy/treasury.ts)`,
    ).toBeGreaterThan(0);
    const expected = expectedRevenue(makeTableLookup(table), c.hourlyPop);
    expect(
      relDiff(revenue, expected),
      `no sandbox com o override {"0": 20000, "50000": 5000} era esperado R$ ${expected} ` +
        `(soma horaria de pop * lookup(pop) / 24 sobre ${c.hourlyPop.length} horas), mas veio ` +
        `R$ ${revenue}: o EconomySystem ignora a tabela no sandbox`,
    ).toBeLessThan(0.02);
    const starting = c.game.sim.config.economy.startingMoney;
    expect(
      s.money,
      `no modo sandbox a receita nao pode mexer no saldo: esperado R$ ${starting} ` +
        `(startingMoney intacto), mas o saldo esta em R$ ${s.money}`,
    ).toBeCloseTo(starting, 5);
  });
});
