/**
 * Issue #131 - fonte real para schoolEnrollment (crianças 6-17 na escola).
 *
 * O item schoolEnrollment do placar de uninsured (config/realism.yaml) ainda
 * diz "PENDENTE: taxa de escolarização (PNAD Educação)". A issue pede fonte
 * real da PNAD Educação do IBGE, com min e max condizendo com a fonte.
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

/** Extrai os percentuais citados no texto ("97,5%" vira 97.5). */
function extraiPercentuais(texto: string): number[] {
  const achados = texto.match(/(\d+(?:[.,]\d+)?)\s*%/g) ?? [];
  return achados.map((m) => Number.parseFloat(m.replace("%", "").trim().replace(",", ".")));
}

/** Extrai o primeiro ano de 4 dígitos citado no texto, se houver. */
function extraiAno(texto: string): number | undefined {
  const m = texto.match(/\b(19|20)\d{2}\b/);
  return m ? Number.parseInt(m[0], 10) : undefined;
}

/**
 * Lê os itens de realismo do YAML do disco (cwd = raiz do repo).
 * Falha com mensagem clara se o arquivo não tiver a forma esperada.
 */
function itensDoDisco(): ItemRealismo[] {
  const texto = readFileSync("config/realism.yaml", "utf8");
  const lido = parseYaml(texto) as { realism?: { items?: ItemRealismo[] } };
  const itens = lido?.realism?.items;
  expect(Array.isArray(itens), "config/realism.yaml deveria ter realism.items como lista").toBe(true);
  return itens as ItemRealismo[];
}

/** Acha o item schoolEnrollment na lista do disco. */
function achaSchoolEnrollment(itens: ItemRealismo[]): ItemRealismo | undefined {
  return itens.find((item) => item.id === "schoolEnrollment");
}

/** Linha do YAML do disco com o item schoolEnrollment (o bloco do item). */
function linhaDoItemNoDisco(): string {
  const texto = readFileSync("config/realism.yaml", "utf8");
  const linha = texto.split("\n").find((l) => l.includes("schoolEnrollment")) ?? "";
  return linha;
}

describe("issue #131: fonte real para schoolEnrollment (PNAD Educação)", () => {
  it("source do schoolEnrollment cita a PNAD Educação do IBGE com link direto", () => {
    const item = achaSchoolEnrollment(itensDoDisco());
    expect(item, 'config/realism.yaml deveria ter um item com id "schoolEnrollment"').toBeDefined();
    if (item === undefined) return;
    const source = item.source ?? "";
    expect(
      IBGE_URL.test(source) || source.includes("www.ibge.gov.br"),
      `o source do schoolEnrollment deveria ter link direto para dado do IBGE ` +
        `(https://servicodados.ibge.gov.br/... ou www.ibge.gov.br), mas vale: ${source}`,
    ).toBe(true);
    expect(
      /PNAD/i.test(source) && /Educa/i.test(source),
      `o source do schoolEnrollment deveria citar a "PNAD Educação", mas vale: ${source}`,
    ).toBe(true);
    expect(
      extraiAno(source) !== undefined,
      `o source do schoolEnrollment deveria citar um ano, mas vale: ${source}`,
    ).toBe(true);
    expect(
      extraiPercentuais(source).length > 0,
      `o source do schoolEnrollment deveria trazer um percentual (ex.: "97,5%"), mas vale: ${source}`,
    ).toBe(true);
    expect(
      !linhaDoItemNoDisco().includes("PENDENTE"),
      "o bloco do item schoolEnrollment não deveria mais conter PENDENTE",
    ).toBe(true);
  });

  it("percentual citado fica entre min e max, e a config carregada bate com o disco", () => {
    const item = achaSchoolEnrollment(itensDoDisco());
    expect(item, 'config/realism.yaml deveria ter um item com id "schoolEnrollment"').toBeDefined();
    if (item === undefined) return;
    expect(
      item.min < item.max,
      `o schoolEnrollment deveria ter min < max, mas vale min=${item.min} max=${item.max}`,
    ).toBe(true);
    const citados = extraiPercentuais(item.source ?? "");
    expect(
      citados.length > 0,
      `o source do schoolEnrollment deveria trazer um percentual para conferir com min/max, ` +
        `mas vale: ${item.source}`,
    ).toBe(true);
    for (const valor of citados) {
      expect(
        valor >= item.min && valor <= item.max,
        `o percentual citado ${valor}% deveria ficar entre min=${item.min} e max=${item.max} ` +
          `(source: ${item.source})`,
      ).toBe(true);
    }
    const { config } = loadConfigAndData();
    const carregado = (config.realism.items as ItemRealismo[]).find((i) => i.id === "schoolEnrollment");
    expect(
      carregado,
      'a config carregada deveria ter o item "schoolEnrollment" em realism.items',
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
    expect(carregado.source, `o source carregado deveria bater com o YAML do disco`).toBe(item.source);
  });

  it("a config e os dados carregam sem erro (npm run check passa)", () => {
    expect(
      () => loadConfigAndData(),
      "loadConfigAndData() lançou erro: a config ou o catálogo estão inválidos",
    ).not.toThrow();
  });
});
