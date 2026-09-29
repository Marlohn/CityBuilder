/**
 * Logs estruturados (uma linha JSON por evento).
 * Cada linha diz: quando (tick), qual sistema, o que aconteceu, com quem e por quê.
 */

export type LogLevel = "error" | "warn" | "info" | "debug";
const LEVEL_RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface LogEntry {
  tick: number;
  level: LogLevel;
  system: string;
  event: string;
  /** Entidade envolvida (ex: "person:12", "building:3"). */
  entity?: string;
  /** Motivo em português, pensado para quem vai corrigir. */
  reason?: string;
  data?: Record<string, unknown>;
}

export interface LoggerConfig {
  default: LogLevel;
  systems: Record<string, LogLevel>;
  ringSize: number;
}

export class Logger {
  private ring: LogEntry[] = [];
  private ringPos = 0;
  sink: ((e: LogEntry) => void) | null = null;

  constructor(
    private cfg: LoggerConfig,
    private clock: () => number,
  ) {}

  enabled(level: LogLevel, system: string): boolean {
    const max = this.cfg.systems[system] ?? this.cfg.default;
    return LEVEL_RANK[level] <= LEVEL_RANK[max];
  }

  log(
    level: LogLevel,
    system: string,
    event: string,
    fields: Omit<LogEntry, "tick" | "level" | "system" | "event"> = {},
  ) {
    if (!this.enabled(level, system)) return;
    const entry: LogEntry = { tick: this.clock(), level, system, event, ...fields };
    if (this.ring.length < this.cfg.ringSize) this.ring.push(entry);
    else {
      this.ring[this.ringPos] = entry;
      this.ringPos = (this.ringPos + 1) % this.cfg.ringSize;
    }
    this.sink?.(entry);
  }

  error(system: string, event: string, fields?: Omit<LogEntry, "tick" | "level" | "system" | "event">) {
    this.log("error", system, event, fields);
  }
  warn(system: string, event: string, fields?: Omit<LogEntry, "tick" | "level" | "system" | "event">) {
    this.log("warn", system, event, fields);
  }
  info(system: string, event: string, fields?: Omit<LogEntry, "tick" | "level" | "system" | "event">) {
    this.log("info", system, event, fields);
  }
  debug(system: string, event: string, fields?: Omit<LogEntry, "tick" | "level" | "system" | "event">) {
    this.log("debug", system, event, fields);
  }

  /** Últimas linhas, em ordem (usado no relatório de bug). */
  recent(): LogEntry[] {
    return [...this.ring.slice(this.ringPos), ...this.ring.slice(0, this.ringPos)];
  }
}
