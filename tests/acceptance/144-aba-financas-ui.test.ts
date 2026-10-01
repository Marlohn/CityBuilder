// @vitest-environment jsdom
/**
 * Teste de aceitacao da issue #144 (papel QA).
 * A aba Finanças do painel lateral mostra receita e despesa por categoria,
 * se a cidade se paga, o historico do saldo e o custo de obra + manutencao.
 * Hoje a aba ainda nao existe: estes testes devem falhar por isso.
 */

import { loadConfigAndData } from "@city/cli";
import type { StatsView } from "@city/contract";
import { statsView } from "@city/sim";
import { App, type GameClient, money, Store, type ToolDef } from "@city/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Toolbar } from "../../packages/ui/src/components/Toolbar";
import { toolDefs } from "../../packages/web/src/tools";
import { createTestGame } from "../helpers";

// @city/cli lê config/data do disco via files.ts (import.meta.url), o que não
// funciona no jsdom. O mock abaixo lê os mesmos arquivos com a mesma regra
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

interface FinanceYearEntry {
  year: number;
  revenue: number;
  expenses: number;
  netOperating: number;
  investment: number;
  moneyEnd: number;
}

interface FinanceData {
  revenueByCategory: Record<string, number>;
  expensesByCategory: Record<string, number>;
  netOperating: number;
  investment: number;
  yearlyHistory: FinanceYearEntry[];
}

type StatsWithFinance = StatsView & { finance: FinanceData };

function financeDeExemplo(): FinanceData {
  // Categorias reais do cofre da prefeitura (packages/sim/src/systems/economy.ts
  // e obras em packages/sim/src/systems/construction.ts): 1 receita + 6 despesas = 7 linhas.
  return {
    revenueByCategory: {
      impostos_e_repasses: 1500000,
    },
    expensesByCategory: {
      educacao: 900000,
      saude: 700000,
      agua_e_luz: 300000,
      manutencao_vias: 250000,
      obras_vias: 400000,
      obras_servicos: 200000,
    },
    // Custeio = educacao + saude + agua_e_luz + manutencao_vias (todo ano).
    netOperating: 1500000 - (900000 + 700000 + 300000 + 250000),
    // Investimento = obras_vias + obras_servicos (uma vez).
    investment: 400000 + 200000,
    yearlyHistory: [
      {
        year: 1,
        revenue: 1200000,
        expenses: 1000000,
        netOperating: 100000,
        investment: 300000,
        moneyEnd: 1000000,
      },
      {
        year: 2,
        revenue: 1300000,
        expenses: 1050000,
        netOperating: 150000,
        investment: 350000,
        moneyEnd: 1500000,
      },
      {
        year: 3,
        revenue: 1400000,
        expenses: 1100000,
        netOperating: 200000,
        investment: 400000,
        moneyEnd: 2100000,
      },
      {
        year: 4,
        revenue: 1500000,
        expenses: 1150000,
        netOperating: 250000,
        investment: 450000,
        moneyEnd: 2800000,
      },
      {
        year: 5,
        revenue: 1600000,
        expenses: 1200000,
        netOperating: 300000,
        investment: 500000,
        moneyEnd: 3500000,
      },
    ],
  };
}

function labelFor(id: string): string {
  return id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_/|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const { config, data } = loadConfigAndData();
const tools = toolDefs(config, data.buildings);

const game = createTestGame({ seed: "financas-aba", scenario: "bairro-basico", days: 6 });
const base = statsView(game);
const raw = base;
const exemplo = financeDeExemplo();
const stats: StatsWithFinance = (raw as { finance?: unknown }).finance
  ? (raw as StatsWithFinance)
  : { ...(raw as StatsView), finance: exemplo };

const statsNegativo: StatsWithFinance = {
  ...stats,
  finance: { ...exemplo, netOperating: -5000 },
};

const fakeClient: GameClient = {
  command: () => {},
  setSpeed: () => {},
  person: async () => null,
  people: async () => ({ total: 0, items: [] }),
  save: async () => "{}",
  load: () => {},
  bugReport: async () => "{}",
};

function makeStore(statsValue: StatsView): Store {
  const store = new Store();
  store.set({ stats: statsValue, panelOpen: true });
  return store;
}

async function renderApp(statsValue: StatsView): Promise<{ host: HTMLDivElement; root: Root; store: Store }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const store = makeStore(statsValue);
  let root!: Root;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(App, { store, client: fakeClient, tools, typeLabels: {} }));
  });
  return { host, root, store };
}

async function clickFinancas(host: HTMLDivElement): Promise<void> {
  const btn = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Finanças"));
  expect(btn, "esperava um botão de aba com o texto 'Finanças' no painel lateral").toBeDefined();
  await act(async () => {
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function cleanup(host: HTMLDivElement, root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  host.remove();
}

describe("issue #144: aba Finanças", () => {
  it("a barra de abas do painel tem a aba Finanças", async () => {
    const { host, root } = await renderApp(stats);
    try {
      const btn = [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.trim().includes("Finanças"),
      );
      expect(btn, "esperava um botão de aba com o texto 'Finanças' no painel lateral").toBeDefined();
    } finally {
      await cleanup(host, root);
    }
  });

  it("a aba Finanças mostra receita e despesa por categoria, separando custeio e investimento", async () => {
    const { host, root } = await renderApp(stats);
    try {
      await clickFinancas(host);
      const texto = host.textContent ?? "";
      const textoNorm = norm(texto);
      const entradas: Array<[string, number]> = [
        ...Object.entries(stats.finance.revenueByCategory),
        ...Object.entries(stats.finance.expensesByCategory),
      ];
      for (const [id, valor] of entradas) {
        const rotulo = labelFor(id);
        expect(
          textoNorm.includes(norm(rotulo)),
          `esperava a categoria '${rotulo}' (id '${id}') na aba Finanças`,
        ).toBe(true);
        expect(
          texto.includes(money(valor)),
          `esperava o valor ${money(valor)} da categoria '${rotulo}' na aba Finanças`,
        ).toBe(true);
      }
      expect(texto, "esperava um cabeçalho de custeio/manutenção na aba Finanças").toMatch(
        /custeio|manuten[çc][ãa]o/i,
      );
      expect(texto, "esperava um cabeçalho de obras/investimento na aba Finanças").toMatch(
        /obra|investimento/i,
      );
    } finally {
      await cleanup(host, root);
    }
  });

  it("a aba Finanças mostra 7 linhas de categoria: as receitas e as despesas do último ano", async () => {
    const { host, root } = await renderApp(stats);
    try {
      await clickFinancas(host);
      const ids = [
        ...new Set([
          ...Object.keys(stats.finance.revenueByCategory),
          ...Object.keys(stats.finance.expensesByCategory),
        ]),
      ];
      const linhas = [...host.querySelectorAll("tr")];
      for (const id of ids) {
        const rotulo = labelFor(id);
        const achou = linhas.some((tr) => norm(tr.textContent ?? "").includes(norm(rotulo)));
        expect(
          achou,
          `esperava uma linha <tr> com a categoria '${rotulo}' (id '${id}') na aba Finanças`,
        ).toBe(true);
      }
      const comCategoria = linhas.filter((tr) =>
        ids.some((id) => norm(tr.textContent ?? "").includes(norm(labelFor(id)))),
      );
      expect(
        comCategoria.length,
        `esperava ${ids.length} linhas de categoria na aba Finanças, mas achei ${comCategoria.length}`,
      ).toBe(ids.length);
    } finally {
      await cleanup(host, root);
    }
  });

  it("a linha 'a cidade se paga?' mostra o netOperating, em verde se >= 0 e vermelho se < 0", async () => {
    const pos = await renderApp(stats);
    const neg = await renderApp(statsNegativo);
    try {
      await clickFinancas(pos.host);
      await clickFinancas(neg.host);
      const rotuloLinha = /se paga|resultado|lucro|operacional/i;
      const valorPos = money(stats.finance.netOperating);
      const valorNeg = money(statsNegativo.finance.netOperating);
      const linhasPos = [...pos.host.querySelectorAll("tr")];
      const linhasNeg = [...neg.host.querySelectorAll("tr")];
      const linhaPos = linhasPos.find(
        (tr) => rotuloLinha.test(tr.textContent ?? "") && (tr.textContent ?? "").includes(valorPos),
      );
      const linhaNeg = linhasNeg.find(
        (tr) => rotuloLinha.test(tr.textContent ?? "") && (tr.textContent ?? "").includes(valorNeg),
      );
      expect(
        linhaPos,
        `esperava uma linha 'a cidade se paga?' com o valor ${valorPos} na aba Finanças`,
      ).toBeDefined();
      expect(
        linhaNeg,
        `esperava uma linha 'a cidade se paga?' com o valor ${valorNeg} na aba Finanças`,
      ).toBeDefined();
      expect(
        linhaPos?.innerHTML,
        `esperava a linha positiva (${valorPos}) marcada em verde na aba Finanças`,
      ).toMatch(/var\(--accent\)|#5fb36e|"(ok|good|positive|pos)"/i);
      expect(
        linhaNeg?.innerHTML,
        `esperava a linha negativa (${valorNeg}) marcada em vermelho na aba Finanças`,
      ).toMatch(/var\(--bad\)|#e05a4f|"(bad|negative|neg|bad-value)"/i);
      expect(
        pos.host.innerHTML !== neg.host.innerHTML,
        "esperava que o painel positivo e o negativo renderizassem HTML diferente",
      ).toBe(true);
    } finally {
      await cleanup(pos.host, pos.root);
      await cleanup(neg.host, neg.root);
    }
  });

  it("a aba Finanças mostra o histórico do saldo dos últimos anos", async () => {
    const { host, root } = await renderApp(stats);
    try {
      await clickFinancas(host);
      const texto = host.textContent ?? "";
      for (const entry of stats.finance.yearlyHistory) {
        expect(texto, `esperava o ano ${entry.year} do histórico na aba Finanças`).toContain(
          String(entry.year),
        );
        expect(texto, "esperava o saldo de cada ano do histórico (moneyEnd) na aba Finanças").toContain(
          money(entry.moneyEnd),
        );
      }
    } finally {
      await cleanup(host, root);
    }
  });

  it("o tooltip de uma ferramenta mostra o custo da obra e o custo anual de manutenção", async () => {
    const ferramentas = [
      {
        id: "service:ubs",
        label: "UBS",
        icon: "🏥",
        group: "Serviços",
        hint: "Serviço de saúde.",
        cost: 2012826,
        upkeepPerYear: 1200000,
      },
    ] as unknown as ToolDef[];
    const store = makeStore(stats);
    const ui = store.get();
    const host = document.createElement("div");
    document.body.appendChild(host);
    let root!: Root;
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(Toolbar, { ui, store, tools: ferramentas }));
    });
    try {
      const btn = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("UBS"));
      expect(btn, "esperava um botão de ferramenta com o texto 'UBS' na barra de ferramentas").toBeDefined();
      await act(async () => {
        btn?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        btn?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      });
      const partes: string[] = [];
      const tituloBotao = btn?.getAttribute("title") ?? "";
      if (tituloBotao) partes.push(tituloBotao);
      const ancestral = btn?.closest("[title]");
      if (ancestral) {
        partes.push(ancestral.getAttribute("title") ?? "");
        partes.push(ancestral.textContent ?? "");
      }
      for (const el of host.querySelectorAll("[title]")) partes.push(el.getAttribute("title") ?? "");
      partes.push(host.textContent ?? "");
      partes.push(host.innerHTML);
      const junto = partes.join("\n");
      const obraEsperada = money(2012826);
      const anoEsperado = money(1200000);
      expect(junto, `esperava o custo da obra ('Obra: ${obraEsperada}') no tooltip da UBS`).toContain(
        "Obra:",
      );
      expect(junto, `esperava o custo da obra ('Obra: ${obraEsperada}') no tooltip da UBS`).toContain(
        obraEsperada,
      );
      expect(
        junto,
        `esperava o custo anual de manutenção ('Ano: ${anoEsperado}') no tooltip da UBS`,
      ).toContain("Ano:");
      expect(
        junto,
        `esperava o custo anual de manutenção ('Ano: ${anoEsperado}') no tooltip da UBS`,
      ).toContain(anoEsperado);
    } finally {
      await cleanup(host, root);
    }
  });
});
