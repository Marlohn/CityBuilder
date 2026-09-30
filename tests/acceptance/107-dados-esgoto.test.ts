/**
 * Issue #107 - dados do esgoto: fracao na config e predio ETE no catalogo.
 *
 * A config ganha a fracao da agua consumida que volta como esgoto
 * (sewageShareOfConsumption 0.8) e a rede regional de esgoto (regionalSewage 4000),
 * sem o campo antigo personsPerHomeSewage. O schema passa a aceitar os dois campos
 * (com default para config sem utilities) e o servico sewage. O catalogo ganha a ETE.
 *
 * Teste so de dados: le a config e os dados reais do disco via loadConfigAndData
 * e confere os textos crus dos yamls. Nao roda simulacao, entao nao precisa de semente.
 * Um it por criterio do "ta pronto quando" da issue.
 */
import { readdirSync, readFileSync } from "node:fs";
import { loadConfigAndData } from "@city/cli";
import { type GameData, parseGameConfig, parseGameData } from "@city/sim";
import { describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const utilitiesYaml = readFileSync("config/utilities.yaml", "utf8");
const buildingsYaml = readFileSync("data/buildings.yaml", "utf8");

const { config, data } = loadConfigAndData();

/** Config como mapa para ler chaves novas sem amarrar o tipo do schema. */
function utilitiesComoMapa(): Record<string, unknown> {
  return config.utilities as unknown as Record<string, unknown>;
}

/** Predio ETE como mapa para comparar o service como string comum. */
function achaEte(): Record<string, unknown> | undefined {
  const achado = data.buildings.find((b) => b.id === "ete");
  return achado as unknown as Record<string, unknown> | undefined;
}

/** Trecho do yaml a partir de um marcador, ate o proximo predio ou fim. */
function trechoApos(texto: string, marcador: string, tamanho = 1500): string {
  const i = texto.indexOf(marcador);
  if (i < 0) return "";
  return texto.slice(i, i + tamanho);
}

/** Textos de config/ lidos do disco (cwd = raiz do repo). */
function configTextsDoDisco(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync("config")) {
    if (f.endsWith(".yaml")) out[f] = readFileSync(`config/${f}`, "utf8");
  }
  return out;
}

/** Textos de data/ lidos do disco (cwd = raiz do repo). */
function dataTextsDoDisco(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync("data")) {
    if (f.endsWith(".yaml") || f.endsWith(".json")) out[f] = readFileSync(`data/${f}`, "utf8");
  }
  return out;
}

describe("issue #107: dados do esgoto (fracao na config e predio ETE)", () => {
  it("config tem sewageShareOfConsumption valendo 0.8", () => {
    expect(
      utilitiesComoMapa().sewageShareOfConsumption,
      "utilities.sewageShareOfConsumption deveria ser 0.8 (fracao da agua que volta como esgoto)",
    ).toBe(0.8);
  });

  it("fracao de esgoto cita ABNT NBR 9649 / IBGE PNSB 2017 no comentario", () => {
    const trecho = trechoApos(utilitiesYaml, "sewageShareOfConsumption");
    expect(trecho.length > 0, "config/utilities.yaml deveria ter a chave sewageShareOfConsumption").toBe(
      true,
    );
    expect(
      trecho.includes("NBR 9649"),
      "comentario da sewageShareOfConsumption deveria citar a ABNT NBR 9649",
    ).toBe(true);
    expect(
      trecho.includes("PNSB"),
      "comentario da sewageShareOfConsumption deveria citar o IBGE PNSB 2017",
    ).toBe(true);
  });

  it("config tem regionalSewage valendo 4000 e nao tem personsPerHomeSewage", () => {
    expect(
      utilitiesComoMapa().regionalSewage,
      "utilities.regionalSewage deveria ser 4000 (rede regional de esgoto)",
    ).toBe(4000);
    expect(
      utilitiesYaml.includes("personsPerHomeSewage"),
      "config/utilities.yaml nao deveria ter personsPerHomeSewage",
    ).toBe(false);
    expect(
      "personsPerHomeSewage" in utilitiesComoMapa(),
      "utilities nao deveria ter personsPerHomeSewage",
    ).toBe(false);
  });

  it("schema aceita sewageShareOfConsumption e regionalSewage na config", () => {
    const texts = configTextsDoDisco();
    let lida: Record<string, unknown> | undefined;
    let erro: unknown;
    try {
      const cfg = parseGameConfig(texts, {
        utilities: { sewageShareOfConsumption: 0.5, regionalSewage: 1234 },
      });
      lida = cfg.utilities as unknown as Record<string, unknown>;
    } catch (e) {
      erro = e;
    }
    expect(
      erro,
      "parseGameConfig nao deveria lancar com sewageShareOfConsumption e regionalSewage",
    ).toBeUndefined();
    expect(lida?.sewageShareOfConsumption, "utilities.sewageShareOfConsumption deveria voltar 0.5").toBe(0.5);
    expect(lida?.regionalSewage, "utilities.regionalSewage deveria voltar 1234").toBe(1234);
  });

  it("config sem utilities ainda e valida e tem os dois campos por default", () => {
    const texts = configTextsDoDisco();
    delete texts["utilities.yaml"];
    let lida: Record<string, unknown> | undefined;
    let erro: unknown;
    try {
      const cfg = parseGameConfig(texts);
      lida = cfg.utilities as unknown as Record<string, unknown>;
    } catch (e) {
      erro = e;
    }
    expect(erro, "parseGameConfig nao deveria lancar sem a secao utilities").toBeUndefined();
    expect(
      typeof lida?.sewageShareOfConsumption,
      "utilities.sewageShareOfConsumption deveria ter default numerico",
    ).toBe("number");
    expect(
      (lida?.sewageShareOfConsumption as number) >= 0,
      "utilities.sewageShareOfConsumption default deveria ser >= 0",
    ).toBe(true);
    expect(typeof lida?.regionalSewage, "utilities.regionalSewage deveria ter default numerico").toBe(
      "number",
    );
    expect((lida?.regionalSewage as number) >= 0, "utilities.regionalSewage default deveria ser >= 0").toBe(
      true,
    );
  });

  it("schema aceita um predio de service sewage", () => {
    const cfg = parseGameConfig(configTextsDoDisco(), {
      utilities: { sewageShareOfConsumption: 0.5, regionalSewage: 1234 },
    });
    const texts = dataTextsDoDisco();
    const catalog = parseYaml(texts["buildings.yaml"] as string) as { buildings: unknown[] };
    catalog.buildings.push({
      id: "ete-teste",
      label: "E",
      service: "sewage",
      w: 1,
      h: 1,
      serves: 1,
      constructionMonths: 12,
      models: ["proc/eta"],
    });
    texts["buildings.yaml"] = stringifyYaml(catalog);
    let lidos: GameData | undefined;
    let erro: unknown;
    try {
      lidos = parseGameData(texts, cfg);
    } catch (e) {
      erro = e;
    }
    expect(erro, "parseGameData nao deveria lancar com um predio de service sewage").toBeUndefined();
    const achado = lidos?.buildings.find((b) => b.id === "ete-teste") as unknown as
      | Record<string, unknown>
      | undefined;
    expect(achado, 'o catalogo deveria ter o predio "ete-teste"').toBeDefined();
    expect(achado?.service, 'o predio "ete-teste" deveria ter service "sewage"').toBe("sewage");
  });

  it("catalogo tem a ETE com service sewage, label e tamanho da issue", () => {
    const ete = achaEte();
    expect(ete, 'data/buildings.yaml deveria ter um predio com id "ete"').toBeDefined();
    const e = ete as Record<string, unknown>;
    expect(String(e.service), 'a ETE deveria ter service "sewage"').toBe("sewage");
    expect(
      String(e.label).includes("tratamento de esgoto"),
      'a ETE deveria se chamar "Estacao de tratamento de esgoto"',
    ).toBe(true);
    expect(e.w, "a ETE deveria ter w 3").toBe(3);
    expect(e.h, "a ETE deveria ter h 3").toBe(3);
    expect(e.floors, "a ETE deveria ter floors 1").toBe(1);
    expect(e.nearWater, "a ETE deveria ter nearWater 3").toBe(3);
  });

  it("ETE tem serves, jobs, custo, obra e modelo da issue", () => {
    const ete = achaEte();
    expect(ete, 'data/buildings.yaml deveria ter um predio com id "ete"').toBeDefined();
    const e = ete as Record<string, unknown>;
    expect(
      typeof e.serves === "number" && (e.serves as number) > 0,
      "a ETE deveria ter serves maior que 0",
    ).toBe(true);
    expect(e.jobs, "a ETE deveria ter jobs 10").toBe(10);
    expect(e.cost, "a ETE deveria ter cost 25000000").toBe(25000000);
    expect(e.upkeepPerYear, "a ETE deveria ter upkeepPerYear 3000000").toBe(3000000);
    expect(e.constructionMonths, "a ETE deveria ter constructionMonths 24").toBe(24);
    const models = e.models as unknown;
    expect(
      Array.isArray(models) && (models as string[]).includes("proc/eta"),
      "a ETE deveria ter models contendo proc/eta",
    ).toBe(true);
  });

  it("numeros da ETE sem fonte oficial estao marcados PENDENTE", () => {
    const trecho = trechoApos(buildingsYaml, "id: ete");
    expect(trecho.length > 0, 'data/buildings.yaml deveria ter o bloco "id: ete"').toBe(true);
    expect(
      trecho.includes("PENDENTE"),
      "o bloco da ETE deveria marcar os numeros sem fonte oficial com PENDENTE",
    ).toBe(true);
  });
});
