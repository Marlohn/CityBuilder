/**
 * Issue #192 — o prazo de obra do prédio residencial precisa de fonte.
 *
 * Hoje o campo `constructionMonths` do bloco `predio_residencial` em
 * `data/buildings.yaml` está com PENDENTE no comentário de cima. A tarefa
 * é dar fonte (link + conta) só para esse prazo. Os PENDENTE de `jobs`,
 * de `serves` e do cálculo de área útil ficam para outras tarefas.
 *
 * Um `it` por critério, semente fixa, sem Math.random, sem relógio
 * e sem medir tempo em ms. Estes testes devem FALHAR na main de hoje
 * (falta a fonte do prazo) e o teste 3 deve PASSAR (trava o resto).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigAndData } from "@city/cli";
import { BSTATE, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** Semente fixa única do arquivo (nada de relógio nem `Math.random`). */
const SEED = "prazo-obra-192";
/** Dias de jogo do cenário controlado (obra vira fração de dia). */
const DAYS = 40;

/** Raiz do repositório, resolvida a partir deste arquivo (tests/acceptance/ -> raiz). */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Lê o catálogo como texto cru do disco (sem yaml, sem @city/*). */
function readLines(): string[] {
  return readFileSync(join(repoRoot, "data", "buildings.yaml"), "utf8").split("\n");
}

/**
 * Devolve { start, end } do bloco "- id: <id>" até o próximo "- id:"
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

/** Todos os ids de bloco "- id: xxx" na ordem do arquivo. */
function allBlockIds(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const m = /^\s*-\s*id:\s*(\S+)\s*$/.exec(line);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

/** Índice da primeira linha casando com o campo no intervalo [start, end), -1 se não achar. */
function findFieldLine(lines: string[], field: string, start: number, end: number): number {
  const fieldPattern = new RegExp(`^\\s*${field}\\s*:`);
  for (let i = start; i < end; i++) {
    if (fieldPattern.test(lines[i] ?? "")) return i;
  }
  return -1;
}

/**
 * Comentário do campo: a linha imediatamente acima (o "logo acima" da issue) e o
 * trecho depois do "#" da própria linha do campo, se houver. Uma linha só, para
 * o comentário de um campo não vazar PENDENTE do campo vizinho.
 */
function commentAbove(lines: string[], line: number): string {
  const parts: string[] = [];
  if (line > 0) parts.push(lines[line - 1] ?? "");
  const own = lines[line] ?? "";
  const hash = own.indexOf("#");
  if (hash >= 0) parts.push(own.slice(hash));
  return parts.join("\n");
}

/**
 * Comentário em janela maior (até 3 linhas acima + a própria linha): usado nos
 * `jobs`/`serves`, cujo PENDENTE pode estar numa linha explicativa anterior.
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

describe("issue #192: prazo de obra do prédio residencial tem fonte", () => {
  it("nenhum dinheiro ou prazo de nenhum bloco fica PENDENTE", () => {
    // Varrer o arquivo inteiro: cada cost/upkeepPerYear/constructionMonths
    // presente em cada bloco não pode ter PENDENTE nem acima nem na linha.
    const lines = readLines();
    const problems: string[] = [];
    const ids = allBlockIds(lines);
    expect(ids, `data/buildings.yaml não tem nenhum bloco "- id:"`).not.toEqual([]);
    for (const id of ids) {
      const { start, end } = findBlock(lines, id);
      if (start < 0) {
        problems.push(`data/buildings.yaml não tem o bloco com id "${id}"`);
        continue;
      }
      for (const field of ["cost", "upkeepPerYear", "constructionMonths"]) {
        const line = findFieldLine(lines, field, start, end);
        if (line < 0) continue;
        const comment = commentAbove(lines, line);
        if (comment.includes("PENDENTE")) {
          problems.push(
            `data/buildings.yaml: o campo "${id}.${field}" (linha ${line + 1}) ainda está PENDENTE, ` +
              `trecho encontrado: "${comment.trim()}"`,
          );
        }
      }
    }
    expect(problems, `valores com PENDENTE: ${problems.join("; ")}`).toEqual([]);
  });

  it("o prazo do prédio residencial tem link de fonte e a conta", () => {
    // O constructionMonths do predio_residencial precisa de link (http/https)
    // e da conta que liga a fonte ao número (A x B ou = N) no comentário acima.
    const lines = readLines();
    const { start, end } = findBlock(lines, "predio_residencial");
    expect(start, `data/buildings.yaml não tem o bloco com id "predio_residencial"`).toBeGreaterThanOrEqual(
      0,
    );
    const line = findFieldLine(lines, "constructionMonths", start, end);
    expect(
      line,
      `data/buildings.yaml: o bloco "predio_residencial" não tem o campo "constructionMonths"`,
    ).toBeGreaterThanOrEqual(0);
    const comment = commentAbove(lines, line);
    const hasLink = /https?:\/\/\S+/.test(comment);
    const hasMult = /\d[\d.,]*\s*[x×*]\s*\d/.test(comment);
    const hasEquals = /=\s*[\d.]/.test(comment);
    const hasCalc = hasMult || hasEquals;
    expect(
      hasLink && hasCalc,
      `data/buildings.yaml: o campo "predio_residencial.constructionMonths" (linha ${line + 1}) ` +
        `precisa de link de fonte e da conta no comentário acima ` +
        `(${!hasLink ? "faltou link" : ""}${!hasLink && !hasCalc ? " e " : ""}${!hasCalc ? "faltou conta (A x B ou = N)" : ""}), ` +
        `trecho encontrado: "${comment.trim()}"`,
    ).toBe(true);
  });

  it("os PENDENTE de jobs, serves e área útil continuam", () => {
    // A tarefa é só do prazo do prédio: jobs (escola, ubs, ete), serves
    // (poco, eta, ete) e a área útil do cabeçalho continuam PENDENTE.
    const lines = readLines();
    const problems: string[] = [];
    const pendingJobs = ["escola", "ubs", "ete"];
    for (const id of pendingJobs) {
      const { start, end } = findBlock(lines, id);
      if (start < 0) {
        problems.push(`data/buildings.yaml não tem o bloco com id "${id}"`);
        continue;
      }
      const line = findFieldLine(lines, "jobs", start, end);
      if (line < 0) {
        problems.push(`data/buildings.yaml: o bloco "${id}" não tem o campo "jobs"`);
        continue;
      }
      const comment = wideComment(lines, line);
      if (!comment.includes("PENDENTE")) {
        problems.push(
          `data/buildings.yaml: o campo "${id}.jobs" (linha ${line + 1}) deveria continuar PENDENTE ` +
            `(equipe fica para outra tarefa), trecho encontrado: "${comment.trim()}"`,
        );
      }
    }
    const pendingServes = ["poco", "eta", "ete"];
    for (const id of pendingServes) {
      const { start, end } = findBlock(lines, id);
      if (start < 0) {
        problems.push(`data/buildings.yaml não tem o bloco com id "${id}"`);
        continue;
      }
      const line = findFieldLine(lines, "serves", start, end);
      if (line < 0) {
        problems.push(`data/buildings.yaml: o bloco "${id}" não tem o campo "serves"`);
        continue;
      }
      const comment = wideComment(lines, line);
      if (!comment.includes("PENDENTE")) {
        problems.push(
          `data/buildings.yaml: o campo "${id}.serves" (linha ${line + 1}) deveria continuar PENDENTE ` +
            `(porte fica para outra tarefa), trecho encontrado: "${comment.trim()}"`,
        );
      }
    }
    const headerLine = lines.findIndex((l) => l.includes("Área útil"));
    if (headerLine < 0) {
      problems.push(`data/buildings.yaml: não achei a linha do cabeçalho com "Área útil"`);
    } else if (!lines[headerLine]!.includes("PENDENTE")) {
      problems.push(
        `data/buildings.yaml: a linha do cabeçalho com "Área útil" (linha ${headerLine + 1}) ` +
          `deveria continuar com PENDENTE, trecho encontrado: "${lines[headerLine]!.trim()}"`,
      );
    }
    expect(problems, `mexeu fora do prazo do prédio: ${problems.join("; ")}`).toEqual([]);
  });

  it("a obra respeita o prazo e a cidade cresce com dinheiro em caixa", { timeout: 300000 }, () => {
    // Sem fonte o cenário não prova nada: primeiro cobra o que a issue pede.
    const lines = readLines();
    const { start, end } = findBlock(lines, "predio_residencial");
    expect(start, `data/buildings.yaml não tem o bloco com id "predio_residencial"`).toBeGreaterThanOrEqual(
      0,
    );
    const fieldLine = findFieldLine(lines, "constructionMonths", start, end);
    expect(
      fieldLine,
      `data/buildings.yaml: o bloco "predio_residencial" não tem o campo "constructionMonths"`,
    ).toBeGreaterThanOrEqual(0);
    const fieldComment = commentAbove(lines, fieldLine);
    expect(
      fieldComment.includes("PENDENTE"),
      `data/buildings.yaml: o campo "predio_residencial.constructionMonths" (linha ${fieldLine + 1}) ` +
        `ainda está PENDENTE: sem a fonte da issue #192 o cenário não prova nada, ` +
        `trecho encontrado: "${fieldComment.trim()}"`,
    ).toBe(false);
    const sourceLink = /https?:\/\/\S+/.test(fieldComment);
    const sourceCalc = /\d[\d.,]*\s*[x×*]\s*\d/.test(fieldComment) || /=\s*[\d.]/.test(fieldComment);
    expect(
      sourceLink && sourceCalc,
      `data/buildings.yaml: o campo "predio_residencial.constructionMonths" (linha ${fieldLine + 1}) ` +
        `precisa de link e conta no comentário: sem isso o cenário não prova a issue #192, ` +
        `trecho encontrado: "${fieldComment.trim()}"`,
    ).toBe(true);

    // Prazo lido do próprio catálogo (não repete o número no teste).
    const { data } = loadConfigAndData();
    const entry = data.buildings.find((b) => b.id === "predio_residencial");
    expect(entry, `data/buildings.yaml não tem o prédio "predio_residencial" no catálogo`).toBeDefined();
    const constructionMonths = entry!.constructionMonths;
    expect(
      constructionMonths,
      `o prazo de obra do prédio residencial deveria ser inteiro positivo`,
    ).toBeGreaterThan(0);

    // Cidade controlada: bot no estresse, dinheiro infinito, 40 dias.
    const game = createTestGame({
      seed: SEED,
      scenario: "estresse",
      bot: true,
      overrides: { economy: { mode: "sandbox" } },
      days: DAYS,
    });
    const buildings = game.sim.buildings;
    let finishedHomes = 0;
    const underConstruction: number[] = [];
    for (let id = 0; id < buildings.count; id++) {
      const typeId = buildings.typeOf(id).id;
      if (typeId !== "casa" && typeId !== "predio_residencial") continue;
      const state = buildings.state[id]!;
      if (state === BSTATE.demolished) continue;
      if (state === BSTATE.active) finishedHomes += 1;
      if (typeId === "predio_residencial" && state === BSTATE.constructing) underConstruction.push(id);
    }
    expect(
      finishedHomes,
      `no dia ${DAYS} era esperada pelo menos 1 casa ou prédio residencial concluído (active), ` +
        `mas não há nenhum: com o prazo virando fração de dia (constructionMonths/12) a obra tinha que terminar`,
    ).toBeGreaterThan(0);
    expect(
      statsView(game).money,
      `no dia ${DAYS} o dinheiro deveria continuar positivo no modo sandbox, ` +
        `mas veio ${statsView(game).money}: a cidade não pode quebrar por causa da obra`,
    ).toBeGreaterThan(0);

    // A obra respeita o prazo: o que ainda está em obra não passa do total.
    // Total em ticks = (constructionMonths/12 anos) * ticksPorDia (1 dia = 1 ano).
    // Vale para prazo curto ou longo: o teto cresce junto com o número.
    const ticksPerDay = game.sim.clock.ticksPerDay;
    const totalTicks = Math.round((constructionMonths / 12) * ticksPerDay);
    for (const id of underConstruction) {
      const remaining = buildings.readyTick[id]! - game.sim.clock.tick;
      expect(
        remaining,
        `o prédio residencial ${id} ainda em obra deveria terminar em até ${totalTicks} ticks ` +
          `(constructionMonths/12 dias), mas faltam ${remaining} ticks: a obra não respeita o prazo`,
      ).toBeGreaterThan(0);
      expect(
        remaining,
        `o prédio residencial ${id} ainda em obra deveria terminar em até ${totalTicks} ticks ` +
          `(constructionMonths/12 dias), mas faltam ${remaining} ticks: a obra não respeita o prazo`,
      ).toBeLessThanOrEqual(totalTicks);
    }
  });
});
