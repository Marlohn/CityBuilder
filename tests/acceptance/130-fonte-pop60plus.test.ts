/**
 * Issue #130 - fonte real do pop60plus no placar de realismo.
 *
 * O item pop60plus (pessoas com 60 anos ou mais) em config/realism.yaml ainda
 * cita só "Censo 2022: 15,6%", com o comentário "PENDENTE: faixa por UF" acima.
 * A issue pede fonte real com link direto do IBGE e min/max condizendo com ela.
 *
 * Teste só de dados: lê o YAML do disco e a config carregada, sem simulação,
 * sem semente, sem sorteio e sem relógio. Um it por critério do "ta pronto quando".
 */
import { readdirSync, readFileSync } from "node:fs";
import { loadConfigAndData } from "@city/cli";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

/** Link direto para dado do IBGE (site ou API de dados). */
const LINK_IBGE = /https?:\/\/(servicodados\.)?ibge\.gov\.br\/\S+/;

/** Texto cru de config/realism.yaml lido do disco (cwd = raiz do repo). */
const realismYaml = readFileSync("config/realism.yaml", "utf8");

/** Item do placar de realismo como vem do YAML. */
interface ItemRealismo {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  source: string;
}

/** realism.items lido do disco via yaml. */
function itensDoDisco(): ItemRealismo[] {
  const doc = parseYaml(realismYaml) as { realism?: { items?: ItemRealismo[] } };
  return doc.realism?.items ?? [];
}

/** Acha o pop60plus no YAML do disco. */
function achaPop60plusDoDisco(): ItemRealismo | undefined {
  return itensDoDisco().find((item) => item.id === "pop60plus");
}

/** Bloco do pop60plus: a linha do item mais os comentários logo acima dele. */
function blocoPop60plus(): string {
  const linhas = realismYaml.split("\n");
  const indice = linhas.findIndex((linha) => linha.includes("pop60plus"));
  if (indice < 0) return "";
  const inicio = Math.max(0, indice - 4);
  return linhas.slice(inicio, indice + 1).join("\n");
}

/** Extrai o percentual nacional citado no source ("15,6%" ou "15.6%"). */
function percentualDoSource(source: string): number | undefined {
  const achado = source.match(/(\d+[.,]\d+)\s*%/);
  if (achado === null) return undefined;
  const cru = achado[1];
  if (cru === undefined) return undefined;
  return Number.parseFloat(cru.replace(",", "."));
}

describe("issue #130: fonte real do pop60plus no placar de realismo", () => {
  it("source do pop60plus tem link direto do IBGE, sem PENDENTE nem faixa por UF pendente", () => {
    const item = achaPop60plusDoDisco();
    expect(item, 'config/realism.yaml deveria ter um item com id "pop60plus"').toBeDefined();
    if (item === undefined) return;
    expect(
      LINK_IBGE.test(item.source),
      `o source do pop60plus deveria ter um link direto do IBGE (https://ibge.gov.br/... ou https://servicodados.ibge.gov.br/...), mas vale ${JSON.stringify(item.source)}`,
    ).toBe(true);
    expect(
      item.source.includes("PENDENTE"),
      `o source do pop60plus não deveria ter PENDENTE, mas vale ${JSON.stringify(item.source)}`,
    ).toBe(false);
  });

  it("min, max e source do pop60plus batem entre o YAML do disco e a config carregada, e o percentual citado fica na faixa", () => {
    const item = achaPop60plusDoDisco();
    expect(item, 'config/realism.yaml deveria ter um item com id "pop60plus"').toBeDefined();
    if (item === undefined) return;
    expect(
      item.source.includes("IBGE"),
      `o source do pop60plus deveria citar o IBGE com link direto para o dado, mas vale ${JSON.stringify(item.source)}`,
    ).toBe(true);
    expect(
      /censo 2022|proje[cç][aã]o/i.test(item.source),
      `o source do pop60plus deveria citar o ano/dado usado (Censo 2022 ou projeção do IBGE), mas vale ${JSON.stringify(item.source)}`,
    ).toBe(true);
    const percentual = percentualDoSource(item.source);
    expect(
      percentual,
      `o source do pop60plus deveria trazer o percentual nacional (ex.: "15,6%"), mas vale ${JSON.stringify(item.source)}`,
    ).toBeDefined();
    if (percentual === undefined) return;
    expect(item.min < item.max, `o pop60plus deveria ter min (${item.min}) menor que max (${item.max})`).toBe(
      true,
    );
    const carregado = loadConfigAndData().config.realism.items.find((item) => item.id === "pop60plus");
    expect(carregado, 'a config carregada deveria ter o item "pop60plus"').toBeDefined();
    if (carregado === undefined) return;
    expect(carregado.min, "o min carregado deveria bater com o YAML do disco").toBe(item.min);
    expect(carregado.max, "o max carregado deveria bater com o YAML do disco").toBe(item.max);
    expect(carregado.source, "o source carregado deveria bater com o YAML do disco").toBe(item.source);
    expect(
      percentual >= item.min && percentual <= item.max,
      `o percentual nacional citado (${percentual}%) deveria ficar entre min (${item.min}) e max (${item.max})`,
    ).toBe(true);
  });

  it("nenhuma linha do bloco do pop60plus mantém a marca PENDENTE", () => {
    const linhas = realismYaml.split("\n");
    const indice = linhas.findIndex((linha) => linha.includes("pop60plus"));
    expect(indice >= 0, 'config/realism.yaml deveria ter uma linha com "pop60plus"').toBe(true);
    expect(
      blocoPop60plus().includes("PENDENTE"),
      'o bloco do pop60plus (comentário ou source) não deveria manter PENDENTE; hoje o comentário diz "PENDENTE: faixa por UF"',
    ).toBe(false);
    const comPendencia = linhas.filter((linha) => linha.includes("pop60plus") && linha.includes("PENDENTE"));
    expect(
      comPendencia,
      `nenhuma linha falando de pop60plus deveria ter PENDENTE, mas tem: ${comPendencia.join(" | ")}`,
    ).toEqual([]);
  });
});
