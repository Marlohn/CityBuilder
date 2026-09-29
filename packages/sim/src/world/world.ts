/**
 * O mapa em grid. Índice de um quadradinho = y * width + x.
 */
import type { Rng } from "../core/rng";

export class World {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly tileMeters: number;
  /** 0 = sem via, 1 = rua, 2 = avenida. */
  readonly roads: Uint8Array;
  /** Índice em ZONE_KINDS (0 = sem zona). */
  readonly zones: Uint8Array;
  /** 1 = vegetação nativa. */
  readonly trees: Uint8Array;
  /** Id do prédio que ocupa o quadradinho, ou -1. */
  readonly buildingAt: Int32Array;
  /** Aumenta a cada mudança de via, zona ou vegetação (a tela usa para saber quando redesenhar). */
  mapVersion = 0;
  /** Aumenta a cada mudança de via (rotas e conexões precisam ser recalculadas). */
  roadVersion = 0;

  constructor(width: number, height: number, tileMeters: number) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.tileMeters = tileMeters;
    this.roads = new Uint8Array(this.size);
    this.zones = new Uint8Array(this.size);
    this.trees = new Uint8Array(this.size);
    this.buildingAt = new Int32Array(this.size).fill(-1);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  xOf(i: number): number {
    return i % this.width;
  }

  yOf(i: number): number {
    return (i - (i % this.width)) / this.width;
  }

  /** Distância de Manhattan em metros entre dois quadradinhos. */
  manhattanMeters(a: number, b: number): number {
    return (Math.abs(this.xOf(a) - this.xOf(b)) + Math.abs(this.yOf(a) - this.yOf(b))) * this.tileMeters;
  }

  /** Vizinhos (norte, leste, sul, oeste) dentro do mapa; -1 quando fora. */
  neighbor(i: number, dir: number): number {
    const x = this.xOf(i);
    const y = this.yOf(i);
    switch (dir) {
      case 0:
        return y > 0 ? i - this.width : -1;
      case 1:
        return x < this.width - 1 ? i + 1 : -1;
      case 2:
        return y < this.height - 1 ? i + this.width : -1;
      default:
        return x > 0 ? i - 1 : -1;
    }
  }

  /**
   * Gera vegetação nativa com ruído suave (só contas inteiras e + - * /, determinístico).
   * `coverage` é a fração do mapa com árvores.
   */
  generateTrees(rng: Rng, coverage: number) {
    const cell = 12;
    const gw = Math.ceil(this.width / cell) + 2;
    const gh = Math.ceil(this.height / cell) + 2;
    const lattice = new Float64Array(gw * gh);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng.float();
    const values = new Float64Array(this.size);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const gx = x / cell;
        const gy = y / cell;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = smooth(gx - x0);
        const fy = smooth(gy - y0);
        const v00 = lattice[y0 * gw + x0]!;
        const v10 = lattice[y0 * gw + x0 + 1]!;
        const v01 = lattice[(y0 + 1) * gw + x0]!;
        const v11 = lattice[(y0 + 1) * gw + x0 + 1]!;
        const top = v00 + (v10 - v00) * fx;
        const bottom = v01 + (v11 - v01) * fx;
        // Um pouco de ruído fino para as bordas não ficarem lisas demais.
        values[y * this.width + x] = top + (bottom - top) * fy + (rng.float() - 0.5) * 0.15;
      }
    }
    const sorted = Float64Array.from(values).sort();
    const threshold = sorted[Math.floor((1 - coverage) * (this.size - 1))] ?? 1;
    for (let i = 0; i < this.size; i++) this.trees[i] = coverage > 0 && values[i]! >= threshold ? 1 : 0;
    this.mapVersion++;
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
