/**
 * Roda um jogo sem tela: aplica os comandos do cenário nos dias certos e avança o tempo.
 * Usado pela CLI e pelos testes (mesmo código = mesmo resultado).
 */
import { AutoMayor, DEFAULT_MAYOR, type Scenario, scenarioCommands } from "@city/bots";
import type { Command, TimedCommand } from "@city/contract";
import { type DirectorResult, decide, type LlmClient } from "@city/director";
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
  /** Liga o prefeito automático (constrói a cidade sozinho). */
  bot?: boolean;
  /** Para antes do fim quando devolver true (checado uma vez por dia). */
  stopWhen?: (game: Game) => boolean;
}

/** Um jogo em andamento, avançado dia a dia (permite parar entre os dias, ex.: para esperar a diretora). */
export interface Run {
  game: Game;
  /** Avança até o próximo dia. Devolve false quando acabou (fim dos dias ou stopWhen). */
  nextDay(): boolean;
}

export function createRun(opts: RunOptions): Run {
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
  let done = false;
  const mayor = opts.bot
    ? new AutoMayor(game, opts.seed, { ...DEFAULT_MAYOR, ...(opts.scenario?.bot ?? {}) })
    : null;
  return {
    game,
    nextDay() {
      while (!done && sim.clock.tick < endTick) {
        mayor?.update();
        const due = byTick.get(sim.clock.tick);
        if (due) for (const c of due) sim.enqueue(c);
        sim.step(1);
        if (sim.clock.day !== lastDay) {
          lastDay = sim.clock.day;
          opts.onDay?.(game, lastDay);
          if (opts.stopWhen?.(game)) done = true;
          return !done && sim.clock.tick < endTick;
        }
      }
      done = true;
      return false;
    },
  };
}

export function runGame(opts: RunOptions): Game {
  const run = createRun(opts);
  while (run.nextDay()) {}
  return run.game;
}

/**
 * Igual ao runGame, mas com a diretora (IA opcional): a cada `director.everyDays` dias o jogo para,
 * pergunta ao LLM e aplica os ajustes como comandos (entram no save/replay).
 */
export async function runGameDirected(
  opts: RunOptions & { client: LlmClient; onDecision?: (day: number, r: DirectorResult) => void },
): Promise<Game> {
  const run = createRun(opts);
  const { sim } = run.game;
  const every = sim.config.director.everyDays;
  let nextDay = sim.clock.day + every;
  while (run.nextDay()) {
    if (sim.clock.day < nextDay) continue;
    nextDay = sim.clock.day + every;
    const r = await decide(run.game, opts.client);
    for (const c of r.commands) sim.enqueue(c);
    sim.log.info("director", "decision", {
      reason: r.headline || "sem ajuste",
      data: { commands: r.commands, rejected: r.rejected },
    });
    opts.onDecision?.(sim.clock.day, r);
  }
  return run.game;
}
