// @vitest-environment jsdom
/**
 * Teste de aceitacao da issue #175 (papel QA).
 *
 * O prefeito automatico (packages/bots/src/mayor.ts) hoje nao constroi
 * hospital nenhum: so poco, subestacao, escola e ubs. A regra pedida:
 * com populacao >= 8000 e gente fora do raio do hospital, o prefeito
 * constroi hospital, mas so quando a receita do ultimo ano paga o custeio
 * (lastYearRevenue - lastYearExpenses >= upkeepPerYear do hospital,
 * 7.045.200 em data/buildings.yaml), exceto no modo sandbox
 * (economy.mode = sandbox), onde nao espera. E quando espera, nao pode
 * marcar `saving` (senao a cidade trava).
 *
 * Estes testes devem FALHAR na main de hoje porque o prefeito nunca
 * constroi hospital: cada `it` que usa cidade comeca conferindo que a
 * populacao e maior que 0 (para a falha nunca ser por cidade vazia) e
 * cobra pelo menos 1 hospital (para a falha ser pelo que falta).
 *
 * Um `it` por criterio, semente fixa, sem Math.random, sem relogio.
 */

import { createRun, loadConfigAndData, loadScenario } from "@city/cli";
import { BSTATE, checkInvariants, currentCensus, type Game, statsView } from "@city/sim";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { CityPanel } from "../../packages/ui/src/components/CityPanel";
import { createTestGame } from "../helpers";

// @city/cli le config/data do disco via files.ts (import.meta.url), o que nao
// funciona no jsdom. O mock abaixo le os mesmos arquivos com a mesma regra
// (parseGameConfig + parseGameData) usando process.cwd(), sem mudar o que o
// teste importa: loadConfigAndData continua vindo de "@city/cli".
vi.mock("@city/cli", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const sim = await import("@city/sim");
  const bots = await import("@city/bots");
  const run = await import("../../packages/cli/src/run");
  const root = process.cwd();
  function readDir(dir: string, exts: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fs.readdirSync(path.join(root, dir))) {
      if (exts.some((e) => f.endsWith(e))) out[f] = fs.readFileSync(path.join(root, dir, f), "utf8");
    }
    return out;
  }
  function loadConfigAndData(overrides?: unknown) {
    const config = sim.parseGameConfig(readDir("config", [".yaml"]), overrides);
    const data = sim.parseGameData(readDir("data", [".yaml", ".json"]), config);
    return { config, data };
  }
  function loadScenario(name: string) {
    return bots.parseScenario(fs.readFileSync(path.join(root, "scenarios", `${name}.yaml`), "utf8"));
  }
  return { loadConfigAndData, loadScenario, runGame: run.runGame, createRun: run.createRun };
});

/** Semente fixa unica do arquivo (nada de relogio nem `Math.random`). */
const SEED = "hospital-prefeito-175";
/**
 * Dias de jogo. Com o cenario `estresse` + bot a cidade passa de 8.000
 * habitantes bem antes do dia 60 (medido: ~27 mil no dia 60 em sandbox,
 * ~24 mil em modo budget), entao 60 prova o gatilho de populacao
 * (8.000 em data/reference/cidade-real.yaml) com folga para a obra
 * (hospital leva 30 meses = 2,5 dias).
 */
const DAYS = 60;
/** Gatilho de populacao do hospital (data/reference/cidade-real.yaml). */
const HOSPITAL_MIN_POPULATION = 8000;

/** Hospitais ativos (state === active; demolidos nunca contam). */
function activeHospitals(game: Game): number[] {
  const b = game.sim.buildings;
  const out: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (b.typeOf(i).id !== "hospital") continue;
    if (b.state[i] === BSTATE.demolished) continue;
    if (b.state[i] === BSTATE.active) out.push(i);
  }
  return out;
}

/** Hospital existe: ativo ou ainda em obra (mas nao demolido). */
function hospitalsPresent(game: Game): number[] {
  const b = game.sim.buildings;
  const out: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (b.typeOf(i).id !== "hospital") continue;
    const state = b.state[i]!;
    if (state === BSTATE.demolished) continue;
    if (state <= BSTATE.active) out.push(i);
  }
  return out;
}

/** Cidade do criterio 1 (memoizada): bot no cenario estresse (sandbox). */
let sandboxGame: Game | null = null;
function botSandboxCity(): Game {
  if (!sandboxGame) {
    sandboxGame = createTestGame({ seed: SEED, scenario: "estresse", bot: true, days: DAYS });
  }
  return sandboxGame;
}

interface DaySnap {
  day: number;
  money: number;
  population: number;
  active: number;
  present: number;
}

/**
 * Cidade do criterio 2 (memoizada): mesmos semente/cenario/bot/dias do
 * criterio 1, mas com `overrides: { economy: { mode: "budget" } }` — igual
 * ao createTestGame com esses overrides, so que observada dia a dia via
 * createRun para achar o dia em que o hospital fica ativo.
 */
let budgetCache: { game: Game; snaps: DaySnap[] } | null = null;
function botBudgetRun(): { game: Game; snaps: DaySnap[] } {
  if (budgetCache) return budgetCache;
  const scenario = loadScenario("estresse");
  const { config, data } = loadConfigAndData({ ...scenario.overrides, economy: { mode: "budget" } });
  const run = createRun({ config, data, seed: SEED, days: DAYS, scenario, bot: true });
  const snaps: DaySnap[] = [];
  const record = () => {
    const game = run.game;
    snaps.push({
      day: game.sim.clock.day,
      money: game.sim.treasury.money,
      population: currentCensus(game).population,
      active: activeHospitals(game).length,
      present: hospitalsPresent(game).length,
    });
  };
  record();
  while (run.nextDay()) record();
  budgetCache = { game: run.game, snaps };
  return budgetCache;
}

/** Tabela do "Desejos nao atendidos": acha pelo h3, cai para a 2a tabela. */
function unmetTable(host: HTMLDivElement): HTMLTableElement | null {
  const h3 = [...host.querySelectorAll("h3")].find((h) => (h.textContent ?? "").includes("Desejos"));
  if (h3) {
    let el = h3.nextElementSibling;
    while (el && el.tagName !== "TABLE") el = el.nextElementSibling;
    if (el instanceof HTMLTableElement) return el;
  }
  const tables = host.querySelectorAll("table");
  return (tables[1] as HTMLTableElement | undefined) ?? null;
}

describe("issue #175: prefeito so constroi hospital com receita do ano", () => {
  it("a cidade do bot no cenario estresse com dinheiro de sandbox tem pelo menos 1 hospital ativo", {
    timeout: 300000,
  }, () => {
    const game = botSandboxCity();
    const census = currentCensus(game);
    expect(
      census.population,
      `a cidade do bot esvaziou (populacao 0): sem gente o teste nao prova nada`,
    ).toBeGreaterThan(0);
    expect(
      census.population,
      `o gatilho de populacao do hospital nao disparou: esperado mais de ${HOSPITAL_MIN_POPULATION} ` +
        `habitantes (data/reference/cidade-real.yaml), mas a cidade tem ${census.population}`,
    ).toBeGreaterThan(HOSPITAL_MIN_POPULATION);
    expect(
      census.withoutHospital,
      `era esperado gente fora do raio do hospital (withoutHospital maior que 0) com ` +
        `${census.population} habitantes e nenhum hospital, mas veio 0: sem demanda o teste nao prova nada`,
    ).toBeGreaterThan(0);
    const active = activeHospitals(game);
    expect(
      active.length,
      `com ${census.population} habitantes (gatilho: ${HOSPITAL_MIN_POPULATION}) e ` +
        `${census.withoutHospital} pessoas sem leito, era esperado pelo menos 1 hospital ativo no modo ` +
        `sandbox, mas nao ha nenhum: o prefeito nunca constroi hospital (packages/bots/src/mayor.ts)`,
    ).toBeGreaterThanOrEqual(1);
  });

  it("no modo normal a cidade nao fica no vermelho por causa do hospital", { timeout: 300000 }, () => {
    const { game, snaps } = botBudgetRun();
    const last = snaps[snaps.length - 1]!;
    expect(
      last.population,
      `a cidade do bot em modo budget esvaziou (populacao 0): sem gente o teste nao prova nada`,
    ).toBeGreaterThan(0);
    const everPresent = snaps.some((s) => s.present > 0);
    expect(
      everPresent,
      `o gatilho do hospital nao disparou na cidade em modo budget: nenhum hospital ativo nem em obra ` +
        `em ${DAYS} dias com ${last.population} habitantes: o prefeito nunca constroi hospital ` +
        `(packages/bots/src/mayor.ts)`,
    ).toBe(true);
    const activation = snaps.find((s) => s.active > 0);
    expect(
      activation,
      `o hospital em obra nunca ficou ativo na cidade em modo budget em ${DAYS} dias: ` +
        `sem o dia da ativacao nao da para conferir o saldo depois dele`,
    ).toBeDefined();
    if (!activation) return;
    const after = snaps.filter((s) => s.day >= activation.day);
    for (const s of after) {
      expect(
        s.money,
        `no dia ${s.day} (depois do hospital ficar ativo no dia ${activation.day}) o saldo ficou ` +
          `negativo (R$ ${s.money}): a cidade nao pode ficar no vermelho por causa do hospital`,
      ).toBeGreaterThanOrEqual(0);
    }
    expect(
      last.population,
      `a populacao encolheu depois do hospital ficar ativo: eram ${activation.population} pessoas no ` +
        `dia ${activation.day} e agora sao ${last.population}: a cidade tem que continuar crescendo`,
    ).toBeGreaterThanOrEqual(activation.population);
    expect(
      game.sim.treasury.money,
      `o saldo final ficou negativo por causa do hospital: R$ ${game.sim.treasury.money}`,
    ).toBeGreaterThanOrEqual(0);
  });

  it("o painel mostra o item novo e nenhum outro item some", { timeout: 300000 }, async () => {
    const game = botSandboxCity();
    const census = currentCensus(game);
    expect(
      census.population,
      `a cidade do painel esvaziou (populacao 0): sem gente o teste nao prova nada`,
    ).toBeGreaterThan(0);
    expect(
      activeHospitals(game).length,
      `a cidade do painel ainda nao tem hospital ativo: sem o hospital o teste do painel nao prova nada ` +
        `(o prefeito nunca constroi hospital em packages/bots/src/mayor.ts)`,
    ).toBeGreaterThanOrEqual(1);
    const stats = statsView(game);
    const host = document.createElement("div");
    document.body.appendChild(host);
    let root!: Root;
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(CityPanel, { s: stats }));
    });
    try {
      const table = unmetTable(host);
      expect(table, `esperava a tabela de "Desejos nao atendidos" no painel (CityPanel)`).not.toBeNull();
      const rows = [...table!.querySelectorAll("tr")];
      const hospitalRow = rows.find((tr) => (tr.textContent ?? "").toLowerCase().includes("hospital"));
      expect(
        hospitalRow,
        `esperava uma linha com rotulo contendo "hospital" no painel (CityPanel): ` +
          `o item novo sumiu ou nunca foi renderizado`,
      ).toBeDefined();
      const keys = Object.keys(stats.unmet);
      expect(
        rows.length,
        `esperava uma linha por chave do unmet (${keys.length} chaves: ${keys.join(", ")}), ` +
          `mas o painel mostra ${rows.length} linhas: algum outro item sumiu`,
      ).toBe(keys.length);
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    }
  });

  it("nada quebra junto", { timeout: 300000 }, () => {
    const game = botSandboxCity();
    expect(
      currentCensus(game).population,
      `a cidade do bot esvaziou (populacao 0): sem gente o teste nao prova nada`,
    ).toBeGreaterThan(0);
    expect(
      activeHospitals(game).length,
      `a cidade ainda nao tem hospital ativo: sem o hospital a checagem de invariantes nao prova ` +
        `que o hospital nao quebrou nada (o prefeito nunca constroi hospital em packages/bots/src/mayor.ts)`,
    ).toBeGreaterThanOrEqual(1);
    expect(
      checkInvariants(game.city),
      `regras que nunca podem quebrar foram violadas na cidade do bot`,
    ).toEqual([]);
  });
});
