// @vitest-environment jsdom
/**
 * Teste de aceitação da issue #225 (papel QA).
 * A TopBar mostra um terceiro UtilityStat chamado "Esgoto", entre "Água" e "Luz",
 * com uso e capacidade vindos de `s.utilities.sewage` do contrato.
 * Na main o Esgoto ainda não está desenhado na barra (só Água e Luz),
 * então estes 4 testes falham por falta do rótulo/número "Esgoto".
 */

import type { StatsView } from "@city/contract";
import { statsView } from "@city/sim";
import { type GameClient, int, Store } from "@city/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { TopBar } from "../../packages/ui/src/components/TopBar";
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

const game = createTestGame({ seed: "esgoto-barra-225", scenario: "bairro-basico", days: 20 });
const stats: StatsView = statsView(game);

// Saneamento desligado: mesma cidade, só com as capacidades zeradas (null),
// como a TopBar já faz para água e luz quando o serviço está sem limite.
const statsOff: StatsView = {
  ...stats,
  utilities: {
    ...stats.utilities,
    water: { ...stats.utilities.water, capacity: null },
    power: { ...stats.utilities.power, capacity: null },
    sewage: { ...stats.utilities.sewage, capacity: null },
  },
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
  store.set({ stats: statsValue });
  return store;
}

async function renderTopBar(statsValue: StatsView): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const store = makeStore(statsValue);
  const ui = store.get();
  let root!: Root;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(TopBar, { ui, store, client: fakeClient }));
  });
  return { host, root };
}

async function cleanup(host: HTMLDivElement, root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  host.remove();
}

function findStat(host: HTMLDivElement, label: string): Element | undefined {
  return [...host.querySelectorAll(".stat")].find(
    (el) => el.querySelector(".label")?.textContent?.trim() === label,
  );
}

describe("issue #225: esgoto na barra", () => {
  it("a barra principal mostra Esgoto com uso e capacidade", async () => {
    const { host, root } = await renderTopBar(stats);
    try {
      // Sanidade (passa hoje): a barra mostra Água e Luz com os números do contrato.
      for (const label of ["Água", "Luz"] as const) {
        const util = label === "Água" ? stats.utilities.water : stats.utilities.power;
        const expected =
          util.capacity === null ? `${int(util.used)} / —` : `${int(util.used)} / ${int(util.capacity)}`;
        const el = findStat(host, label);
        expect(el, `esperava o stat '${label}' na barra principal`).toBeDefined();
        expect(el?.querySelector(".value")?.textContent?.trim()).toBe(expected);
      }
      // O alvo da issue: o Esgoto usa os números REAIS do contrato, nada colado à mão.
      const sewage = stats.utilities.sewage;
      expect(
        sewage.capacity,
        "esperava capacidade de esgoto (número) no StatsView desta cidade para conferir a barra",
      ).not.toBeNull();
      const expected = `${int(sewage.used)} / ${int(sewage.capacity as number)}`;
      const el = findStat(host, "Esgoto");
      expect(el, "esperava um stat com o rótulo 'Esgoto' na barra principal").toBeDefined();
      expect(el?.querySelector(".value")?.textContent?.trim()).toBe(expected);
    } finally {
      await cleanup(host, root);
    }
  });

  it("o tooltip do Esgoto fala da ETE e da coleta", async () => {
    const { host, root } = await renderTopBar(stats);
    try {
      const el = findStat(host, "Esgoto");
      expect(el, "esperava um stat com o rótulo 'Esgoto' na barra principal").toBeDefined();
      const title = el?.getAttribute("title") ?? "";
      expect(title, "esperava um tooltip (title) não vazio no stat do Esgoto").not.toBe("");
      expect(title, "esperava o tooltip do Esgoto citar a ETE").toMatch(/ETE/i);
      expect(title, "esperava o tooltip do Esgoto falar de esgoto ou coleta").toMatch(/esgoto|coleta/i);
    } finally {
      await cleanup(host, root);
    }
  });

  it("com o saneamento desligado o Esgoto mostra — como água e luz", async () => {
    const { host, root } = await renderTopBar(statsOff);
    try {
      // A cópia desligou as três capacidades: a barra tem que respeitar o StatsView.
      expect(statsOff.utilities.sewage.capacity).toBeNull();
      expect(statsOff.utilities.water.capacity).toBeNull();
      expect(statsOff.utilities.power.capacity).toBeNull();
      for (const label of ["Água", "Luz"] as const) {
        const util = label === "Água" ? statsOff.utilities.water : statsOff.utilities.power;
        const el = findStat(host, label);
        expect(el, `esperava o stat '${label}' na barra principal`).toBeDefined();
        expect(el?.querySelector(".value")?.textContent?.trim()).toBe(`${int(util.used)} / —`);
      }
      const el = findStat(host, "Esgoto");
      expect(el, "esperava um stat com o rótulo 'Esgoto' na barra principal").toBeDefined();
      expect(el?.querySelector(".value")?.textContent?.trim()).toBe(
        `${int(statsOff.utilities.sewage.used)} / —`,
      );
    } finally {
      await cleanup(host, root);
    }
  });

  it("a barra mostra os três na ordem Água, Esgoto, Luz", async () => {
    const { host, root } = await renderTopBar(stats);
    try {
      const labels = [...host.querySelectorAll(".topbar .stat > .label")]
        .map((el) => el.textContent?.trim() ?? "")
        .filter((t) => t === "Água" || t === "Esgoto" || t === "Luz");
      expect(labels, "esperava os três utilitários na ordem Água, Esgoto, Luz").toEqual([
        "Água",
        "Esgoto",
        "Luz",
      ]);
    } finally {
      await cleanup(host, root);
    }
  });
});
