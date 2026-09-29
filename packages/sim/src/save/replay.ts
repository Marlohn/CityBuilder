/**
 * Save e relatório de bug.
 *
 * Como a simulação é reproduzível (mesma semente + mesmos comandos = mesma cidade), o save guarda só:
 * a semente, as mudanças de config, os comandos com o tick e o tick final. Abrir o save refaz a cidade.
 * Isso é pequeno e 100% fiel. (Limitação conhecida: abrir um jogo muito longo leva alguns segundos.)
 */
import type { TimedCommand } from "@city/contract";
import { checkInvariants } from "../debug/invariants";
import type { Game } from "../game";
import { statsView } from "../view/stats";

export const REPLAY_FORMAT = "citybuilder-replay";
export const REPLAY_VERSION = 1;

export interface Replay {
  format: typeof REPLAY_FORMAT;
  version: number;
  seed: string;
  /** Mudanças na config usadas neste jogo (ex.: modo livre). */
  overrides?: unknown;
  /** Tick em que o save foi feito. */
  tick: number;
  commands: TimedCommand[];
}

export interface BugReport extends Replay {
  note: string;
  createdAt: string;
  stats: ReturnType<typeof statsView>;
  invariantViolations: string[];
  recentLogs: unknown[];
  howToReproduce: string;
}

export function makeReplay(game: Game, overrides?: unknown): Replay {
  return {
    format: REPLAY_FORMAT,
    version: REPLAY_VERSION,
    seed: game.sim.seed,
    ...(overrides !== undefined ? { overrides } : {}),
    tick: game.sim.clock.tick,
    commands: [...game.sim.commandLog],
  };
}

export function makeBugReport(game: Game, note: string, overrides?: unknown): BugReport {
  return {
    ...makeReplay(game, overrides),
    note,
    createdAt: new Date().toISOString(),
    stats: statsView(game),
    invariantViolations: checkInvariants(game.city, 50),
    recentLogs: game.sim.log.recent().slice(-300),
    howToReproduce: "Salve este arquivo como bug.json e rode: npm run sim -- replay bug.json",
  };
}

export function parseReplay(text: string): Replay {
  const r = JSON.parse(text) as Partial<Replay>;
  if (r.format !== REPLAY_FORMAT) throw new Error("arquivo não é um save do CityBuilder");
  if (r.version !== REPLAY_VERSION) throw new Error(`versão de save não suportada: ${r.version}`);
  if (typeof r.seed !== "string" || typeof r.tick !== "number" || !Array.isArray(r.commands)) {
    throw new Error("save incompleto");
  }
  return r as Replay;
}

/** Refaz o jogo até o tick do save (aplica cada comando no tick em que foi dado). */
export function replayInto(game: Game, replay: Replay, onProgress?: (fraction: number) => void) {
  const sim = game.sim;
  const byTick = new Map<number, TimedCommand["command"][]>();
  for (const c of replay.commands) {
    const list = byTick.get(c.tick) ?? [];
    list.push(c.command);
    byTick.set(c.tick, list);
  }
  const start = sim.clock.tick;
  const total = Math.max(1, replay.tick - start);
  while (sim.clock.tick < replay.tick) {
    const due = byTick.get(sim.clock.tick);
    if (due) for (const c of due) sim.enqueue(c);
    sim.step(1);
    if (onProgress && sim.clock.tick % 1440 === 0) onProgress((sim.clock.tick - start) / total);
  }
}
