/**
 * Issue #118 — dados do hospital: prédio `hospital` no catálogo e campos do hospital em `config/health.yaml`.
 *
 * A issue pede o prédio `hospital` (service health) em `data/buildings.yaml` e os campos
 * `hospitalBedsPer1000` (2.5 a 3, fonte Portaria GM/MS 1.101/2002), `hospitalMaxDistanceMeters` e
 * `hospitalMortalityReduction` em `config/health.yaml`, com o schema em `packages/sim/src/config/schema.ts`.
 *
 * Este teste trava os dados: catálogo, faixas da config, coerência dos leitos com a portaria e
 * fonte declarada de cada número novo. Semente/constantes fixas, sem relógio e sem `Math.random`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigAndData } from "@city/cli";
import type { GameConfig } from "@city/sim";
import { describe, expect, it } from "vitest";

/** Campos novos da issue #118, ainda ausentes no schema: acesso tolerante via tipo local. */
interface HealthWithHospital {
  hospitalBedsPer1000?: unknown;
  hospitalMaxDistanceMeters?: unknown;
  hospitalMortalityReduction?: unknown;
}

/** Cidade de referência da portaria: um hospital atende 30 mil a 40 mil habitantes. */
const MIN_CITY_POPULATION = 30000;
const MAX_CITY_POPULATION = 40000;

/** Campos novos de `config/health.yaml` cobrados pela issue #118. */
const HOSPITAL_HEALTH_FIELDS = [
  "hospitalBedsPer1000",
  "hospitalMaxDistanceMeters",
  "hospitalMortalityReduction",
] as const;

/** Números do hospital em `data/buildings.yaml` que precisam de fonte declarada. */
const HOSPITAL_NUMBER_FIELDS = ["patients", "jobs", "cost", "upkeepPerYear", "constructionMonths"] as const;

/** Raiz do repositório, resolvida a partir deste arquivo (tests/acceptance/ -> raiz). */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Lê um arquivo de config/dados do disco como texto. */
function readRepoText(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

/**
 * Diz se há comentário de fonte na mesma linha ou nas 2 linhas acima do campo.
 * Vale URL (http) ou termo de fonte já usado no projeto; PENDENTE conta como fonte
 * declarada, porque o padrão do projeto é marcar PENDENTE quando falta a fonte oficial.
 */
function hasSourceComment(lines: string[], fieldLine: number): boolean {
  const sourcePattern =
    /https?:\/\/|PENDENTE|FNDE|Fundeb|PNAB|SNIS|EPE|ANEEL|IBGE|Secovi|HCA|BMJ|Portaria|Minist[eé]rio|CNM|PAC|Lei/i;
  const start = Math.max(0, fieldLine - 2);
  for (let i = start; i <= fieldLine; i++) {
    const line = lines[i] ?? "";
    const hashIndex = line.indexOf("#");
    if (hashIndex >= 0 && sourcePattern.test(line.slice(hashIndex))) return true;
  }
  return false;
}

/** Acha a linha de um campo `nome:` dentro de um intervalo de linhas. */
function findFieldLine(lines: string[], field: string, from: number, to: number): number {
  const fieldPattern = new RegExp(`^\\s*${field}\\s*:`);
  for (let i = from; i < to; i++) {
    if (fieldPattern.test(lines[i] ?? "")) return i;
  }
  return -1;
}

describe("issue #118: dados do hospital", () => {
  it("a config e o catálogo carregam sem erro", () => {
    expect(
      () => loadConfigAndData(),
      `loadConfigAndData() lançou erro: a config ou o catálogo estão inválidos`,
    ).not.toThrow();
  });

  it("o catálogo tem o prédio hospital com serviço de saúde", () => {
    const { data } = loadConfigAndData();
    const hospital = data.buildings.find((building) => building.id === "hospital");
    expect(
      hospital !== undefined,
      `o catálogo (data/buildings.yaml) deveria ter um prédio com id "hospital", ` +
        `mas só tem: ${data.buildings.map((building) => building.id).join(", ")}`,
    ).toBe(true);
    if (hospital === undefined) return;
    expect(
      hospital.service,
      `o hospital deveria ter service "health", mas tem ${String(hospital.service)}`,
    ).toBe("health");
    expect(
      hospital.nearWater,
      `o hospital deveria ter nearWater 0 (fica em qualquer lugar), mas tem ${hospital.nearWater}`,
    ).toBe(0);
    for (const size of [hospital.w, hospital.h] as const) {
      expect(
        Number.isInteger(size) && size > 0,
        `o hospital deveria ter w/h inteiros positivos, mas tem w=${hospital.w} h=${hospital.h}`,
      ).toBe(true);
    }
    const numbers: Array<[string, number]> = [
      ["patients", hospital.patients],
      ["jobs", hospital.jobs],
      ["cost", hospital.cost],
      ["upkeepPerYear", hospital.upkeepPerYear],
      ["constructionMonths", hospital.constructionMonths],
    ];
    for (const [name, value] of numbers) {
      expect(value > 0, `o hospital deveria ter ${name} positivo, mas tem ${value}`).toBe(true);
    }
    expect(
      hospital.models.length,
      `o hospital deveria ter pelo menos um modelo em models, mas tem ${hospital.models.length}`,
    ).toBeGreaterThanOrEqual(1);
  });

  it("a config de saúde traz os campos do hospital", () => {
    const { config } = loadConfigAndData();
    const health = config.health as GameConfig["health"] & HealthWithHospital;
    const beds = health.hospitalBedsPer1000;
    expect(
      typeof beds,
      `config.health deveria ter hospitalBedsPer1000 (leitos por mil habitantes), mas o campo não existe`,
    ).toBe("number");
    if (typeof beds !== "number") return;
    expect(
      beds >= 2.5 && beds <= 3,
      `hospitalBedsPer1000 deveria ficar entre 2.5 e 3 (Portaria GM/MS 1.101/2002), mas vale ${beds}`,
    ).toBe(true);
    const maxDistance = health.hospitalMaxDistanceMeters;
    expect(
      typeof maxDistance,
      `config.health deveria ter hospitalMaxDistanceMeters, mas o campo não existe`,
    ).toBe("number");
    if (typeof maxDistance !== "number") return;
    expect(maxDistance > 0, `hospitalMaxDistanceMeters deveria ser positivo, mas vale ${maxDistance}`).toBe(
      true,
    );
    const mortalityReduction = health.hospitalMortalityReduction;
    expect(
      typeof mortalityReduction,
      `config.health deveria ter hospitalMortalityReduction, mas o campo não existe`,
    ).toBe("number");
    if (typeof mortalityReduction !== "number") return;
    expect(
      mortalityReduction >= 0 && mortalityReduction <= 1,
      `hospitalMortalityReduction deveria ficar entre 0 e 1 (inclusive), mas vale ${mortalityReduction}`,
    ).toBe(true);
  });

  it("os leitos do hospital batem com a portaria", () => {
    const { config, data } = loadConfigAndData();
    const health = config.health as GameConfig["health"] & HealthWithHospital;
    const beds = health.hospitalBedsPer1000;
    expect(typeof beds, `sem hospitalBedsPer1000 na config não dá para conferir os leitos do hospital`).toBe(
      "number",
    );
    if (typeof beds !== "number") return;
    const hospital = data.buildings.find((building) => building.id === "hospital");
    expect(hospital !== undefined, `sem o prédio "hospital" no catálogo não dá para conferir os leitos`).toBe(
      true,
    );
    if (hospital === undefined) return;
    // Um hospital atende uma cidade de 30 mil a 40 mil habitantes: leitos esperados = taxa x população / 1000.
    const minExpected = (beds * MIN_CITY_POPULATION) / 1000;
    const maxExpected = (beds * MAX_CITY_POPULATION) / 1000;
    expect(
      hospital.patients >= minExpected && hospital.patients <= maxExpected,
      `o hospital tem ${hospital.patients} leitos (patients), mas pela taxa da config ` +
        `(${beds} leitos por mil habitantes, Portaria GM/MS 1.101/2002: 2.5 a 3) um hospital para ` +
        `${MIN_CITY_POPULATION} a ${MAX_CITY_POPULATION} habitantes deveria ter entre ` +
        `${minExpected} e ${maxExpected} leitos`,
    ).toBe(true);
  });

  it("todo número novo tem fonte no arquivo", () => {
    const missing: string[] = [];
    const healthText = readRepoText(join("config", "health.yaml"));
    const healthLines = healthText.split("\n");
    for (const field of HOSPITAL_HEALTH_FIELDS) {
      const line = findFieldLine(healthLines, field, 0, healthLines.length);
      if (line < 0) {
        missing.push(`config/health.yaml não tem o campo ${field}`);
      } else if (!hasSourceComment(healthLines, line)) {
        missing.push(
          `config/health.yaml: o campo ${field} (linha ${line + 1}) não tem comentário de fonte ` +
            `(URL http, termo de fonte do projeto ou PENDENTE) na mesma linha nem nas 2 acima`,
        );
      }
    }
    const buildingsText = readRepoText(join("data", "buildings.yaml"));
    const buildingLines = buildingsText.split("\n");
    const hospitalStart = buildingLines.findIndex((line) => /^\s*-\s*id:\s*hospital\s*$/.test(line));
    if (hospitalStart < 0) {
      missing.push(`data/buildings.yaml não tem o prédio com id "hospital"`);
    } else {
      let hospitalEnd = buildingLines.length;
      for (let i = hospitalStart + 1; i < buildingLines.length; i++) {
        if (/^\s*-\s*id:\s*\S+/.test(buildingLines[i] ?? "")) {
          hospitalEnd = i;
          break;
        }
      }
      for (const field of HOSPITAL_NUMBER_FIELDS) {
        const line = findFieldLine(buildingLines, field, hospitalStart, hospitalEnd);
        if (line < 0) {
          missing.push(`data/buildings.yaml: o hospital não tem o campo ${field}`);
        } else if (!hasSourceComment(buildingLines, line)) {
          missing.push(
            `data/buildings.yaml: o campo ${field} do hospital (linha ${line + 1}) não tem ` +
              `comentário de fonte (URL http, termo de fonte do projeto ou PENDENTE) na mesma ` +
              `linha nem nas 2 acima`,
          );
        }
      }
    }
    expect(missing, `faltou fonte declarada para número novo da issue #118: ${missing.join("; ")}`).toEqual(
      [],
    );
  });
});
