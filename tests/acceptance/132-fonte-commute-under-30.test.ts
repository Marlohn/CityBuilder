/**
 * Issue #132 - fonte real para commuteUnder30 (trabalhadores com trajeto de até 30 min).
 *
 * O item commuteUnder30 do placar de realismo (config/realism.yaml) cita só
 * "Censo 2022: 67%", sem link e sem a faixa por porte de cidade que a issue pede.
 *
 * Teste só de dados: lê config/realism.yaml do disco (cwd = raiz do repo),
 * parseia com yaml e compara com a config carregada por loadConfigAndData.
 * Sem simulação, sem semente. Um it por critério do "tá pronto quando".
 */
import { readFileSync } from "node:fs";
import { loadConfigAndData } from "@city/cli";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

/** Item da faixa de realismo em config/realism.yaml. */
interface ItemRealismo {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  source: string;
  minPopulation?: number;
}

/** Regex do link direto para dado do IBGE (api de dados ou portal). */
const IBGE_URL = /https?:\/\/(servicodados\.)?ibge\.gov\.br\/\S+/;

/** Extrai os percentuais citados no texto ("67,3%" vira 67.3). */
function extraiPercentuais(texto: string): number[] {
  const achados = texto.match(/(\d+(?:[.,]\d+)?)\s*%/g) ?? [];
  return achados.map((m) => Number.parseFloat(m.replace("%", "").trim().replace(",", ".")));
}

/** Lê os itens de realismo do YAML do disco (cwd = raiz do repo). */
function itensDoDisco(): ItemRealismo[] {
  const texto = readFileSync("config/realism.yaml", "utf8");
  const lido = parseYaml(texto) as { realism?: { items?: ItemRealismo[] } };
  const itens = lido?.realism?.items;
  expect(Array.isArray(itens), "config/realism.yaml deveria ter realism.items como lista").toBe(true);
  return itens as ItemRealismo[];
}

/** Acha o item commuteUnder30 na lista do disco. */
function achaCommuteUnder30(itens: ItemRealismo[]): ItemRealismo | undefined {
  return itens.find((item) => item.id === "commuteUnder30");
}

/** Linha do YAML do disco com o item commuteUnder30 (o bloco do item). */
function linhaDoItemNoDisco(): string {
  const texto = readFileSync("config/realism.yaml", "utf8");
  return texto.split("\n").find((l) => l.includes("commuteUnder30")) ?? "";
}

describe("issue #132: fonte real para commuteUnder30 (Censo 2022 por porte de cidade)", () => {
  it("source do commuteUnder30 cita o IBGE com link direto e a faixa por porte de cidade", () => {
    const item = achaCommuteUnder30(itensDoDisco());
    expect(item, 'config/realism.yaml deveria ter um item com id "commuteUnder30"').toBeDefined();
    if (item === undefined) return;
    const source = item.source ?? "";
    expect(
      IBGE_URL.test(source),
      `o source do commuteUnder30 deveria ter link direto para dado do IBGE ` +
        `(https://servicodados.ibge.gov.br/... ou https://www.ibge.gov.br/...), mas vale: ${source}`,
    ).toBe(true);
    expect(
      /Censo/i.test(source),
      `o source do commuteUnder30 deveria citar o Censo 2022 do IBGE, mas vale: ${source}`,
    ).toBe(true);
    expect(
      /porte/i.test(source),
      `o source do commuteUnder30 deveria trazer a faixa por porte de cidade, mas vale: ${source}`,
    ).toBe(true);
    expect(
      extraiPercentuais(source).length >= 2,
      `o source do commuteUnder30 deveria trazer pelo menos dois percentuais (faixa por porte de cidade), ` +
        `mas vale: ${source}`,
    ).toBe(true);
    expect(
      !linhaDoItemNoDisco().includes("PENDENTE"),
      "o bloco do item commuteUnder30 não deveria conter PENDENTE",
    ).toBe(true);
  });

  it("min e max cobrem todos os percentuais citados na fonte", () => {
    const item = achaCommuteUnder30(itensDoDisco());
    expect(item, 'config/realism.yaml deveria ter um item com id "commuteUnder30"').toBeDefined();
    if (item === undefined) return;
    expect(
      item.min < item.max,
      `o commuteUnder30 deveria ter min < max, mas vale min=${item.min} max=${item.max}`,
    ).toBe(true);
    const citados = extraiPercentuais(item.source ?? "");
    expect(
      citados.length >= 2,
      `o source do commuteUnder30 deveria trazer a faixa por porte de cidade (pelo menos dois ` +
        `percentuais) para conferir min/max, mas vale: ${item.source}`,
    ).toBe(true);
    for (const valor of citados) {
      expect(
        valor >= item.min && valor <= item.max,
        `o percentual citado ${valor}% deveria ficar entre min=${item.min} e max=${item.max} ` +
          `(source: ${item.source})`,
      ).toBe(true);
    }
    const { config } = loadConfigAndData();
    const carregado = (config.realism.items as ItemRealismo[]).find((i) => i.id === "commuteUnder30");
    expect(
      carregado,
      'a config carregada deveria ter o item "commuteUnder30" em realism.items',
    ).toBeDefined();
    if (carregado === undefined) return;
    expect(
      carregado.min,
      `o min carregado (${carregado.min}) deveria bater com o YAML do disco (${item.min})`,
    ).toBe(item.min);
    expect(
      carregado.max,
      `o max carregado (${carregado.max}) deveria bater com o YAML do disco (${item.max})`,
    ).toBe(item.max);
    expect(carregado.source, "o source carregado deveria bater com o YAML do disco").toBe(item.source);
  });

  it("a config e os dados carregam sem erro (npm run check passa)", () => {
    expect(
      () => loadConfigAndData(),
      "loadConfigAndData() lançou erro: a config ou o catálogo estão inválidos",
    ).not.toThrow();
  });
});
