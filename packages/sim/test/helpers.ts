/** Ajudantes de teste: carregam config/ e data/ do disco (só nos testes, o motor não usa fs). */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type GameData, parseGameConfig, parseGameData } from "../src/config/load";
import type { GameConfig } from "../src/config/schema";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function readDir(dir: string, exts: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(join(ROOT, dir))) {
    if (exts.some((e) => f.endsWith(e))) out[f] = readFileSync(join(ROOT, dir, f), "utf8");
  }
  return out;
}

export function loadDefaults(overrides?: unknown): { config: GameConfig; data: GameData } {
  const config = parseGameConfig(readDir("config", [".yaml"]), overrides);
  const data = parseGameData(readDir("data", [".yaml", ".json"]), config);
  return { config, data };
}
