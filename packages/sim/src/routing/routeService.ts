/**
 * Serviço de rotas: guarda rotas já calculadas (cache) e resolve pedidos em lote.
 *
 * Regra de reprodutibilidade: um pedido feito no tick T é SEMPRE aplicado no começo do tick T+1,
 * na ordem dos pedidos, venha a resposta do cache, deste processo ou de workers em paralelo.
 * Assim a velocidade do cálculo nunca muda o resultado, só o tempo.
 */
import type { Perf } from "../core/perf";
import type { World } from "../world/world";
import { Pathfinder, type RoadSpeeds } from "./pathfinder";

export interface Route {
  tiles: Int32Array;
  /** Tempo livre acumulado (décimos de segundo) até cada quadradinho. */
  cum: Int32Array;
}

export interface RouteRequest {
  from: number;
  to: number;
}

export class RouteService {
  private cache = new Map<number, Route | null>();
  private cacheVersion = -1;
  private pathfinder: Pathfinder;
  pending: RouteRequest[] = [];

  constructor(
    private world: World,
    private speeds: RoadSpeeds,
    private perf: Perf,
    private maxCache: number,
  ) {
    this.pathfinder = new Pathfinder(world, speeds);
  }

  request(from: number, to: number): number {
    this.pending.push({ from, to });
    return this.pending.length - 1;
  }

  /** Resolve os pedidos deste tick (no mesmo processo). */
  resolvePending(): (Route | null)[] {
    const out = this.pending.map((r) => this.get(r.from, r.to));
    this.pending = [];
    return out;
  }

  get(from: number, to: number): Route | null {
    if (this.cacheVersion !== this.world.roadVersion) {
      // Via mudou: todas as rotas guardadas podem estar erradas (via nova pode ser atalho).
      this.cache.clear();
      this.cacheVersion = this.world.roadVersion;
    }
    const key = from * this.world.size + to;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.perf.count("routeCacheHits");
      return hit;
    }
    const tiles = this.pathfinder.find(from, to);
    this.perf.count("routesComputed");
    this.perf.count("nodesExpanded", this.pathfinder.expanded);
    const route = tiles ? { tiles, cum: this.cumulative(tiles) } : null;
    if (this.cache.size >= this.maxCache) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, route);
    return route;
  }

  private cumulative(tiles: Int32Array): Int32Array {
    const cum = new Int32Array(tiles.length);
    let t = 0;
    for (let i = 1; i < tiles.length; i++) {
      t += this.speeds.tileCost[this.world.roads[tiles[i]!]!] ?? 0;
      cum[i] = t;
    }
    return cum;
  }
}
