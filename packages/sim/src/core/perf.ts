/**
 * Medição de performance.
 * - Contadores de TRABALHO: determinísticos (mesma semente = mesmos números). São eles que o teste usa.
 * - Tempos em ms: variam por máquina; só servem de informação no relatório.
 */

export class Perf {
  /** Trabalho feito no tick atual. */
  readonly tick: Record<string, number> = {};
  /** Trabalho acumulado desde o início. */
  readonly total: Record<string, number> = {};
  /** Maior valor de cada contador num único tick. */
  readonly peak: Record<string, number> = {};
  private timings: Record<string, number[]> = {};
  private pos = 0;

  constructor(private window: number) {}

  count(name: string, n = 1) {
    this.tick[name] = (this.tick[name] ?? 0) + n;
  }

  /** Chamado no começo de cada tick. */
  beginTick() {
    for (const k of Object.keys(this.tick)) {
      const v = this.tick[k]!;
      this.total[k] = (this.total[k] ?? 0) + v;
      if (v > (this.peak[k] ?? 0)) this.peak[k] = v;
      this.tick[k] = 0;
    }
    this.pos = (this.pos + 1) % this.window;
  }

  /** Mede o tempo de uma função (só informativo). */
  time<T>(system: string, fn: () => T): T {
    const t0 = now();
    try {
      return fn();
    } finally {
      const arr = (this.timings[system] ??= new Array(this.window).fill(0));
      arr[this.pos] = now() - t0;
    }
  }

  averages(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, arr] of Object.entries(this.timings)) {
      out[k] = arr.reduce((s, v) => s + v, 0) / arr.length;
    }
    return out;
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
