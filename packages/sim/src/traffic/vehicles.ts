/**
 * Veículos. Todo veículo tem dono (família), fica estacionado em algum lugar e só anda numa viagem
 * com motivo, origem e destino. Nada é criado só para enfeitar a tela.
 */
import { growTo } from "../core/growable";
import { IndexedSet } from "../core/indexedSet";

export const VSTATE = { parked: 0, moving: 1, outside: 2, gone: 3 } as const;

export class Vehicles {
  count = 0;
  owner = new Int32Array(64);
  model = new Uint8Array(64);
  state = new Uint8Array(64);
  /** Prédio onde está estacionado (-1 = na rua, no quadradinho `streetTile`). */
  parkedAt = new Int32Array(64);
  streetTile = new Int32Array(64);
  driver = new Int32Array(64);
  departTick = new Int32Array(64);
  arriveTick = new Int32Array(64);
  destBuilding = new Int32Array(64);
  /** Rota da viagem atual (quadradinhos). */
  routes: (Int32Array | null)[] = [];
  /** Tempo livre acumulado (décimos de segundo) até cada quadradinho da rota. */
  routeCum: (Int32Array | null)[] = [];
  readonly moving = new IndexedSet();

  create(owner: number, model: number, parkedAt: number): number {
    const id = this.count++;
    const n = this.count;
    this.owner = growTo(this.owner, n);
    this.model = growTo(this.model, n);
    this.state = growTo(this.state, n);
    this.parkedAt = growTo(this.parkedAt, n);
    this.streetTile = growTo(this.streetTile, n);
    this.driver = growTo(this.driver, n);
    this.departTick = growTo(this.departTick, n);
    this.arriveTick = growTo(this.arriveTick, n);
    this.destBuilding = growTo(this.destBuilding, n);
    this.owner[id] = owner;
    this.model[id] = model;
    this.state[id] = VSTATE.parked;
    this.parkedAt[id] = parkedAt;
    this.streetTile[id] = -1;
    this.driver[id] = -1;
    this.routes[id] = null;
    this.routeCum[id] = null;
    return id;
  }
}
