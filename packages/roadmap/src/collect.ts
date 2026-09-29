/** Roda as cidades de teste e junta os sinais (usado por `npm run roadmap:signals`). Só no Node. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configTexts, loadConfigAndData, loadScenario, ROOT, runGame } from "@city/cli";
import type { Game } from "@city/sim";
import { parseReference, parseRoadmapConfig, type RoadmapConfig } from "./config";
import { averageMetrics, mergeRuns, metricsOf, pendingSignals, signalsFromRun } from "./signals";
import type { SignalsFile } from "./types";

export function loadRoadmapConfig(): RoadmapConfig {
  return parseRoadmapConfig(readFileSync(join(ROOT, "roadmap", "config.yaml"), "utf8"));
}

export function loadReference() {
  return parseReference(readFileSync(join(ROOT, "data", "reference", "cidade-real.yaml"), "utf8"));
}

export function collectSignals(
  cfg: RoadmapConfig,
  log: (msg: string) => void = () => {},
  now: Date = new Date(),
): SignalsFile {
  const reference = loadReference();
  const { config, data } = loadConfigAndData();
  const services = new Set<string>();
  for (const b of data.buildings) if (b.service) services.add(b.service);
  const games: { name: string; seed: string; days: number; game: Game }[] = [];
  for (const seed of cfg.evaluation.botSeeds) {
    log(`prefeito automático, semente "${seed}", ${cfg.evaluation.botDays} dias...`);
    games.push({
      name: `bot:${seed}`,
      seed,
      days: cfg.evaluation.botDays,
      game: runGame({ config, data, seed, days: cfg.evaluation.botDays, bot: true }),
    });
  }
  const sc = cfg.evaluation.scenario;
  log(`cenário "${sc}", ${cfg.evaluation.scenarioDays} dias...`);
  games.push({
    name: `cenario:${sc}`,
    seed: sc,
    days: cfg.evaluation.scenarioDays,
    game: runGame({ config, data, seed: sc, days: cfg.evaluation.scenarioDays, scenario: loadScenario(sc) }),
  });
  const metrics = averageMetrics(games.map((g) => metricsOf(g.game)));
  const signals = mergeRuns(games.map((g) => signalsFromRun(g.game, cfg, reference, services)));
  signals.push(...pendingSignals(configTexts(), Math.round(metrics.population ?? 0)));
  return {
    generatedAt: now.toISOString(),
    runs: games.map((g) => ({
      name: g.name,
      seed: g.seed,
      days: g.days,
      population: metricsOf(g.game).population ?? 0,
    })),
    metrics,
    signals,
  };
}
