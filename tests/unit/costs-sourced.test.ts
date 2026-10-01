/**
 * Issue #162 — dinheiro e prazo de escola, ubs e hospital precisam de fonte.
 *
 * Os valores de `cost`, `upkeepPerYear` e `constructionMonths` dos blocos
 * `escola`, `ubs` e `hospital` em `data/buildings.yaml` não podem ficar com
 * PENDENTE: cada um precisa de link de fonte + a conta que leva do dado ao
 * número, no comentário logo acima (até 3 linhas acima + "#" da própria linha).
 *
 * Este teste trava o critério: falha enquanto houver PENDENTE ou faltar
 * link/conta, e trava os `jobs` (que continuam PENDENTE de propósito) contra
 * o Dev mexer em equipe nesta tarefa. Semente/constantes fixas, sem relógio
 * e sem `Math.random`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Valores de dinheiro e prazo tocados pela tarefa, por bloco. `escola` não tem
 * `upkeepPerYear`: o custo anual dela é por aluno (`upkeepPerStudentPerYear`,
 * fora do escopo), então exigir esse campo seria acusar algo que não existe.
 */
const CAMPOS_POR_BLOCO: Record<string, readonly string[]> = {
  escola: ["cost", "constructionMonths"],
  ubs: ["cost", "upkeepPerYear", "constructionMonths"],
  hospital: ["cost", "upkeepPerYear", "constructionMonths"],
};

/**
 * Os valores que a issue manda tirar do PENDENTE: `ubs.upkeepPerYear`,
 * `hospital.cost`, `hospital.upkeepPerYear` e os dois prazos (`escola` e
 * `hospital`). Os outros valores de dinheiro/prazo (`escola.cost`, `ubs.cost`,
 * `ubs.constructionMonths`) já têm número e não entram no escopo desta tarefa.
 */
const VALORES_TOCADOS = [
  "escola.constructionMonths",
  "ubs.upkeepPerYear",
  "hospital.cost",
  "hospital.upkeepPerYear",
  "hospital.constructionMonths",
] as const;

/** Blocos cobrados pela issue #162. */
const BLOCOS = Object.keys(CAMPOS_POR_BLOCO);

/** Raiz do repositório, resolvida a partir deste arquivo (tests/unit/ -> raiz). */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Lê o catálogo como texto cru do disco (sem yaml, sem @city/*). */
function lerLinhas(): string[] {
  return readFileSync(join(repoRoot, "data", "buildings.yaml"), "utf8").split("\n");
}

/**
 * Devolve { inicio, fim } do bloco "- id: <id>" até a próxima linha "- id:"
 * (ou fim do arquivo). Inicio é a linha do "- id:", fim é exclusiva.
 */
function blocoBloco(linhas: string[], id: string): { inicio: number; fim: number } {
  const inicioPadrao = new RegExp(`^\\s*-\\s*id:\\s*${id}\\s*$`);
  let inicio = -1;
  for (let i = 0; i < linhas.length; i++) {
    if (inicioPadrao.test(linhas[i] ?? "")) {
      inicio = i;
      break;
    }
  }
  if (inicio < 0) return { inicio: -1, fim: -1 };
  let fim = linhas.length;
  for (let i = inicio + 1; i < linhas.length; i++) {
    if (/^\s*-\s*id:\s*\S+/.test(linhas[i] ?? "")) {
      fim = i;
      break;
    }
  }
  return { inicio, fim };
}

/** Índice da primeira linha casando com o campo no intervalo [inicio, fim), -1 se não achar. */
function linhaDoCampo(linhas: string[], campo: string, inicio: number, fim: number): number {
  const campoPadrao = new RegExp(`^\\s*${campo}\\s*:`);
  for (let i = inicio; i < fim; i++) {
    if (campoPadrao.test(linhas[i] ?? "")) return i;
  }
  return -1;
}

/**
 * Comentário do campo: a linha imediatamente acima (o "logo acima" da issue) e o
 * trecho depois do "#" da própria linha do campo, se houver. Uma linha só, para
 * o comentário de um campo não vazar PENDENTE do campo vizinho.
 */
function comentarioAcima(linhas: string[], linha: number): string {
  const partes: string[] = [];
  if (linha > 0) partes.push(linhas[linha - 1] ?? "");
  const propria = linhas[linha] ?? "";
  const hash = propria.indexOf("#");
  if (hash >= 0) partes.push(propria.slice(hash));
  return partes.join("\n");
}

/**
 * Comentário em janela maior (até 3 linhas acima + a própria linha): usado no
 * `jobs`, cujo PENDENTE pode estar numa explanatory de duas linhas.
 */
function comentarioLargo(linhas: string[], linha: number): string {
  const partes: string[] = [];
  for (let i = Math.max(0, linha - 3); i <= linha; i++) {
    const atual = linhas[i] ?? "";
    const hash = atual.indexOf("#");
    if (hash >= 0) partes.push(atual.slice(hash));
  }
  return partes.join("\n");
}

/** Extrai o número da linha "campo: valor # comentário" (ignora o comentário). */
function valorNumerico(linhas: string[], linha: number): number | undefined {
  const texto = linhas[linha] ?? "";
  const depoisDoisPontos = texto.split(":").slice(1).join(":");
  const antesDoHash = depoisDoisPontos.split("#")[0] ?? "";
  const limpo = antesDoHash.trim().split(/\s+/)[0] ?? "";
  if (limpo === "") return undefined;
  const numero = Number(limpo);
  return Number.isNaN(numero) ? undefined : numero;
}

describe("issue #162: dinheiro e prazo de escola, ubs e hospital têm fonte", () => {
  it("nenhum valor de dinheiro ou prazo de saude fica PENDENTE", () => {
    const linhas = lerLinhas();
    const problemas: string[] = [];
    // Para cada bloco e cada campo de dinheiro/prazo, cobra linha existente sem PENDENTE no comentário acima.
    for (const bloco of BLOCOS) {
      const { inicio, fim } = blocoBloco(linhas, bloco);
      if (inicio < 0) {
        problemas.push(`data/buildings.yaml não tem o bloco com id "${bloco}"`);
        continue;
      }
      for (const campo of CAMPOS_POR_BLOCO[bloco] ?? []) {
        if (!(VALORES_TOCADOS as readonly string[]).includes(`${bloco}.${campo}`)) continue;
        const linha = linhaDoCampo(linhas, campo, inicio, fim);
        if (linha < 0) {
          problemas.push(
            `data/buildings.yaml: o bloco "${bloco}" não tem o campo "${campo}" (esperado entre as linhas ${inicio + 1} e ${fim})`,
          );
          continue;
        }
        const comentario = comentarioAcima(linhas, linha);
        if (comentario.includes("PENDENTE")) {
          problemas.push(
            `data/buildings.yaml: o campo "${bloco}.${campo}" (linha ${linha + 1}) ainda está PENDENTE, ` +
              `trecho encontrado: "${comentario.trim()}"`,
          );
        }
      }
    }
    expect(problemas, `valores com PENDENTE: ${problemas.join("; ")}`).toEqual([]);
  });

  it("cada valor tem link de fonte e a conta", () => {
    const linhas = lerLinhas();
    const problemas: string[] = [];
    const linkPadrao = /https?:\/\/\S+/;
    // Conta que liga a fonte ao número: "A x B" (com x, × ou *) ou "A = N".
    const contaPadrao = /\d[\d.,]*\s*[x×*]\s*\d/;
    const igualPadrao = /=\s*[\d.]/;
    // Para cada bloco e cada campo de dinheiro/prazo, cobra URL + conta no comentário acima.
    for (const bloco of BLOCOS) {
      const { inicio, fim } = blocoBloco(linhas, bloco);
      if (inicio < 0) {
        problemas.push(`data/buildings.yaml não tem o bloco com id "${bloco}"`);
        continue;
      }
      for (const campo of CAMPOS_POR_BLOCO[bloco] ?? []) {
        if (!(VALORES_TOCADOS as readonly string[]).includes(`${bloco}.${campo}`)) continue;
        const linha = linhaDoCampo(linhas, campo, inicio, fim);
        if (linha < 0) {
          problemas.push(
            `data/buildings.yaml: o bloco "${bloco}" não tem o campo "${campo}" (sem linha, sem fonte para conferir)`,
          );
          continue;
        }
        const comentario = comentarioAcima(linhas, linha);
        const temLink = linkPadrao.test(comentario);
        const temConta = contaPadrao.test(comentario) || igualPadrao.test(comentario);
        if (!temLink || !temConta) {
          const faltando = !temLink && !temConta ? "link e conta" : !temLink ? "link" : "conta";
          problemas.push(
            `data/buildings.yaml: o campo "${bloco}.${campo}" (linha ${linha + 1}) não tem ${faltando} no comentário, ` +
              `trecho encontrado: "${comentario.trim()}"`,
          );
        }
      }
    }
    expect(problemas, `faltou fonte ou conta: ${problemas.join("; ")}`).toEqual([]);
  });

  it("os jobs dos tres blocos continuam com PENDENTE", () => {
    const linhas = lerLinhas();
    const problemas: string[] = [];
    // Os jobs ficam para outra tarefa: cada bloco precisa continuar com PENDENTE no comentário acima.
    for (const bloco of BLOCOS) {
      const { inicio, fim } = blocoBloco(linhas, bloco);
      if (inicio < 0) {
        problemas.push(`data/buildings.yaml não tem o bloco com id "${bloco}"`);
        continue;
      }
      const linha = linhaDoCampo(linhas, "jobs", inicio, fim);
      if (linha < 0) {
        problemas.push(`data/buildings.yaml: o bloco "${bloco}" não tem o campo "jobs"`);
        continue;
      }
      const comentario = comentarioLargo(linhas, linha);
      if (!comentario.includes("PENDENTE")) {
        problemas.push(
          `data/buildings.yaml: o campo "${bloco}.jobs" (linha ${linha + 1}) deveria continuar PENDENTE ` +
            `(equipe fica para outra tarefa), trecho encontrado: "${comentario.trim()}"`,
        );
      }
    }
    expect(problemas, `jobs mexeu em equipe: ${problemas.join("; ")}`).toEqual([]);
  });

  it("os valores continuam sendo numeros positivos", () => {
    const linhas = lerLinhas();
    const problemas: string[] = [];
    // Dinheiro e prazo precisam ser inteiros positivos (o jogo não aceita zero, negativo nem quebrado).
    for (const bloco of BLOCOS) {
      const { inicio, fim } = blocoBloco(linhas, bloco);
      if (inicio < 0) {
        problemas.push(`data/buildings.yaml não tem o bloco com id "${bloco}"`);
        continue;
      }
      for (const campo of CAMPOS_POR_BLOCO[bloco] ?? []) {
        const linha = linhaDoCampo(linhas, campo, inicio, fim);
        if (linha < 0) continue;
        const valor = valorNumerico(linhas, linha);
        if (valor === undefined || !Number.isInteger(valor) || valor <= 0) {
          const achado = (linhas[linha] ?? "").trim();
          problemas.push(
            `data/buildings.yaml: o campo "${bloco}.${campo}" (linha ${linha + 1}) deveria ser inteiro positivo, ` +
              `valor encontrado: "${achado}"`,
          );
        }
      }
    }
    expect(problemas, `valores inválidos: ${problemas.join("; ")}`).toEqual([]);
  });
});
