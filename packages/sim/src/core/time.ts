/**
 * Relógio do jogo. Cada dia do jogo representa um ano de vida (docs/PLANO.md seção 5.2).
 */
export interface TimeConfig {
  minutesPerTick: number;
  startYear: number;
  startHour?: number;
}

export class Clock {
  readonly ticksPerDay: number;

  constructor(
    private cfg: TimeConfig,
    public tick = -1,
  ) {
    this.ticksPerDay = Math.floor(1440 / cfg.minutesPerTick);
    if (tick < 0) this.tick = Math.floor(((cfg.startHour ?? 0) * 60) / cfg.minutesPerTick);
  }

  get day(): number {
    return Math.floor(this.tick / this.ticksPerDay);
  }

  get tickOfDay(): number {
    return this.tick % this.ticksPerDay;
  }

  get minuteOfDay(): number {
    return this.tickOfDay * this.cfg.minutesPerTick;
  }

  /** Ano do calendário mostrado ao jogador. */
  get year(): number {
    return this.cfg.startYear + this.day;
  }

  /** Idade (em anos) de quem nasceu no tick `birthTick`. */
  ageOf(birthTick: number): number {
    return Math.floor((this.tick - birthTick) / this.ticksPerDay);
  }

  minutesToTicks(minutes: number): number {
    return Math.max(1, Math.ceil(minutes / this.cfg.minutesPerTick));
  }
}
