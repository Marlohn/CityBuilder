/**
 * Issue #163 — custo e prazo de saneamento/energia precisam de fonte.
 *
 * Os valores de `cost`, `upkeepPerYear` (de `poco`, `eta`, `subestacao` e `ete`)
 * e `constructionMonths` (só da `ete`) em `data/buildings.yaml` não podem ficar
 * com PENDENTE: cada um precisa de link de fonte + a conta que leva do dado ao
 * número, no comentário logo acima (até 3 linhas acima + "#" da própria linha).
 *
 * Este teste trava o critério: falha enquanto houver PENDENTE ou faltar
 * link/conta, e trava `serves` e `jobs` (que continuam PENDENTE de propósito)
 * contra o Dev mexer em vazão/equipe nesta tarefa. Semente/constantes fixas,
 * sem relógio, sem `Math.random` e sem rede.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Valores de dinheiro e prazo tocados pela tarefa, por bloco. `poco`, `eta` e
 * `subestacao` já têm `constructionMonths` com número e sem PENDENTE
 * (6, 24 e 18), então só a `ete` entra com prazo neste mapa.
 */
const FIELDS_BY_BLOCK: Record<string, readonly string[]> = {
  poco: ["cost", "upkeepPerYear"],
  eta: ["cost", "upkeepPerYear"],
  subestacao: ["cost", "upkeepPerYear"],
  ete: ["cost", "upkeepPerYear", "constructionMonths"],
};

/** Os 9 valores que a issue manda tirar do PENDENTE. */
const TOUCHED_VALUES = [
  "poco.cost",
  "poco.upkeepPerYear",
  "eta.cost",
  "eta.upkeepPerYear",
  "subestacao.cost",
  "subestacao.upkeepPerYear",
  "ete.cost",
  "ete.upkeepPerYear",
  "ete.constructionMonths",
] as const;

/** Blocos de saneamento/energia cobrados pela issue #163. */
const BLOCKS = Object.keys(FIELDS_BY_BLOCK);

/** Campos que ficam PENDENTE de propósito (vazão/equipe, fora de escopo). */
const KEPT_FIELDS: readonly string[] = ["serves", "jobs"];

/** Raiz do repositório, resolvida a partir deste arquivo (tests/unit/ -> raiz). */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Lê o catálogo como texto cru do disco (sem yaml, sem @city/*). */
function readLines(): string[] {
  return readFileSync(join(repoRoot, "data", "buildings.yaml"), "utf8").split("\n");
}

/**
 * Devolve { start, end } do bloco "- id: <id>" até a próxima linha "- id:"
 * (ou fim do arquivo). Start é a linha do "- id:", end é exclusiva.
 */
function findBlock(lines: string[], id: string): { start: number; end: number } {
  const startPattern = new RegExp(`^\\s*-\\s*id:\\s*${id}\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startPattern.test(lines[i] ?? "")) {
      start = i;
      break;
    }
  }
  if (start < 0) return { start: -1, end: -1 };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*-\s*id:\s*\S+/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Índice da primeira linha casando com o campo no intervalo [start, end), -1 se não achar. */
function fieldLine(lines: string[], field: string, start: number, end: number): number {
  const fieldPattern = new RegExp(`^\\s*${field}\\s*:`);
  for (let i = start; i < end; i++) {
    if (fieldPattern.test(lines[i] ?? "")) return i;
  }
  return -1;
}

/**
 * Comentário estreito do campo: as duas linhas imediatamente acima (linha
 * inteira, como no vizinho) mais o trecho depois do "#" da própria linha.
 * Janela de 2 linhas de propósito: a janela larga de 3 linhas vazaria o
 * PENDENTE do campo vizinho (vazão/equipe) e acusaria o Dev à toa.
 */
function commentAbove(lines: string[], line: number): string {
  const parts: string[] = [];
  if (line - 2 >= 0) parts.push(lines[line - 2] ?? "");
  if (line - 1 >= 0) parts.push(lines[line - 1] ?? "");
  const own = lines[line] ?? "";
  const hash = own.indexOf("#");
  if (hash >= 0) parts.push(own.slice(hash));
  return parts.join("\n");
}

/**
 * Comentário em janela maior (até 3 linhas acima + a própria linha, só o
 * trecho depois do "#"): usado no link/conta (a issue permite até 3 linhas)
 * e no `serves`/`jobs`, cujo PENDENTE pode estar numa explicativa de 2 linhas.
 */
function wideComment(lines: string[], line: number): string {
  const parts: string[] = [];
  for (let i = Math.max(0, line - 3); i <= line; i++) {
    const current = lines[i] ?? "";
    const hash = current.indexOf("#");
    if (hash >= 0) parts.push(current.slice(hash));
  }
  return parts.join("\n");
}

/** Extrai o número da linha "campo: valor # comentário" (ignora o comentário). */
function numericValue(lines: string[], line: number): number | undefined {
  const text = lines[line] ?? "";
  const afterColon = text.split(":").slice(1).join(":");
  const beforeHash = afterColon.split("#")[0] ?? "";
  const clean = beforeHash.trim().split(/\s+/)[0] ?? "";
  if (clean === "") return undefined;
  const number = Number(clean);
  return Number.isNaN(number) ? undefined : number;
}

describe("issue #163: custo e prazo de saneamento/energia têm fonte", () => {
  it("nenhum dos 9 valores de dinheiro ou prazo fica PENDENTE", () => {
    const lines = readLines();
    const problems: string[] = [];
    // Para cada bloco e cada campo tocado, cobra linha existente sem PENDENTE no comentário estreito.
    for (const block of BLOCKS) {
      const { start, end } = findBlock(lines, block);
      if (start < 0) {
        problems.push(`data/buildings.yaml não tem o bloco com id "${block}"`);
        continue;
      }
      for (const field of FIELDS_BY_BLOCK[block] ?? []) {
        if (!(TOUCHED_VALUES as readonly string[]).includes(`${block}.${field}`)) continue;
        const line = fieldLine(lines, field, start, end);
        if (line < 0) {
          problems.push(
            `data/buildings.yaml: o bloco "${block}" não tem o campo "${field}" (esperado entre as linhas ${start + 1} e ${end})`,
          );
          continue;
        }
        const comment = commentAbove(lines, line);
        if (comment.includes("PENDENTE")) {
          problems.push(
            `data/buildings.yaml: o campo "${block}.${field}" (linha ${line + 1}) ainda está PENDENTE, ` +
              `trecho encontrado: "${comment.trim()}"`,
          );
        }
      }
    }
    expect(problems, `valores com PENDENTE: ${problems.join("; ")}`).toEqual([]);
  });

  it("cada um dos 9 valores tem link de fonte e a conta", () => {
    const lines = readLines();
    const problems: string[] = [];
    const linkPattern = /https?:\/\/\S+/;
    // Conta que liga a fonte ao número: "A x B" (com x, × ou *) ou "A = N".
    const multPattern = /\d[\d.,]*\s*[x×*]\s*\d/;
    const equalPattern = /=\s*[\d.]/;
    // Para cada bloco e cada campo tocado, cobra URL + conta no comentário largo (até 3 linhas acima).
    for (const block of BLOCKS) {
      const { start, end } = findBlock(lines, block);
      if (start < 0) {
        problems.push(`data/buildings.yaml não tem o bloco com id "${block}"`);
        continue;
      }
      for (const field of FIELDS_BY_BLOCK[block] ?? []) {
        if (!(TOUCHED_VALUES as readonly string[]).includes(`${block}.${field}`)) continue;
        const line = fieldLine(lines, field, start, end);
        if (line < 0) {
          problems.push(
            `data/buildings.yaml: o bloco "${block}" não tem o campo "${field}" (sem linha, sem fonte para conferir)`,
          );
          continue;
        }
        const comment = wideComment(lines, line);
        const hasLink = linkPattern.test(comment);
        const hasCalc = multPattern.test(comment) || equalPattern.test(comment);
        if (!hasLink || !hasCalc) {
          const missing = !hasLink && !hasCalc ? "link e conta" : !hasLink ? "link" : "conta";
          problems.push(
            `data/buildings.yaml: o campo "${block}.${field}" (linha ${line + 1}) não tem ${missing} no comentário, ` +
              `trecho encontrado: "${comment.trim()}"`,
          );
        }
      }
    }
    expect(problems, `faltou fonte ou conta: ${problems.join("; ")}`).toEqual([]);
  });

  it("serves e jobs dos quatro blocos continuam com PENDENTE", () => {
    const lines = readLines();
    const problems: string[] = [];
    // Vazão e equipe ficam para outra tarefa: cada serves/jobs precisa continuar com PENDENTE no comentário largo.
    for (const block of BLOCKS) {
      const { start, end } = findBlock(lines, block);
      if (start < 0) {
        problems.push(`data/buildings.yaml não tem o bloco com id "${block}"`);
        continue;
      }
      for (const field of KEPT_FIELDS) {
        const line = fieldLine(lines, field, start, end);
        if (line < 0) {
          problems.push(`data/buildings.yaml: o bloco "${block}" não tem o campo "${field}"`);
          continue;
        }
        const comment = wideComment(lines, line);
        if (!comment.includes("PENDENTE")) {
          problems.push(
            `data/buildings.yaml: o campo "${block}.${field}" (linha ${line + 1}) deveria continuar PENDENTE ` +
              `(vazão/equipe fica para outra tarefa), trecho encontrado: "${comment.trim()}"`,
          );
        }
      }
    }
    expect(problems, `vazão/equipe mexeu fora do escopo: ${problems.join("; ")}`).toEqual([]);
  });

  it("os 9 valores continuam sendo inteiros positivos e o prazo é válido", () => {
    const lines = readLines();
    const problems: string[] = [];
    // Dinheiro e prazo precisam ser inteiros positivos; prazo de obra fica entre 1 e 120 meses.
    for (const block of BLOCKS) {
      const { start, end } = findBlock(lines, block);
      if (start < 0) {
        problems.push(`data/buildings.yaml não tem o bloco com id "${block}"`);
        continue;
      }
      for (const field of FIELDS_BY_BLOCK[block] ?? []) {
        const line = fieldLine(lines, field, start, end);
        if (line < 0) {
          problems.push(`data/buildings.yaml: o bloco "${block}" não tem o campo "${field}"`);
          continue;
        }
        const value = numericValue(lines, line);
        if (value === undefined) {
          const found = (lines[line] ?? "").trim();
          problems.push(
            `data/buildings.yaml: o campo "${block}.${field}" (linha ${line + 1}) não tem valor numérico, ` +
              `valor encontrado: "${found}"`,
          );
          continue;
        }
        if (!Number.isInteger(value) || value <= 0) {
          const found = (lines[line] ?? "").trim();
          problems.push(
            `data/buildings.yaml: o campo "${block}.${field}" (linha ${line + 1}) deveria ser inteiro positivo, ` +
              `valor encontrado: "${found}"`,
          );
          continue;
        }
        if (field === "constructionMonths" && (value < 1 || value > 120)) {
          const found = (lines[line] ?? "").trim();
          problems.push(
            `data/buildings.yaml: o campo "${block}.${field}" (linha ${line + 1}) deveria estar entre 1 e 120 meses, ` +
              `valor encontrado: "${found}"`,
          );
        }
      }
    }
    expect(problems, `valores inválidos: ${problems.join("; ")}`).toEqual([]);
  });
});
