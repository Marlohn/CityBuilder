/**
 * Caminho mais rápido entre dois quadradinhos de via (A*), com custos inteiros (determinístico).
 * Custo de cada quadradinho = tempo em décimos de segundo na velocidade da via (CTB art. 61).
 * Arrays reaproveitados entre buscas (sem criar lixo para o coletor).
 */
import type { World } from "../world/world";

export interface RoadSpeeds {
  /** Décimos de segundo para atravessar um quadradinho, por tipo de via (índice = ROAD_ID). */
  tileCost: number[];
}

export class Pathfinder {
  private g: Int32Array;
  private stamp: Int32Array;
  private closed: Int32Array;
  private parent: Int32Array;
  private gen = 0;
  // Heap binária (nó, f) em arrays.
  private heapNode: Int32Array;
  private heapF: Int32Array;
  private heapSize = 0;
  /** Nós expandidos na última busca (contador de trabalho). */
  expanded = 0;

  constructor(
    private world: World,
    private speeds: RoadSpeeds,
  ) {
    const n = world.size;
    this.g = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.parent = new Int32Array(n);
    this.heapNode = new Int32Array(n * 2);
    this.heapF = new Int32Array(n * 2);
  }

  /** Devolve os quadradinhos do caminho (origem ... destino) ou null se não houver ligação. */
  find(from: number, to: number): Int32Array | null {
    const w = this.world;
    const roads = w.roads;
    this.expanded = 0;
    if (roads[from] === 0 || roads[to] === 0) return null;
    if (from === to) return Int32Array.of(from);
    this.gen++;
    const gen = this.gen;
    const minCost = Math.min(...this.speeds.tileCost.slice(1));
    const tx = w.xOf(to);
    const ty = w.yOf(to);
    const h = (i: number) => (Math.abs(w.xOf(i) - tx) + Math.abs(w.yOf(i) - ty)) * minCost;
    this.heapSize = 0;
    this.g[from] = 0;
    this.stamp[from] = gen;
    this.parent[from] = -1;
    this.push(from, h(from));
    while (this.heapSize > 0) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      this.expanded++;
      if (cur === to) return this.build(from, to);
      const gc = this.g[cur]!;
      for (let d = 0; d < 4; d++) {
        const n = w.neighbor(cur, d);
        if (n < 0) continue;
        const r = roads[n]!;
        if (r === 0 || this.closed[n] === gen) continue;
        const ng = gc + this.speeds.tileCost[r]!;
        if (this.stamp[n] !== gen || ng < this.g[n]!) {
          this.stamp[n] = gen;
          this.g[n] = ng;
          this.parent[n] = cur;
          this.push(n, ng + h(n));
        }
      }
    }
    return null;
  }

  private build(from: number, to: number): Int32Array {
    let len = 1;
    for (let c = to; c !== from; c = this.parent[c]!) len++;
    const out = new Int32Array(len);
    let i = len - 1;
    for (let c = to; ; c = this.parent[c]!) {
      out[i--] = c;
      if (c === from) break;
    }
    return out;
  }

  // Heap ordenada por f, desempate pelo índice do nó (determinístico).
  private less(i: number, j: number): boolean {
    const fi = this.heapF[i]!;
    const fj = this.heapF[j]!;
    return fi < fj || (fi === fj && this.heapNode[i]! < this.heapNode[j]!);
  }

  private push(node: number, f: number) {
    if (this.heapSize >= this.heapNode.length) {
      const bigger = (a: Int32Array) => {
        const b = new Int32Array(a.length * 2);
        b.set(a);
        return b;
      };
      this.heapNode = bigger(this.heapNode);
      this.heapF = bigger(this.heapF);
    }
    let i = this.heapSize++;
    this.heapNode[i] = node;
    this.heapF[i] = f;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  private pop(): number {
    const top = this.heapNode[0]!;
    this.heapSize--;
    if (this.heapSize > 0) {
      this.heapNode[0] = this.heapNode[this.heapSize]!;
      this.heapF[0] = this.heapF[this.heapSize]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.heapSize && this.less(l, m)) m = l;
        if (r < this.heapSize && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(i: number, j: number) {
    const n = this.heapNode[i]!;
    const f = this.heapF[i]!;
    this.heapNode[i] = this.heapNode[j]!;
    this.heapF[i] = this.heapF[j]!;
    this.heapNode[j] = n;
    this.heapF[j] = f;
  }
}

/** Custo por quadradinho (décimos de segundo) a partir da velocidade em km/h. */
export function tileCostDs(tileMeters: number, speedKmh: number): number {
  return Math.max(1, Math.round((tileMeters / (speedKmh / 3.6)) * 10));
}
