/**
 * Issue #238 — internação e permanência: taxa de internação e tempo médio no `config/health.yaml`.
 *
 * A config ganha dois números novos na seção `health` (valores em ponto no YAML, vírgula no
 * comentário em português): `hospitalAdmissionRatePerYear` valendo 0,08 (meio do intervalo de
 * 7 a 9% da Portaria GM/MS 1.101/2002) e `hospitalAvgLengthOfStayDays` valendo 5,3 (ficha
 * técnica do indicador "Média de Permanência", DataSUS/ANS). O schema em
 * `packages/sim/src/config/schema.ts` passa a validar os dois (positivos, taxa até 1).
 *
 * Teste só de dados: lê o YAML do disco e valida via parseGameConfig, sem simulação, sem
 * semente, sem sorteio e sem relógio. Um it por critério do "tá pronto quando". Este teste
 * FALHA na main porque os dois campos ainda não existem na config nem no schema.
 */
import { readdirSync, readFileSync } from "node:fs";
import { ConfigError, parseGameConfig } from "@city/sim";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

/** Taxa de internação esperada (meio do intervalo de 7 a 9% da portaria). */
const ADMISSAO_ESPERADA = 0.08;
/** Tempo médio de permanência esperado (ficha técnica da Média de Permanência). */
const PERMANENCIA_ESPERADA = 5.3;

/** Texto cru de config/health.yaml lido do disco (cwd = raiz do repo). */
const healthYaml = readFileSync("config/health.yaml", "utf8");

/** Campos novos da issue #238, ainda ausentes no schema: acesso tolerante via tipo local. */
interface HealthComInternacao {
  hospitalAdmissionRatePerYear?: unknown;
  hospitalAvgLengthOfStayDays?: unknown;
}

/**
 * Lê a seção health do YAML do disco como mapa simples.
 */
function saudeDoDisco(): Record<string, unknown> {
  const doc = parseYaml(healthYaml) as { health?: Record<string, unknown> };
  return doc.health ?? {};
}

/**
 * Acha a linha de um campo `nome:` no texto do YAML.
 */
function achaLinhaDoCampo(linhas: string[], campo: string): number {
  const padrao = new RegExp(`^\\s*${campo}\\s*:`);
  for (let i = 0; i < linhas.length; i++) {
    if (padrao.test(linhas[i] ?? "")) return i;
  }
  return -1;
}

/**
 * Monta o bloco de comentário de um campo: a linha do campo mais as 4 linhas acima.
 */
function blocoDoCampo(linhas: string[], linhaCampo: number): string {
  if (linhaCampo < 0) return "";
  const inicio = linhaCampo - 4 >= 0 ? linhaCampo - 4 : 0;
  return linhas.slice(inicio, linhaCampo + 1).join("\n");
}

/**
 * Textos de config/ lidos do disco (cwd = raiz do repo), indexados pelo nome do arquivo,
 * como packages/sim/test/helpers.ts e packages/sim/src/config/load.ts fazem.
 */
function configTextsDoDisco(): Record<string, string> {
  const textos: Record<string, string> = {};
  for (const arquivo of readdirSync("config")) {
    if (arquivo.endsWith(".yaml")) textos[arquivo] = readFileSync(`config/${arquivo}`, "utf8");
  }
  return textos;
}

/**
 * Tenta rodar o parseGameConfig e devolve o erro lançado, se houver.
 */
function pegaErroDeConfig(textos: Record<string, string>, overrides?: unknown): unknown {
  try {
    parseGameConfig(textos, overrides);
  } catch (erro) {
    return erro;
  }
  return undefined;
}

describe("issue #238: internação e permanência no config/health.yaml", () => {
  it("config/health.yaml tem hospitalAdmissionRatePerYear 0.08 com fonte da Portaria GM/MS 1.101/2002", () => {
    const saude = saudeDoDisco();
    expect(
      saude.hospitalAdmissionRatePerYear,
      `config/health.yaml deveria ter hospitalAdmissionRatePerYear valendo 0.08 ` +
        `(meio do intervalo 7-9% da Portaria GM/MS 1.101/2002), mas o campo não existe`,
    ).toBe(ADMISSAO_ESPERADA);
    const linhas = healthYaml.split("\n");
    const linha = achaLinhaDoCampo(linhas, "hospitalAdmissionRatePerYear");
    expect(
      linha >= 0,
      `config/health.yaml deveria ter a linha "hospitalAdmissionRatePerYear:", mas não tem`,
    ).toBe(true);
    if (linha < 0) return;
    const bloco = blocoDoCampo(linhas, linha);
    expect(
      bloco.includes("Portaria GM/MS 1.101/2002"),
      `o bloco de hospitalAdmissionRatePerYear (linha ${linha + 1} e 4 acima) deveria citar ` +
        `"Portaria GM/MS 1.101/2002", mas vale: ${JSON.stringify(bloco)}`,
    ).toBe(true);
    expect(
      /https?:\/\//.test(bloco),
      `o bloco de hospitalAdmissionRatePerYear (linha ${linha + 1} e 4 acima) deveria ter um link ` +
        `http(s) para a portaria, mas vale: ${JSON.stringify(bloco)}`,
    ).toBe(true);
  });

  it("config/health.yaml tem hospitalAvgLengthOfStayDays 5.3 com fonte DataSUS/ANS da Média de Permanência", () => {
    const saude = saudeDoDisco();
    expect(
      saude.hospitalAvgLengthOfStayDays,
      `config/health.yaml deveria ter hospitalAvgLengthOfStayDays valendo 5.3 ` +
        `(ficha técnica da Média de Permanência, DataSUS/ANS), mas o campo não existe`,
    ).toBe(PERMANENCIA_ESPERADA);
    const linhas = healthYaml.split("\n");
    const linha = achaLinhaDoCampo(linhas, "hospitalAvgLengthOfStayDays");
    expect(
      linha >= 0,
      `config/health.yaml deveria ter a linha "hospitalAvgLengthOfStayDays:", mas não tem`,
    ).toBe(true);
    if (linha < 0) return;
    const bloco = blocoDoCampo(linhas, linha);
    expect(
      /DataSUS|ANS/.test(bloco),
      `o bloco de hospitalAvgLengthOfStayDays (linha ${linha + 1} e 4 acima) deveria citar ` +
        `DataSUS ou ANS, mas vale: ${JSON.stringify(bloco)}`,
    ).toBe(true);
    expect(
      /M[eé]dia de Perman[eê]ncia/i.test(bloco),
      `o bloco de hospitalAvgLengthOfStayDays (linha ${linha + 1} e 4 acima) deveria citar a ` +
        `ficha técnica do indicador "Média de Permanência", mas vale: ${JSON.stringify(bloco)}`,
    ).toBe(true);
    expect(
      /https?:\/\//.test(bloco),
      `o bloco de hospitalAvgLengthOfStayDays (linha ${linha + 1} e 4 acima) deveria ter um link ` +
        `http(s) para a ficha técnica, mas vale: ${JSON.stringify(bloco)}`,
    ).toBe(true);
  });

  it("schema valida os dois campos da internação (positivos e taxa até 1)", () => {
    const textos = configTextsDoDisco();
    let valida: { health: HealthComInternacao } | undefined;
    let erroValida: unknown;
    try {
      valida = parseGameConfig(textos) as unknown as { health: HealthComInternacao };
    } catch (erro) {
      erroValida = erro;
    }
    expect(
      erroValida,
      `parseGameConfig deveria aceitar a config real do disco (com os dois campos novos), ` +
        `mas lançou: ${String(erroValida)}`,
    ).toBeUndefined();
    if (valida === undefined) return;
    expect(
      valida.health.hospitalAdmissionRatePerYear,
      `a config válida deveria ter hospitalAdmissionRatePerYear 0.08, mas veio ` +
        `${String(valida.health.hospitalAdmissionRatePerYear)}`,
    ).toBe(ADMISSAO_ESPERADA);
    expect(
      valida.health.hospitalAvgLengthOfStayDays,
      `a config válida deveria ter hospitalAvgLengthOfStayDays 5.3, mas veio ` +
        `${String(valida.health.hospitalAvgLengthOfStayDays)}`,
    ).toBe(PERMANENCIA_ESPERADA);
    const erroTaxaAlta = pegaErroDeConfig(textos, { health: { hospitalAdmissionRatePerYear: 1.5 } });
    expect(
      erroTaxaAlta instanceof ConfigError,
      `parseGameConfig com hospitalAdmissionRatePerYear 1.5 deveria lançar ConfigError ` +
        `(taxa maior que 1), mas não lançou`,
    ).toBe(true);
    if (!(erroTaxaAlta instanceof ConfigError)) return;
    expect(
      erroTaxaAlta.message.includes("hospitalAdmissionRatePerYear"),
      `o erro da taxa 1.5 deveria citar o nome do campo "hospitalAdmissionRatePerYear", ` +
        `mas diz: ${JSON.stringify(erroTaxaAlta.message)}`,
    ).toBe(true);
    const erroTaxaZero = pegaErroDeConfig(textos, { health: { hospitalAdmissionRatePerYear: 0 } });
    expect(
      erroTaxaZero instanceof ConfigError,
      `parseGameConfig com hospitalAdmissionRatePerYear 0 deveria lançar ConfigError ` +
        `(o campo é positivo), mas não lançou`,
    ).toBe(true);
    if (!(erroTaxaZero instanceof ConfigError)) return;
    expect(
      erroTaxaZero.message.includes("hospitalAdmissionRatePerYear"),
      `o erro da taxa 0 deveria citar o nome do campo "hospitalAdmissionRatePerYear", ` +
        `mas diz: ${JSON.stringify(erroTaxaZero.message)}`,
    ).toBe(true);
    const erroPermanencia = pegaErroDeConfig(textos, { health: { hospitalAvgLengthOfStayDays: 0 } });
    expect(
      erroPermanencia instanceof ConfigError,
      `parseGameConfig com hospitalAvgLengthOfStayDays 0 deveria lançar ConfigError ` +
        `(o campo é positivo), mas não lançou`,
    ).toBe(true);
    if (!(erroPermanencia instanceof ConfigError)) return;
    expect(
      erroPermanencia.message.includes("hospitalAvgLengthOfStayDays"),
      `o erro da permanência 0 deveria citar o nome do campo "hospitalAvgLengthOfStayDays", ` +
        `mas diz: ${JSON.stringify(erroPermanencia.message)}`,
    ).toBe(true);
  });

  it("bloco dos dois números não tem PENDENTE", () => {
    const linhas = healthYaml.split("\n");
    for (const campo of ["hospitalAdmissionRatePerYear", "hospitalAvgLengthOfStayDays"] as const) {
      const linha = achaLinhaDoCampo(linhas, campo);
      expect(linha >= 0, `config/health.yaml deveria ter a linha "${campo}:", mas não tem`).toBe(true);
      if (linha < 0) continue;
      const bloco = blocoDoCampo(linhas, linha);
      expect(
        bloco.includes("PENDENTE"),
        `o bloco de ${campo} (linha ${linha + 1} e 4 acima) não deveria ter PENDENTE, ` +
          `mas vale: ${JSON.stringify(bloco)}`,
      ).toBe(false);
    }
  });
});
