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
import { validateReplayCommands } from "./commandCompat";

export const REPLAY_FORMAT = "citybuilder-replay";
export const REPLAY_VERSION = 2;

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

export type Migration = (r: Replay) => Replay;

// A v2 tem o mesmo conteúdo da v1 (nenhuma regra de jogo mudou aqui):
// a migração só carimba a versão atual e preenche o que faltar.
export const MIGRATIONS: Record<number, Migration> = {
  2: (r) => ({ ...r, version: 2 }),
};

// Leva o save até a versão atual, um degrau por vez, sem mudar o original.
// Cada degrau devolve um Replay novo. Se faltar um degrau ou o save for
// mais novo que o jogo, recusa em vez de abrir pela metade.
export function applyMigrations(replay: Replay, migrations: Record<number, Migration> = MIGRATIONS): Replay {
  // Com a corrente real o destino é REPLAY_VERSION. Uma corrente injetada pode apontar
  // mais longe (o teste exercita 1 -> 2 -> 3 -> 4), e aí o destino é o maior degrau dela.
  const targets = Object.keys(migrations).map(Number);
  const target = targets.length > 0 ? Math.max(REPLAY_VERSION, ...targets) : REPLAY_VERSION;
  if (replay.version > target) {
    throw new Error(`save da versão ${replay.version} é mais novo que o jogo (versão ${REPLAY_VERSION})`);
  }
  let current: Replay = { ...replay };
  for (let v = current.version; v < target; v++) {
    const migrate = migrations[v + 1];
    if (typeof migrate !== "function") {
      throw new Error(`falta a migração do save da versão ${v} para a ${v + 1}`);
    }
    current = migrate(current);
  }
  return current;
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
  if (typeof r.seed !== "string" || typeof r.tick !== "number" || !Array.isArray(r.commands)) {
    throw new Error("save incompleto");
  }
  if (r.version !== undefined && (!Number.isInteger(r.version) || r.version <= 0)) {
    throw new Error(`versão de save inválida: ${r.version}`);
  }
  // Primeiro migra o save até a versão atual e SÓ DEPOIS valida os comandos:
  // renomear ou reescrever um comando velho é trabalho da migração, nunca da validação.
  const migrated = applyMigrations({
    ...(r as Replay),
    version: typeof r.version === "number" ? r.version : 1,
  });
  validateReplayCommands(migrated);
  return migrated;
}

/** Refaz o jogo até o tick do save (aplica cada comando no tick em que foi dado). */
// replayInto NÃO valida de novo: parseReplay já migrou e validou; aqui é só refazer a cidade.
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
