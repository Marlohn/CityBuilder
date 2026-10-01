/**
 * Histórico financeiro do motor: 5 anos fechados com breakdown por categoria.
 * Semente fixa, sem relógio e sem Math.random: a mesma cidade a cada rodada.
 */
import { describe, expect, it } from "vitest";
import { createTestGame } from "../../../tests/helpers";
import { statsView } from "../src/view/stats";

// Categorias que o EconomySystem lança (ver packages/sim/src/systems/economy.ts).
const REVENUE_CATEGORIES = ["impostos_e_repasses"];
// Custeio: repete todo ano (ver operatingCost em packages/sim/src/view/stats.ts).
const OPERATING_CATEGORIES = ["educacao", "saude", "agua_e_luz", "manutencao_vias"];
// Obra pontual lançada pelos comandos (ver packages/sim/src/commands/apply.ts).
const INVESTMENT_CATEGORIES = ["obras_vias", "obras_servicos"];
const KNOWN_EXPENSES = [...OPERATING_CATEGORIES, ...INVESTMENT_CATEGORIES];

function sum(record: Record<string, number>): number {
  let total = 0;
  for (const v of Object.values(record)) total += v;
  return total;
}

/** Custeio do ano: soma das categorias que se repetem todo ano. */
function operatingCost(expenses: Record<string, number>): number {
  let total = 0;
  for (const c of OPERATING_CATEGORIES) total += expenses[c] ?? 0;
  return total;
}

describe("histórico financeiro do motor (5 anos)", () => {
  const game = createTestGame({
    seed: "financas-5-anos",
    scenario: "bairro-basico",
    bot: true,
    days: 5,
    overrides: { economy: { mode: "sandbox" } },
  });

  it("guarda 5 anos fechados no yearlyHistory", () => {
    expect(game.city.yearlyHistory, "yearlyHistory deve ter 5 entradas após 5 anos").toHaveLength(5);
  });

  it("categorias de cada ano batem com as que o EconomySystem lança", () => {
    for (const entry of game.city.yearlyHistory) {
      for (const key of Object.keys(entry.revenueByCategory)) {
        expect(
          REVENUE_CATEGORIES.includes(key),
          `receita com categoria desconhecida ${key} no ano ${entry.year}`,
        ).toBe(true);
      }
      for (const key of Object.keys(entry.expensesByCategory)) {
        expect(
          KNOWN_EXPENSES.includes(key),
          `despesa com categoria desconhecida ${key} no ano ${entry.year}`,
        ).toBe(true);
      }
    }
    const last = game.city.yearlyHistory[game.city.yearlyHistory.length - 1]!;
    expect(
      last.revenueByCategory["impostos_e_repasses"] ?? 0,
      "último ano sem receita de impostos_e_repasses",
    ).toBeGreaterThan(0);
    expect(
      last.expensesByCategory["manutencao_vias"] ?? 0,
      "último ano sem despesa de manutencao_vias",
    ).toBeGreaterThan(0);
  });

  it("netOperating de cada ano é receita menos custeio", () => {
    const view = statsView(game);
    expect(view.finance.yearlyHistory, "visão deve expor os 5 anos").toHaveLength(5);
    for (let i = 0; i < game.city.yearlyHistory.length; i++) {
      const entry = game.city.yearlyHistory[i]!;
      const shown = view.finance.yearlyHistory[i]!;
      const revenue = sum(entry.revenueByCategory);
      const expenses = sum(entry.expensesByCategory);
      expect(entry.revenue, `receita total do ano ${entry.year} não bate com o breakdown`).toBeCloseTo(
        revenue,
        6,
      );
      expect(entry.expenses, `despesa total do ano ${entry.year} não bate com o breakdown`).toBeCloseTo(
        expenses,
        6,
      );
      const expected = revenue - operatingCost(entry.expensesByCategory);
      expect(shown.netOperating, `netOperating do ano ${entry.year} não é receita menos custeio`).toBeCloseTo(
        expected,
        6,
      );
    }
  });
});
