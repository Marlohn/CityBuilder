/**
 * Conjunto de inteiros com inserir, remover e sortear em O(1).
 * A ordem interna depende só da sequência de operações (determinística).
 */
import { growTo } from "./growable";
import type { Rng } from "./rng";

export class IndexedSet {
  private items = new Int32Array(64);
  private pos = new Int32Array(64).fill(-1);
  size = 0;

  has(v: number): boolean {
    return v < this.pos.length && this.pos[v]! >= 0;
  }

  add(v: number) {
    if (this.has(v)) return;
    if (v >= this.pos.length) this.pos = growTo(this.pos, v + 1, -1);
    this.items = growTo(this.items, this.size + 1);
    this.items[this.size] = v;
    this.pos[v] = this.size;
    this.size++;
  }

  delete(v: number) {
    if (!this.has(v)) return;
    const i = this.pos[v]!;
    const last = this.items[this.size - 1]!;
    this.items[i] = last;
    this.pos[last] = i;
    this.pos[v] = -1;
    this.size--;
  }

  at(i: number): number {
    return this.items[i]!;
  }

  random(rng: Rng): number {
    return this.items[rng.int(this.size)]!;
  }

  toArray(): number[] {
    return Array.from(this.items.subarray(0, this.size));
  }
}
