/**
 * Famílias (domicílios). Cada família mora numa casa (ou apartamento) e tem uma lista de membros.
 */
import { growTo } from "../core/growable";
import type { Population } from "./population";

export class Households {
  count = 0;
  aliveCount = 0;
  alive = new Uint8Array(0);
  /** Prédio onde mora (-1 = ainda sem casa). */
  home = new Int32Array(0);
  /** Primeiro membro da lista (lista ligada em Population.nextInHousehold). */
  head = new Int32Array(0);
  size = new Uint8Array(0);
  /** Poupança (R$). */
  savings = new Float64Array(0);
  cars = new Uint8Array(0);
  /** Id do carro da família (-1 = sem carro). */
  car = new Int32Array(0);
  /** 1 = a família quer uma casa própria (casal morando com os pais, filho que saiu de casa...). */
  wantsHome = new Uint8Array(0);
  /** 1 = mora "de favor" na casa de outra família (não ocupa uma moradia própria). */
  sharing = new Uint8Array(0);

  constructor(private pop: Population) {
    this.ensure(512);
  }

  create(): number {
    const id = this.count++;
    this.ensure(this.count);
    this.alive[id] = 1;
    this.home[id] = -1;
    this.head[id] = -1;
    this.size[id] = 0;
    this.car[id] = -1;
    this.aliveCount++;
    return id;
  }

  addMember(h: number, p: number) {
    const pop = this.pop;
    pop.household[p] = h;
    pop.nextInHousehold[p] = -1;
    if (this.head[h] === -1) this.head[h] = p;
    else {
      let cur = this.head[h]!;
      while (pop.nextInHousehold[cur]! !== -1) cur = pop.nextInHousehold[cur]!;
      pop.nextInHousehold[cur] = p;
    }
    this.size[h]!++;
  }

  removeMember(h: number, p: number) {
    const pop = this.pop;
    let prev = -1;
    let cur = this.head[h]!;
    while (cur !== -1 && cur !== p) {
      prev = cur;
      cur = pop.nextInHousehold[cur]!;
    }
    if (cur === -1) return;
    const next = pop.nextInHousehold[p]!;
    if (prev === -1) this.head[h] = next;
    else pop.nextInHousehold[prev] = next;
    pop.nextInHousehold[p] = -1;
    pop.household[p] = -1;
    this.size[h]!--;
  }

  members(h: number): number[] {
    const out: number[] = [];
    for (let cur = this.head[h]!; cur !== -1; cur = this.pop.nextInHousehold[cur]!) out.push(cur);
    return out;
  }

  dissolve(h: number) {
    if (!this.alive[h]) return;
    this.alive[h] = 0;
    this.aliveCount--;
  }

  private ensure(n: number) {
    if (this.alive.length >= n) return;
    const len = Math.max(n, this.alive.length * 2, 512);
    this.alive = growTo(this.alive, len);
    this.home = growTo(this.home, len);
    this.head = growTo(this.head, len);
    this.size = growTo(this.size, len);
    this.savings = growTo(this.savings, len);
    this.cars = growTo(this.cars, len);
    this.car = growTo(this.car, len);
    this.wantsHome = growTo(this.wantsHome, len);
    this.sharing = growTo(this.sharing, len);
  }
}
