/**
 * Prédios, guardados em arrays numéricos (um array por campo).
 * Ids nunca são reaproveitados: um prédio demolido continua existindo no histórico.
 */

import type { BuildingType } from "../config/schema";
import { growTo } from "../core/growable";

export const BSTATE = { constructing: 0, active: 1, abandoned: 2, demolished: 3 } as const;

export class Buildings {
  count = 0;
  typeIdx = new Int16Array(64);
  x = new Int16Array(64);
  y = new Int16Array(64);
  w = new Uint8Array(64);
  h = new Uint8Array(64);
  state = new Uint8Array(64);
  readyTick = new Int32Array(64);
  access = new Int32Array(64);
  facing = new Uint8Array(64);
  variant = new Uint16Array(64);
  households = new Int32Array(64);
  residents = new Int32Array(64);
  jobsFilled = new Int32Array(64);
  students = new Int32Array(64);
  patients = new Int32Array(64);
  parked = new Int32Array(64);
  /** Aumenta quando um prédio é criado, fica pronto, é abandonado ou demolido. */
  structureVersion = 0;

  constructor(readonly catalog: BuildingType[]) {}

  typeOf(id: number): BuildingType {
    return this.catalog[this.typeIdx[id]!]!;
  }

  isActive(id: number): boolean {
    return this.state[id] === BSTATE.active;
  }

  add(
    typeIdx: number,
    x: number,
    y: number,
    access: number,
    facing: number,
    readyTick: number,
    variant: number,
  ): number {
    const id = this.count++;
    this.ensure(this.count);
    const t = this.catalog[typeIdx]!;
    this.typeIdx[id] = typeIdx;
    this.x[id] = x;
    this.y[id] = y;
    this.w[id] = t.w;
    this.h[id] = t.h;
    this.state[id] = BSTATE.constructing;
    this.readyTick[id] = readyTick;
    this.access[id] = access;
    this.facing[id] = facing;
    this.variant[id] = variant;
    this.structureVersion++;
    return id;
  }

  setState(id: number, state: number) {
    if (this.state[id] === state) return;
    this.state[id] = state;
    this.structureVersion++;
  }

  homesCapacity(id: number): number {
    return this.typeOf(id).homes;
  }
  jobsCapacity(id: number): number {
    return this.typeOf(id).jobs;
  }
  studentsCapacity(id: number): number {
    return this.typeOf(id).students;
  }
  patientsCapacity(id: number): number {
    return this.typeOf(id).patients;
  }

  /** Centro do prédio em coordenadas de quadradinho. */
  centerX(id: number): number {
    return this.x[id]! + this.w[id]! / 2;
  }
  centerY(id: number): number {
    return this.y[id]! + this.h[id]! / 2;
  }

  private ensure(n: number) {
    this.typeIdx = growTo(this.typeIdx, n);
    this.x = growTo(this.x, n);
    this.y = growTo(this.y, n);
    this.w = growTo(this.w, n);
    this.h = growTo(this.h, n);
    this.state = growTo(this.state, n);
    this.readyTick = growTo(this.readyTick, n);
    this.access = growTo(this.access, n);
    this.facing = growTo(this.facing, n);
    this.variant = growTo(this.variant, n);
    this.households = growTo(this.households, n);
    this.residents = growTo(this.residents, n);
    this.jobsFilled = growTo(this.jobsFilled, n);
    this.students = growTo(this.students, n);
    this.patients = growTo(this.patients, n);
    this.parked = growTo(this.parked, n);
  }
}
