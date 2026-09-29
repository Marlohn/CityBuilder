/** Lê config/, data/ e scenarios/ do disco (só no Node). */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenario, type Scenario } from "@city/bots";
import { type GameConfig, type GameData, parseGameConfig, parseGameData } from "@city/sim";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function readDir(dir: string, exts: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(join(ROOT, dir))) {
    if (exts.some((e) => f.endsWith(e))) out[f] = readFileSync(join(ROOT, dir, f), "utf8");
  }
  return out;
}

export function configTexts(): Record<string, string> {
  return readDir("config", [".yaml"]);
}

export function dataTexts(): Record<string, string> {
  return readDir("data", [".yaml", ".json"]);
}

export function loadConfigAndData(overrides?: unknown): { config: GameConfig; data: GameData } {
  const config = parseGameConfig(configTexts(), overrides);
  const data = parseGameData(dataTexts(), config);
  return { config, data };
}

export function loadScenario(name: string): Scenario {
  return parseScenario(readFileSync(join(ROOT, "scenarios", `${name}.yaml`), "utf8"));
}

export function listScenarios(): string[] {
  return readdirSync(join(ROOT, "scenarios"))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""));
}
