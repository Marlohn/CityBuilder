/** Roda as cidades de teste e junta os sinais (usado por `npm run roadmap:signals`). Só no Node. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configTexts, loadConfigAndData, loadScenario, ROOT, runGame } from "@city/cli";
import type { Game } from "@city/sim";
import { parseReference, parseRoadmapConfig, type RoadmapConfig } from "./config";
import {
  aggregateInfantMortalitySignal,
  averageMetrics,
  mergeRuns,
  metricsOf,
  pendingSignals,
  signalsFromRun,
} from "./signals";
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
  const mid = new Map<string, number>();
  const bots = [
    ...cfg.evaluation.botSeeds.map((seed) => ({ seed, sandbox: false })),
    ...cfg.evaluation.sandboxSeeds.map((seed) => ({ seed, sandbox: true })),
  ];
  for (const { seed, sandbox } of bots) {
    const name = `${sandbox ? "livre" : "bot"}:${seed}`;
    const days = cfg.evaluation.botDays;
    log(`prefeito automático${sandbox ? " (modo livre)" : ""}, semente "${seed}", ${days} dias...`);
    const cd = sandbox ? loadConfigAndData({ economy: { mode: "sandbox" } }) : { config, data };
    const game = runGame({
      ...cd,
      seed,
      days,
      bot: true,
      onDay: (g, d) => {
        if (d === Math.floor(days / 2)) mid.set(name, g.city.pop.aliveCount);
      },
    });
    games.push({ name, seed, days, game });
  }
  const sc = cfg.evaluation.scenario;
  log(`cenário "${sc}", ${cfg.evaluation.scenarioDays} dias...`);
  games.push({
    name: `cenario:${sc}`,
    seed: sc,
    days: cfg.evaluation.scenarioDays,
    game: runGame({ config, data, seed: sc, days: cfg.evaluation.scenarioDays, scenario: loadScenario(sc) }),
  });
  const gameMetrics = games.map((g) => metricsOf(g.game));
  const metrics = averageMetrics(gameMetrics);
  const signals = mergeRuns(
    games.map((g) => signalsFromRun(g.game, cfg, reference, services, mid.get(g.name))),
  ).filter((s) => s.id !== "realismo:infantMortality");
  const infantRange = config.realism.items.find((item) => item.id === "infantMortality");
  if (infantRange) {
    const infant = aggregateInfantMortalitySignal(
      games.map((g, i) => {
        const w = g.game.demo.window();
        return {
          births: w.births,
          infantDeaths: w.infantDeaths,
          population: gameMetrics[i]?.population ?? 0,
        };
      }),
      infantRange,
      config.realism.minSamples.births,
    );
    if (infant) signals.push(infant);
  }
  signals.sort((a, b) => a.id.localeCompare(b.id));
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
