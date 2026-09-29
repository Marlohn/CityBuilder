/**
 * Gerador de números aleatórios com semente (sfc32).
 *
 * Regras:
 * - Só usa operações inteiras de 32 bits, então dá o mesmo resultado em qualquer navegador ou no Node.
 * - Cada sistema pede o seu próprio fluxo com `stream(nome)`. Assim, adicionar um sistema novo
 *   não muda o sorteio dos outros.
 */

/** Hash de string para 4 inteiros de 32 bits (cyrb128). */
export function hashString(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export interface RngState {
  seed: string;
  s: [number, number, number, number];
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  readonly seed: string;

  constructor(seed: string) {
    this.seed = seed;
    const [a, b, c, d] = hashString(seed);
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    // Descarta os primeiros valores para misturar bem o estado.
    for (let i = 0; i < 15; i++) this.nextU32();
  }

  static fromState(state: RngState): Rng {
    const r = new Rng(state.seed);
    [r.a, r.b, r.c, r.d] = state.s;
    return r;
  }

  getState(): RngState {
    return { seed: this.seed, s: [this.a, this.b, this.c, this.d] };
  }

  /** Um fluxo independente, derivado da semente e do nome do sistema. */
  stream(name: string): Rng {
    return new Rng(`${this.seed}/${name}`);
  }

  nextU32(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Número em [0, 1). */
  float(): number {
    return this.nextU32() / 4294967296;
  }

  /** Inteiro em [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** Inteiro em [min, max]. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: lista vazia");
    return items[this.int(items.length)] as T;
  }

  /** Sorteia um índice usando pesos acumulados (ordem crescente, último = total). */
  pickCumulative(cumulative: ArrayLike<number>): number {
    const total = cumulative[cumulative.length - 1] ?? 0;
    const x = this.float() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cumulative[mid] ?? 0) > x) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** Normal aproximada (soma de 12 uniformes), sem funções transcendentes. */
  normalish(mean: number, sd: number): number {
    let s = 0;
    for (let i = 0; i < 12; i++) s += this.float();
    return mean + (s - 6) * sd;
  }
}
