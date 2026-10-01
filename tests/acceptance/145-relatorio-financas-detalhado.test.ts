/**
 * Issue #145 — Tarefa #18/4: o relatório em texto detalha as finanças na seção "## Prefeitura".
 *
 * Hoje o `reportText` só imprime `Saldo + receita + despesa`. A issue pede, na seção
 * "## Prefeitura": (1) receita por categoria, (2) despesa por categoria separando custeio
 * e investimento, (3) "A cidade se paga? R$ X" com o `netOperating` e (4) "Saldo no fim
 * do ano: R$ Y" com o `moneyEnd` do último ano fechado — além de (5) documentar no
 * `docs/GUIA-DO-CODIGO.md` como adicionar uma categoria financeira.
 *
 * Semente fixa, sem relógio e sem `Math.random`: a mesma cidade a cada rodada.
 */

import { readFileSync } from "node:fs";
import type { StatsView } from "@city/contract";
import { reportText, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/**
 * O bloco `finance` ainda não existe na main. O teste acessa por tipos locais opcionais
 * e falha com mensagem clara em português, sem `any` (só `unknown` + narrowing).
 */
interface FinanceViewLocal {
  revenueByCategory?: unknown;
  expensesByCategory?: unknown;
  netOperating?: unknown;
  investment?: unknown;
  yearlyHistory?: unknown;
}

interface StatsComFinanceLocal extends StatsView {
  finance?: FinanceViewLocal;
}

/** Um objeto simples de categoria -> valor, ou null quando não é isso. */
function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * O bloco `finance` da visão. Ele vem das tarefas #142 (motor) e #143 (contrato/visao), das
 * quais esta issue depende: enquanto elas não entrarem, o teste avisa isso com a mensagem
 * abaixo em vez de estourar um TypeError.
 */
function financeDaVisao(s: StatsComFinanceLocal): FinanceViewLocal {
  expect(
    s.finance,
    "statsView(game).finance precisa existir com o breakdown por categoria (vem das tarefas #142 e #143, das quais a #145 depende)",
  ).toBeTypeOf("object");
  return s.finance as FinanceViewLocal;
}

/** Inteiro com ponto de milhar, igual ao `n()` do report.ts. */
function milhares(v: number): string {
  return Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Rótulo em reais com a MESMA regra do `money()` do report.ts. */
function rotuloReais(v: number): string {
  const abs = Math.abs(v);
  const s = abs >= 1e6 ? `${(abs / 1e6).toFixed(1).replace(".", ",")} mi` : milhares(abs);
  return `${v < 0 ? "-" : ""}R$ ${s}`;
}

/** Tolerância em reais: 0,06 mi no ramo "mi" (arredondamento de 0,1 mi) e 1 no ramo inteiro. */
function toleranciaPara(v: number): number {
  return Math.abs(v) >= 1e6 ? 0.06 * 1e6 : 1;
}

/** Extrai todos os valores em R$ de uma linha do relatório, já em reais. */
function valoresNaLinha(linha: string): number[] {
  const achados: number[] = [];
  const re = /(-?)R\$\s*([\d.,]+)(\s*mi)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(linha)) !== null) {
    const bruto = m[2].replace(/\./g, "").replace(",", ".");
    const numero = Number(bruto);
    if (!Number.isFinite(numero)) continue;
    const emReais = m[3] ? numero * 1e6 : numero;
    achados.push(m[1] === "-" ? -emReais : emReais);
  }
  return achados;
}

/**
 * Acha a linha que mostra a categoria. O relatório pode escrever o identificador com
 * sublinhado ("impostos_e_repasses") ou legível ("impostos e repasses"), e com caixa
 * diferente: a comparação é feita sobre o texto normalizado.
 */
function linhaDaCategoria(linhas: string[], categoria: string): string | undefined {
  const alvo = normaliza(categoria);
  return linhas.find((l) => normaliza(l).includes(alvo));
}

/** Minúsculas, sem acento e só letras/números com espaço entre as palavras. */
function normaliza(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Verdadeiro quando a linha traz um valor em R$ compatível com o esperado. */
function linhaMostraValor(linha: string, esperado: number): boolean {
  const tol = toleranciaPara(esperado);
  return valoresNaLinha(linha).some((got) => Math.abs(got - esperado) <= tol);
}

/**
 * Só as linhas da seção "## Prefeitura" do relatório: é lá que mora a contabilidade da
 * prefeitura. Sem isso, "saúde" casaria com a linha de viagens por motivo.
 */
function linhasDaPrefeitura(texto: string): string[] {
  const linhas = texto.split("\n");
  const inicio = linhas.findIndex((l) => l.trim() === "## Prefeitura");
  if (inicio < 0) return [];
  const resto = linhas.slice(inicio + 1);
  const fim = resto.findIndex((l) => /^##\s/.test(l));
  return fim < 0 ? resto : resto.slice(0, fim);
}

/** A cidade de referência da issue: 40 dias (anos) de prefeito automático em modo sandbox. */
const game = createTestGame({
  seed: "avaliacao-livre",
  bot: true,
  days: 40,
  overrides: { economy: { mode: "sandbox" } },
});
const visao = statsView(game) as StatsComFinanceLocal;
const texto = reportText(game);

describe("relatório detalha as finanças (issue #145)", () => {
  it("o relatório mostra a receita por categoria", () => {
    expect(texto, "o relatório deve ter a seção ## Prefeitura").toContain("## Prefeitura");
    const f = financeDaVisao(visao);
    const breakdown = asRecord(f.revenueByCategory);
    expect(breakdown, "finance.revenueByCategory deve existir com a receita por categoria").not.toBeNull();
    const entradas = Object.entries(breakdown as Record<string, unknown>);
    expect(entradas.length, "finance.revenueByCategory está vazio").toBeGreaterThan(0);
    const linhas = linhasDaPrefeitura(texto);
    expect(linhas.length, "a seção ## Prefeitura do relatório não existe").toBeGreaterThan(0);
    for (const [categoria, bruto] of entradas) {
      const valor = asNumber(bruto);
      expect(valor, `categoria de receita ${categoria} deve ser um número`).not.toBeNull();
      const esperado = valor as number;
      const achada = linhaDaCategoria(linhas, categoria);
      expect(
        achada,
        `o relatório não mostra a receita ${categoria} (expected: linha com "${categoria}" e ${rotuloReais(esperado)})`,
      ).toBeDefined();
      expect(
        linhaMostraValor(achada as string, esperado),
        `receita ${categoria} com valor errado (expected: ${rotuloReais(esperado)} got: "${achada}")`,
      ).toBe(true);
    }
  });

  it("o relatório mostra a despesa por categoria separando custeio e investimento", () => {
    expect(texto, "o relatório deve ter a seção ## Prefeitura").toContain("## Prefeitura");
    // Os dois grupos aparecem com rótulo próprio (aceita com ou sem acento).
    expect(texto, "o relatório não separa o custeio na despesa").toMatch(/cust[eé]io/i);
    expect(texto, "o relatório não separa o investimento na despesa").toMatch(/investimento/i);
    const f = financeDaVisao(visao);
    const breakdown = asRecord(f.expensesByCategory);
    expect(breakdown, "finance.expensesByCategory deve existir com a despesa por categoria").not.toBeNull();
    const entradas = Object.entries(breakdown as Record<string, unknown>);
    expect(entradas.length, "finance.expensesByCategory está vazio").toBeGreaterThan(0);
    const linhas = linhasDaPrefeitura(texto);
    expect(linhas.length, "a seção ## Prefeitura do relatório não existe").toBeGreaterThan(0);
    for (const [categoria, bruto] of entradas) {
      const valor = asNumber(bruto);
      expect(valor, `categoria de despesa ${categoria} deve ser um número`).not.toBeNull();
      const esperado = valor as number;
      const achada = linhaDaCategoria(linhas, categoria);
      expect(
        achada,
        `o relatório não mostra a despesa ${categoria} (expected: linha com "${categoria}" e ${rotuloReais(esperado)})`,
      ).toBeDefined();
      expect(
        linhaMostraValor(achada as string, esperado),
        `despesa ${categoria} com valor errado (expected: ${rotuloReais(esperado)} got: "${achada}")`,
      ).toBe(true);
    }
  });

  it("o relatório diz se a cidade se paga, com o valor de netOperating", () => {
    const f = financeDaVisao(visao);
    const operacional = asNumber(f.netOperating);
    expect(operacional, "finance.netOperating deve existir com o resultado do custeio").not.toBeNull();
    const esperado = operacional as number;
    const linhas = linhasDaPrefeitura(texto);
    expect(linhas.length, "a seção ## Prefeitura do relatório não existe").toBeGreaterThan(0);
    const achada = linhas.find((l) => /A cidade se paga/i.test(l) && l.includes("R$"));
    expect(
      achada,
      `o relatório não diz se a cidade se paga (expected: linha "A cidade se paga? ${rotuloReais(esperado)}")`,
    ).toBeDefined();
    expect(
      linhaMostraValor(achada as string, esperado),
      `valor de "se paga" errado (expected: ${rotuloReais(esperado)} got: "${achada}")`,
    ).toBe(true);
  });

  it("o relatório mostra o saldo no fim do ano, com o moneyEnd do último ano fechado", () => {
    const f = financeDaVisao(visao);
    expect(f.yearlyHistory, "finance.yearlyHistory deve existir com os anos fechados").toBeInstanceOf(Array);
    const historico = f.yearlyHistory as unknown[];
    expect(historico.length, "finance.yearlyHistory está vazio").toBeGreaterThan(0);
    const ultimo = asRecord(historico[historico.length - 1]);
    expect(ultimo, "o último ano do histórico deve ser um objeto").not.toBeNull();
    const saldoFim = asNumber((ultimo as Record<string, unknown>).moneyEnd);
    expect(saldoFim, "o último ano deve trazer moneyEnd com o saldo em dinheiro").not.toBeNull();
    const esperado = saldoFim as number;
    const linhas = texto.split("\n");
    const achada = linhas.find((l) => /Saldo no fim do ano/i.test(l) && l.includes("R$"));
    expect(
      achada,
      `o relatório não mostra o saldo no fim do ano (expected: linha "Saldo no fim do ano: ${rotuloReais(esperado)}")`,
    ).toBeDefined();
    // O ano pode aparecer antes do ": R$" (ex.: "Saldo no fim do ano 12: R$ ...").
    expect(achada as string, 'a linha deve seguir o formato "Saldo no fim do ano...: R$"').toMatch(
      /Saldo no fim do ano[^\n:]*:\s*R\$/,
    );
    expect(
      linhaMostraValor(achada as string, esperado),
      `saldo no fim do ano errado (expected: ${rotuloReais(esperado)} got: "${achada}")`,
    ).toBe(true);
  });

  it("o guia do código explica como adicionar uma categoria financeira", () => {
    const guia = readFileSync(new URL("../../docs/GUIA-DO-CODIGO.md", import.meta.url), "utf-8");
    const linhas = guia.split("\n");
    const inicio = linhas.findIndex((l) => /^#+\s.*categoria financeira/i.test(l));
    expect(inicio, "o guia deve ter uma seção sobre categoria financeira").toBeGreaterThanOrEqual(0);
    // O corpo vai do título até o próximo título do mesmo nível ou o fim do arquivo.
    const resto = linhas.slice(inicio + 1);
    const fimRelativo = resto.findIndex((l) => /^#{1,3}\s/.test(l));
    const corpo = (fimRelativo < 0 ? resto : resto.slice(0, fimRelativo)).join("\n");
    expect(corpo, "o guia deve citar o treasury ao explicar a categoria nova").toMatch(/treasury/i);
    expect(corpo, "o guia deve citar city.ts ao explicar a categoria nova").toMatch(/city\.ts/);
    expect(corpo, "o guia deve citar view.ts (contract) ao explicar a categoria nova").toMatch(/view\.ts/);
    expect(corpo, "o guia deve citar stats.ts ao explicar a categoria nova").toMatch(/stats\.ts/);
    expect(corpo, "o guia deve citar report.ts ao explicar a categoria nova").toMatch(/report\.ts/);
    expect(corpo, "o guia deve citar a UI ao explicar a categoria nova").toMatch(/\bUI\b/);
  });
});
