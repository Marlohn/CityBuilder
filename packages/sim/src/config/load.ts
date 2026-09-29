/**
 * Junta e valida a configuração. Não lê arquivos: quem chama (CLI, navegador) passa os textos.
 * Assim o motor funciona igual no Node e no navegador.
 */
import { parse as parseYaml } from "yaml";
import type { ZodError } from "zod";
import {
  BuildingCatalogSchema,
  type BuildingType,
  type FertilityTable,
  FertilityTableSchema,
  type GameConfig,
  GameConfigSchema,
  type MortalityTable,
  MortalityTableSchema,
  type NamesData,
  NamesSchema,
} from "./schema";

export interface GameData {
  buildings: BuildingType[];
  mortality: MortalityTable;
  fertility: FertilityTable;
  names: NamesData;
}

export class ConfigError extends Error {}

function formatZod(prefix: string, err: ZodError): string {
  return err.issues.map((i) => `${prefix}${i.path.join(".")}: ${i.message}`).join("\n");
}

/** Junta vários YAMLs (cada um com uma seção no topo) num objeto só e valida. */
export function parseGameConfig(texts: Record<string, string>, overrides?: unknown): GameConfig {
  const merged: Record<string, unknown> = {};
  for (const [file, text] of Object.entries(texts)) {
    const obj = parseYaml(text) as Record<string, unknown> | null;
    if (!obj || typeof obj !== "object") throw new ConfigError(`${file}: arquivo vazio ou inválido`);
    for (const [k, v] of Object.entries(obj)) {
      if (k in merged) throw new ConfigError(`${file}: seção "${k}" repetida em outro arquivo`);
      merged[k] = v;
    }
  }
  const withOverrides = overrides ? deepMerge(merged, overrides) : merged;
  const result = GameConfigSchema.safeParse(withOverrides);
  if (!result.success) throw new ConfigError(`Config inválida:\n${formatZod("config.", result.error)}`);
  return result.data;
}

/** Os textos de data/ indexados pelo nome do arquivo (ex: "buildings.yaml"). */
export function parseGameData(texts: Record<string, string>, config: GameConfig): GameData {
  const get = (name: string): string => {
    const t = texts[name];
    if (t === undefined) throw new ConfigError(`data/${name} não encontrado`);
    return t;
  };
  const catalog = BuildingCatalogSchema.safeParse(parseYaml(get("buildings.yaml")));
  if (!catalog.success) throw new ConfigError(formatZod("data/buildings.yaml: ", catalog.error));
  const ids = new Set<string>();
  for (const b of catalog.data.buildings) {
    if (ids.has(b.id)) throw new ConfigError(`data/buildings.yaml: id repetido "${b.id}"`);
    ids.add(b.id);
  }
  const mortality = MortalityTableSchema.safeParse(JSON.parse(get(config.lifecycle.mortalityTable)));
  if (!mortality.success)
    throw new ConfigError(formatZod(`data/${config.lifecycle.mortalityTable}: `, mortality.error));
  const fertility = FertilityTableSchema.safeParse(JSON.parse(get(config.lifecycle.fertilityTable)));
  if (!fertility.success)
    throw new ConfigError(formatZod(`data/${config.lifecycle.fertilityTable}: `, fertility.error));
  const names = NamesSchema.safeParse(JSON.parse(get("names.json")));
  if (!names.success) throw new ConfigError(formatZod("data/names.json: ", names.error));
  return {
    buildings: catalog.data.buildings,
    mortality: mortality.data,
    fertility: fertility.data,
    names: names.data,
  };
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (Array.isArray(over) || typeof over !== "object" || over === null) return over;
  // Tabela "número -> valor" (ex.: idade -> chance) é trocada inteira, não mesclada.
  const keys = Object.keys(over as Record<string, unknown>);
  if (keys.length > 0 && keys.every((k) => k.trim() !== "" && Number.isFinite(Number(k)))) return over;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return over;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    out[k] = deepMerge((base as Record<string, unknown>)[k], v);
  }
  return out;
}

/** Interpolação linear numa tabela "chave numérica -> valor" (fora das pontas usa a ponta). */
export function makeTableLookup(table: Record<string, number>): (x: number) => number {
  const pts = Object.entries(table)
    .map(([k, v]) => [Number(k), v] as const)
    .sort((a, b) => a[0] - b[0]);
  return (x: number) => {
    const first = pts[0]!;
    if (x <= first[0]) return first[1];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i]!;
      if (x <= x1) {
        const [x0, y0] = pts[i - 1]!;
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return pts[pts.length - 1]![1];
  };
}
