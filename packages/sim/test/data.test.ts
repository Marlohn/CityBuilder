/**
 * Os dados do jogo precisam bater com as fontes oficiais. Se alguém mexer nos arquivos de data/,
 * estes testes mostram na hora se eles se afastaram da realidade.
 */
import { describe, expect, it } from "vitest";
import { ConfigError, parseGameConfig } from "../src/config/load";
import {
  fertilityShare,
  lifeExpectancy,
  meanAgeOfFertility,
  totalFertility,
} from "../src/demography/lifeTable";
import { loadDefaults, readDir } from "./helpers";

const { config, data } = loadDefaults();

describe("config padrão", () => {
  it("carrega e valida sem erro", () => {
    expect(config.world.width).toBe(256);
    expect(data.buildings.length).toBeGreaterThan(0);
  });

  it("recusa valor inválido com mensagem clara", () => {
    const texts = readDir("config", [".yaml"]);
    texts["world.yaml"] = "world:\n  width: -5\n  height: 256\n  tileMeters: 16\n  treeCoverage: 0.1\n";
    expect(() => parseGameConfig(texts)).toThrow(ConfigError);
    expect(() => parseGameConfig(texts)).toThrow(/world\.width/);
  });

  it("aceita sobrescrever valores (útil em testes e cenários)", () => {
    const c = parseGameConfig(readDir("config", [".yaml"]), { world: { width: 64 } });
    expect(c.world.width).toBe(64);
    expect(c.world.height).toBe(256);
  });
});

describe("mortalidade calibrada (IBGE 2023)", () => {
  const f = data.mortality.qxFemale;
  const m = data.mortality.qxMale;
  it("expectativa de vida ao nascer: 79,7 (M) e 73,1 (H)", () => {
    expect(lifeExpectancy(f)).toBeCloseTo(79.7, 1);
    expect(lifeExpectancy(m)).toBeCloseTo(73.1, 1);
  });
  it("expectativa aos 60 e aos 80 anos", () => {
    expect(lifeExpectancy(f, 60)).toBeCloseTo(24.0, 1);
    expect(lifeExpectancy(m, 60)).toBeCloseTo(20.7, 1);
    expect(lifeExpectancy(f, 80)).toBeCloseTo(9.4, 1);
    expect(lifeExpectancy(m, 80)).toBeCloseTo(8.3, 1);
  });
  it("mortalidade infantil: 11,4 e 13,5 por mil", () => {
    expect(f[0]).toBeCloseTo(0.0114, 4);
    expect(m[0]).toBeCloseTo(0.0135, 4);
  });
  it("risco cresce com a idade depois dos 30", () => {
    for (let a = 31; a < 100; a++) expect(f[a]!).toBeGreaterThanOrEqual(f[a - 1]!);
  });
});

describe("fecundidade calibrada (IBGE)", () => {
  const r = data.fertility.rates;
  const min = data.fertility.minAge;
  it("TFT 1,57 filho por mulher (2023)", () => expect(totalFertility(r)).toBeCloseTo(1.57, 2));
  it("idade média 28,1 anos (2022)", () => expect(meanAgeOfFertility(r, min)).toBeCloseTo(28.1, 1));
  it("25-29 anos é o maior grupo, com ~24,4%", () => {
    const s = fertilityShare(r, min, 25, 29);
    expect(s).toBeCloseTo(0.244, 2);
    for (const [a, b] of [
      [15, 19],
      [20, 24],
      [30, 34],
      [35, 39],
    ] as const) {
      expect(fertilityShare(r, min, a, b)).toBeLessThan(s);
    }
  });
});

describe("nomes (IBGE)", () => {
  it("tem nomes femininos, masculinos e sobrenomes com frequência", () => {
    expect(data.names.female[0]![0]).toBe("Maria");
    expect(data.names.male[0]![0]).toBe("José");
    expect(data.names.surnames[0]![0]).toBe("Silva");
  });
});

describe("sobrescrever config", () => {
  it("tabela número->valor é trocada inteira (não mesclada)", () => {
    const c = parseGameConfig(readDir("config", [".yaml"]), {
      lifecycle: { marriage: { hazardByAge: { "0": 0 } } },
    });
    expect(c.lifecycle.marriage.hazardByAge).toEqual({ "0": 0 });
  });
});
