/**
 * Rede de vias: quais vias estão ligadas entre si (componentes conectados).
 * Recalculada só quando alguma via muda.
 */
import type { World } from "./world";

export class RoadNetwork {
  /** Componente de cada quadradinho de via (-1 = não é via). */
  component: Int32Array;
  componentCount = 0;
  /** Para cada componente ligado à borda do mapa: o quadradinho de via na borda (saída da cidade). */
  edgeTileOfComponent = new Map<number, number>();
  private builtForVersion = -1;

  constructor(private world: World) {
    this.component = new Int32Array(world.size).fill(-1);
  }

  /** Garante que os componentes estão atualizados. Custo: O(tamanho do mapa), só quando as vias mudam. */
  refresh() {
    if (this.builtForVersion === this.world.roadVersion) return;
    const { roads, size } = this.world;
    const comp = this.component;
    comp.fill(-1);
    const stack = new Int32Array(size);
    let count = 0;
    for (let start = 0; start < size; start++) {
      if (roads[start] === 0 || comp[start] !== -1) continue;
      let top = 0;
      stack[top++] = start;
      comp[start] = count;
      while (top > 0) {
        const i = stack[--top]!;
        for (let d = 0; d < 4; d++) {
          const n = this.world.neighbor(i, d);
          if (n >= 0 && roads[n] !== 0 && comp[n] === -1) {
            comp[n] = count;
            stack[top++] = n;
          }
        }
      }
      count++;
    }
    this.componentCount = count;
    this.edgeTileOfComponent.clear();
    const { width, height } = this.world;
    for (let i = 0; i < size; i++) {
      if (comp[i]! < 0) continue;
      const x = i % width;
      const y = (i - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        if (!this.edgeTileOfComponent.has(comp[i]!)) this.edgeTileOfComponent.set(comp[i]!, i);
      }
    }
    this.builtForVersion = this.world.roadVersion;
  }

  /** Quadradinho de saída da cidade alcançável a partir da via `tile`, ou -1 (sem ligação com fora). */
  exitFor(tile: number): number {
    this.refresh();
    const c = tile >= 0 ? this.component[tile]! : -1;
    return c >= 0 ? (this.edgeTileOfComponent.get(c) ?? -1) : -1;
  }

  hasOutsideConnection(): boolean {
    this.refresh();
    return this.edgeTileOfComponent.size > 0;
  }

  /** true se os dois quadradinhos de via estão ligados. */
  connected(a: number, b: number): boolean {
    this.refresh();
    const ca = this.component[a]!;
    return ca >= 0 && ca === this.component[b];
  }

  /**
   * Acha um quadradinho de via encostado no retângulo (x, y, w, h).
   * Devolve [índice da via, lado] ou [-1, -1]. Lado: 0 norte, 1 leste, 2 sul, 3 oeste.
   * Ordem fixa de busca para ser determinístico.
   */
  findAccess(x: number, y: number, w: number, h: number): [number, number] {
    const world = this.world;
    const tryTile = (tx: number, ty: number): number =>
      world.inBounds(tx, ty) && world.roads[world.idx(tx, ty)] !== 0 ? world.idx(tx, ty) : -1;
    for (let dx = 0; dx < w; dx++) {
      const s = tryTile(x + dx, y + h);
      if (s >= 0) return [s, 2];
    }
    for (let dy = 0; dy < h; dy++) {
      const e = tryTile(x + w, y + dy);
      if (e >= 0) return [e, 1];
    }
    for (let dx = 0; dx < w; dx++) {
      const n = tryTile(x + dx, y - 1);
      if (n >= 0) return [n, 0];
    }
    for (let dy = 0; dy < h; dy++) {
      const o = tryTile(x - 1, y + dy);
      if (o >= 0) return [o, 3];
    }
    return [-1, -1];
  }
}
