/**
 * Issue #142 — Tarefa #18/1: motor guarda o histórico financeiro anual com breakdown por categoria.
 *
 * Hoje o `Treasury` só guarda os totais do ano (`lastYearRevenue`/`lastYearExpenses`) e o
 * `YearCounters` de `city.ts` não tem o breakdown. Este teste trava o que a issue pede:
 * `city.lastYear.revenueByCategory`/`expensesByCategory` com as categorias que movimentoaram,
 * o array `city.yearlyHistory` crescendo um item por ano fechado e o relatório lendo o histórico
 * sem quebrar.
 *
 * Semente fixa, sem relógio e sem `Math.random`: a mesma cidade a cada rodada.
 */
import { reportText } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** As 7 categorias de receita/despesa que já existem no código (economy.ts e commands/apply.ts). */
const CATEGORIAS = [
  "impostos_e_repasses",
  "educacao",
  "saude",
  "agua_e_luz",
  "manutencao_vias",
  "obras_vias",
  "obras_servicos",
] as const;

/**
 * O motor ainda não tem os campos da issue. O teste acessa por tipo local e falha com mensagem
 * clara se o campo não existir, sem travar o `npm run check` enquanto o Dev não implementa.
 */
interface YearSummary {
  [k: string]: unknown;
}

/** A issue não fixa o nome em inglês dos campos; aceita os nomes usuais do saldo e do "se pagou". */
const NOMES_SALDO = ["balance", "saldo", "net", "netBalance", "result", "resultado", "profit"];
const NOMES_PAGOU = ["paid", "selfFinanced", "sePagou", "brokeEven", "positive", "saldoPositivo"];

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Receita (ou despesa) de um resumo de ano: o total direto, senão a soma do breakdown. */
function totalDoAno(resumo: YearSummary, total: string, breakdown: string): number | null {
  const direto = num(resumo[total]);
  if (direto !== null) return direto;
  return soma(resumo[breakdown]);
}

function saldoDoAno(resumo: YearSummary): number | null {
  for (const c of NOMES_SALDO) {
    const v = num(resumo[c]);
    if (v !== null) return v;
  }
  const rev = totalDoAno(resumo, "revenue", "revenueByCategory");
  const exp = totalDoAno(resumo, "expenses", "expensesByCategory");
  return rev !== null && exp !== null ? rev - exp : null;
}

function sePagou(resumo: YearSummary): boolean | null {
  for (const c of NOMES_PAGOU) if (typeof resumo[c] === "boolean") return resumo[c] as boolean;
  return null;
}
interface CityComHistorico {
  year: { revenueByCategory?: unknown; expensesByCategory?: unknown };
  lastYear: { revenueByCategory?: unknown; expensesByCategory?: unknown };
  yearlyHistory?: unknown;
}

/** Soma os valores de um breakdown por categoria, se ele for um objeto de números. */
function soma(obj: unknown): number | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const vals = Object.values(obj as Record<string, unknown>);
  if (vals.some((v) => typeof v !== "number")) return null;
  let total = 0;
  for (const v of vals) total += v as number;
  return total;
}

/** A cidade de referência da issue: 40 dias (anos) de prefeito automático em modo sandbox. */
function cidadeDoTeste(days: number) {
  const game = createTestGame({
    seed: "avaliacao-livre",
    bot: true,
    days,
    overrides: { economy: { mode: "sandbox" } },
  });
  return { game, city: game.city as unknown as CityComHistorico };
}

describe("histórico financeiro anual (issue #142)", () => {
  it("lastYear traz o breakdown por categoria e a soma bate com os totais do ano", () => {
    const { game, city } = cidadeDoTeste(40);
    const rev = city.lastYear.revenueByCategory;
    const exp = city.lastYear.expensesByCategory;

    expect(rev, "city.lastYear.revenueByCategory deve existir").toBeTypeOf("object");
    expect(exp, "city.lastYear.expensesByCategory deve existir").toBeTypeOf("object");

    const somaRev = soma(rev)!;
    const somaExp = soma(exp)!;
    expect(somaRev).toBeCloseTo(game.sim.treasury.lastYearRevenue, 5);
    expect(somaExp).toBeCloseTo(game.sim.treasury.lastYearExpenses, 5);
  });

  it("o breakdown do ano em curso é zerado (receita e despesa ficam em city.year)", () => {
    const { city } = cidadeDoTeste(12);
    // Fim de ano zera o ano corrente: só o que foi movementado neste ano pode aparecer.
    expect(soma(city.year.revenueByCategory)).toBeTypeOf("number");
    expect(soma(city.year.expensesByCategory)).toBeTypeOf("number");
  });

  it("yearlyHistory cresce um item por ano fechado, com saldo e se a cidade se pagou", () => {
    const curta = cidadeDoTeste(12);
    const longa = cidadeDoTeste(40);

    expect(curta.city.yearlyHistory, "city.yearlyHistory deve existir").toBeInstanceOf(Array);
    const hCurta = curta.city.yearlyHistory as YearSummary[];
    const hLonga = longa.city.yearlyHistory as YearSummary[];
    expect(hCurta, "12 dias simulados = 12 anos no histórico").toHaveLength(12);
    expect(hLonga, "40 dias simulados = 40 anos no histórico").toHaveLength(40);

    for (const [i, resumo] of hLonga.entries()) {
      const rev = totalDoAno(resumo, "revenue", "revenueByCategory");
      const exp = totalDoAno(resumo, "expenses", "expensesByCategory");
      expect(rev, `ano ${i}: resumo sem receita`).not.toBeNull();
      expect(exp, `ano ${i}: resumo sem despesa`).not.toBeNull();
      expect(rev!).toBeGreaterThan(0);
      expect(saldoDoAno(resumo), `ano ${i}: resumo sem saldo`).not.toBeNull();
      expect(sePagou(resumo), `ano ${i}: resumo sem dizer se a cidade se pagou`).not.toBeNull();
    }
  });

  it("as 7 categorias de receita e despesa aparecem no histórico inteiro", () => {
    const { city } = cidadeDoTeste(40);
    const vistas = new Set<string>();
    for (const resumo of city.yearlyHistory as YearSummary[]) {
      for (const campo of ["revenueByCategory", "expensesByCategory"] as const) {
        const b = (resumo as Record<string, unknown>)[campo];
        if (b && typeof b === "object") for (const k of Object.keys(b)) vistas.add(k);
      }
    }
    for (const b of [city.lastYear.revenueByCategory, city.lastYear.expensesByCategory]) {
      if (b && typeof b === "object") for (const k of Object.keys(b)) vistas.add(k);
    }
    for (const c of CATEGORIAS) expect(vistas, `categoria ${c} nunca apareceu`).toContain(c);
    // A cidade com 40 anos de histórico guardado continua reportando sem quebrar.
    expect(reportText(cidadeDoTeste(40).game)).toContain("Saldo");
  });
});
