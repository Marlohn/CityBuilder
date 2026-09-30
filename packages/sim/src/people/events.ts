/**
 * Histórico de vida de cada pessoa (compacto). Cada evento aponta para o evento anterior da
 * mesma pessoa, então dá para montar a história de alguém sem varrer tudo.
 */
import { growTo } from "../core/growable";
import type { Population } from "./population";

export const EV = {
  arrived: 1,
  born: 2,
  died: 3,
  movedHome: 4,
  married: 5,
  divorced: 6,
  jobStart: 7,
  jobEnd: 8,
  schoolStart: 9,
  schoolEnd: 10,
  graduated: 11,
  retired: 12,
  leftCity: 13,
  boughtCar: 14,
  childBorn: 15,
  widowed: 16,
  unmet: 17,
  lostHome: 18,
  movedToRelatives: 19,
} as const;

/** Motivos de desejo não atendido (campo `a` do evento EV.unmet). */
export const UNMET = {
  school: 1,
  university: 2,
  health: 3,
  housing: 4,
  job: 5,
  transit: 6,
  parking: 7,
  errand: 8,
} as const;

export class EventLog {
  count = 0;
  tick = new Int32Array(1024);
  type = new Uint8Array(1024);
  person = new Int32Array(1024);
  a = new Int32Array(1024);
  b = new Int32Array(1024);
  prev = new Int32Array(1024);

  constructor(private pop: Population) {}

  add(tick: number, type: number, person: number, a = -1, b = -1) {
    const i = this.count++;
    if (this.count > this.tick.length) {
      const n = this.tick.length * 2;
      this.tick = growTo(this.tick, n);
      this.type = growTo(this.type, n);
      this.person = growTo(this.person, n);
      this.a = growTo(this.a, n);
      this.b = growTo(this.b, n);
      this.prev = growTo(this.prev, n);
    }
    this.tick[i] = tick;
    this.type[i] = type;
    this.person[i] = person;
    this.a[i] = a;
    this.b[i] = b;
    this.prev[i] = this.pop.lastEvent[person]!;
    this.pop.lastEvent[person] = i;
  }

  /** Eventos da pessoa, do mais antigo para o mais novo. */
  of(person: number): number[] {
    const out: number[] = [];
    for (let e = this.pop.lastEvent[person]!; e !== -1; e = this.prev[e]!) out.push(e);
    return out.reverse();
  }
}
