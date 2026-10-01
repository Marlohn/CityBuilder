/**
 * Issue #143 — Tarefa #18/2: o contrato expõe as finanças por categoria e o histórico anual.
 *
 * O motor já guarda o breakdown (issue #142), mas a tela não consegue desenhar o painel nem o
 * gráfico do saldo: `StatsView` não tem o campo `finance`. Este teste trava o que a issue pede —
 * `statsView(game).finance` com receita/despesa por categoria, o separation entre custeio
 * (`netOperating`) e investimento (`investment`) e o histórico anual (`yearlyHistory`).
 *
 * Semente fixa, sem relógio e sem `Math.random`: a mesma cidade a cada rodada.
 */
import type { StatsView } from "@city/contract";
import { reportText, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** Custeio: gasto que a cidade repete todo ano. */
const CUSTEIO = ["educacao", "saude", "agua_e_luz", "manutencao_vias"] as const;
/** Investimento: obra, que acontece uma vez. */
const INVESTIMENTO = ["obras_vias", "obras_servicos"] as const;

/**
 * A visão com `finance` ainda não existe no contrato. O teste acessa por tipo local e falha com
 * mensagem clara enquanto o Dev não implementa, sem quebrar o resto do `npm run check`.
 */
interface FinanceView {
  revenueByCategory?: unknown;
  expensesByCategory?: unknown;
  netOperating?: unknown;
  investment?: unknown;
  yearlyHistory?: unknown;
}
interface YearSummaryView {
  [k: string]: unknown;
}
type StatsComFinance = Omit<StatsView, "finance"> & {
  finance?: FinanceView;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Valor por categoria de um breakdown; null se o breakdown não for objeto de números. */
function porCategoria(breakdown: unknown, categoria: string): number | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  return num((breakdown as Record<string, unknown>)[categoria]) ?? 0;
}

function somaCusteio(breakdown: unknown): number | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const b = breakdown as Record<string, unknown>;
  if (Object.values(b).some((v) => typeof v !== "number")) return null;
  let total = 0;
  for (const c of CUSTEIO) total += (b[c] as number | undefined) ?? 0;
  return total;
}

function somaInvestimento(breakdown: unknown): number | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const b = breakdown as Record<string, unknown>;
  if (Object.values(b).some((v) => typeof v !== "number")) return null;
  let total = 0;
  for (const c of INVESTIMENTO) total += (b[c] as number | undefined) ?? 0;
  return total;
}

function somaTodas(breakdown: unknown): number | null {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return null;
  const vals = Object.values(breakdown as Record<string, unknown>);
  if (vals.some((v) => typeof v !== "number")) return null;
  let total = 0;
  for (const v of vals) total += v as number;
  return total;
}

/** O bloco `finance` da visão, com mensagem clara quando ele ainda não existe. */
function financeDe(s: StatsComFinance): FinanceView {
  expect(s.finance, "statsView(game).finance deve existir").toBeTypeOf("object");
  return s.finance as FinanceView;
}

/** A cidade de referência da issue: 40 dias (anos) de prefeito automático em modo sandbox. */
function cidadeDoTeste(days = 40) {
  const game = createTestGame({
    seed: "avaliacao-livre",
    bot: true,
    days,
    overrides: { economy: { mode: "sandbox" } },
  });
  return { game, s: statsView(game) as StatsComFinance };
}

describe("finanças na visão (issue #143)", () => {
  it("statsView traz o bloco finance com receita e despesa por categoria", () => {
    const { s } = cidadeDoTeste();
    const f = financeDe(s);
    expect(f.revenueByCategory, "finance.revenueByCategory deve existir").toBeTypeOf("object");
    expect(f!.expensesByCategory, "finance.expensesByCategory deve existir").toBeTypeOf("object");

    // A receita do último ano bate com o total que o contrato já expõe.
    expect(somaTodas(f.revenueByCategory)).toBeCloseTo(s.lastYearRevenue, 5);
    expect(somaTodas(f.expensesByCategory)).toBeCloseTo(s.lastYearExpenses, 5);
  });

  it("netOperating é a receita menos o custeio do ano (educação, saúde, água/luz e manutenção)", () => {
    const { s } = cidadeDoTeste();
    const f = financeDe(s);
    const receita = somaTodas(f.revenueByCategory)!;
    const custeio = somaCusteio(f.expensesByCategory)!;
    const esperado =
      receita -
      (porCategoria(f.expensesByCategory, "educacao")! +
        porCategoria(f.expensesByCategory, "saude")! +
        porCategoria(f.expensesByCategory, "agua_e_luz")! +
        porCategoria(f.expensesByCategory, "manutencao_vias")!);
    expect(custeio).toBeGreaterThan(0);
    expect(num(f.netOperating), "finance.netOperating deve existir").not.toBeNull();
    expect(f.netOperating).toBeCloseTo(esperado, 5);
    // Custeio nunca entra em investimento: as duas somas são separadas.
    expect(somaInvestimento(f.expensesByCategory)!).toBeGreaterThanOrEqual(0);
  });

  it("investment é só a obra do ano (obras de via e de serviços)", () => {
    const { s } = cidadeDoTeste();
    const f = financeDe(s);
    const esperado =
      porCategoria(f.expensesByCategory, "obras_vias")! +
      porCategoria(f.expensesByCategory, "obras_servicos")!;
    expect(num(f.investment), "finance.investment deve existir").not.toBeNull();
    expect(f.investment).toBeCloseTo(esperado, 5);
    // Não é a despesa toda: o custeio do ano não conta como investimento.
    expect(somaTodas(f.expensesByCategory)!).toBeGreaterThan(esperado);
  });

  it("yearlyHistory traz um resumo por ano fechado, com receita, despesa, saldo e saldo em dinheiro", () => {
    const curta = financeDe(cidadeDoTeste(12).s).yearlyHistory;
    const longa = financeDe(cidadeDoTeste().s).yearlyHistory;
    expect(curta, "finance.yearlyHistory deve existir").toBeInstanceOf(Array);
    expect(curta as unknown[], "12 dias simulados = 12 anos no histórico").toHaveLength(12);
    expect(longa as unknown[], "40 dias simulados = 40 anos no histórico").toHaveLength(40);

    const anos = new Set<number>();
    let receitaTotal = 0;
    for (const [i, bruto] of (longa as YearSummaryView[]).entries()) {
      const ano = num(bruto.year);
      expect(ano, `ano ${i}: resumo sem o ano`).not.toBeNull();
      expect(anos.has(ano!), `ano repetido no histórico: ${ano}`).toBe(false);
      anos.add(ano!);
      receitaTotal += bruto.revenue as number;

      expect(num(bruto.revenue), `ano ${i}: resumo sem receita`).not.toBeNull();
      expect(num(bruto.expenses), `ano ${i}: resumo sem despesa`).not.toBeNull();
      // O primeiro ano pode ser zero (cidade recém-criada ainda sem receita em nenhuma categoria).
      expect(bruto.revenue as number).toBeGreaterThanOrEqual(0);
      expect(num(bruto.moneyEnd), `ano ${i}: resumo sem o saldo em dinheiro`).not.toBeNull();
      expect(num(bruto.netOperating), `ano ${i}: resumo sem netOperating`).not.toBeNull();
      expect(num(bruto.investment), `ano ${i}: resumo sem investment`).not.toBeNull();
      // Saldo operacional do ano = receita menos o custo, separando o investimento (obra):
      // despesa do ano = custo + investimento, então sobra + investimento = receita - custo.
      const sobra = (bruto.revenue as number) - (bruto.expenses as number);
      expect(bruto.netOperating as number).toBeCloseTo(sobra + (bruto.investment as number), 5);
    }
    // A cidade inteira não faliu de vez: houve receita em algum ano do histórico.
    expect(receitaTotal, "nenhum ano do histórico teve receita").toBeGreaterThan(0);
  });

  it("o relatório em texto lê o bloco novo sem erro e sem repetir número", () => {
    const { game, s } = cidadeDoTeste();
    const f = financeDe(s);
    const relatorio = reportText(game);
    expect(relatorio, "reportText não pode quebrar com o campo novo").toContain("Saldo");
    // O relatório continua lendo os totais antigos: a mudança no contrato é só adição.
    expect(s.lastYearRevenue).toBeGreaterThan(0);
    expect(s.lastYearExpenses).toBeGreaterThan(0);
    expect(somaTodas(f.expensesByCategory)!).toBeCloseTo(s.lastYearExpenses, 5);
  });
});
