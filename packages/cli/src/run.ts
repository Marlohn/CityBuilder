/**
 * Roda um jogo sem tela: aplica os comandos do cenário nos dias certos e avança o tempo.
 * Usado pela CLI e pelos testes (mesmo código = mesmo resultado).
 */
import { type Scenario, scenarioCommands } from "@city/bots";
import type { Command, TimedCommand } from "@city/contract";
import { createGame, type Game, type GameConfig, type GameData } from "@city/sim";

export interface RunOptions {
  config: GameConfig;
  data: GameData;
  seed: string;
  days: number;
  scenario?: Scenario;
  /** Comandos já com tick (replay). */
  timed?: TimedCommand[];
  /** Chamado uma vez por dia do jogo. */
  onDay?: (game: Game, day: number) => void;
}

export function runGame(opts: RunOptions): Game {
  const game = createGame({ config: opts.config, data: opts.data, seed: opts.seed });
  const { sim } = game;
  const tpd = sim.clock.ticksPerDay;
  const startTick = sim.clock.tick;
  // Agenda por tick: cenários usam dias (a partir do começo), replays usam o tick exato.
  const byTick = new Map<number, Command[]>();
  const push = (tick: number, c: Command) => {
    const list = byTick.get(tick) ?? [];
    list.push(c);
    byTick.set(tick, list);
  };
  if (opts.scenario)
    for (const s of scenarioCommands(opts.scenario)) push(startTick + Math.round(s.day * tpd), s.command);
  for (const t of opts.timed ?? []) push(t.tick, t.command);
  const endTick = startTick + Math.round(opts.days * tpd);
  let lastDay = sim.clock.day;
  while (sim.clock.tick < endTick) {
    const due = byTick.get(sim.clock.tick);
    if (due) for (const c of due) sim.enqueue(c);
    sim.step(1);
    if (sim.clock.day !== lastDay) {
      lastDay = sim.clock.day;
      opts.onDay?.(game, lastDay);
    }
  }
  return game;
}
