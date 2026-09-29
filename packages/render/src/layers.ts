/**
 * Camadas de objetos desenhados em lote: vias, prédios, árvores e veículos.
 */
import type { BuildingView, MapView, VehiclesView } from "@city/contract";
import { BatchSet } from "./instances";
import type { ModelLibrary } from "./models";
import { PIECE_MODEL, roadPieceFor } from "./roads";

const HALF_PI = Math.PI / 2;
/** Metros por andar (pé-direito típico + laje). */
const FLOOR_METERS = 3;

export interface BuildingVisual {
  id: string;
  models: string[];
  floors: number;
}

/** Lado da "frente" dos modelos Kenney na rotação 0 (medido visualmente): 2 = sul (+Z). */
const MODEL_FRONT = 2;

function hash(i: number): number {
  let h = i | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class RoadLayer {
  private batches = new BatchSet();
  constructor(private lib: ModelLibrary) {}

  static models(): string[] {
    return [...Object.values(PIECE_MODEL), "roads/light-square"];
  }

  update(map: MapView) {
    this.batches.resetAll();
    for (const m of RoadLayer.models()) this.batches.get(m);
    const { width, height, roads } = map;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const kind = roads[i]!;
        if (!kind) continue;
        let mask = 0;
        if (y > 0 && roads[i - width]) mask |= 1;
        if (x < width - 1 && roads[i + 1]) mask |= 2;
        if (y < height - 1 && roads[i + width]) mask |= 4;
        if (x > 0 && roads[i - 1]) mask |= 8;
        const { piece, quarterTurns } = roadPieceFor(mask);
        this.batches.get(PIECE_MODEL[piece]).push(x + 0.5, 0.005, y + 0.5, quarterTurns * HALF_PI, 1, 1, 1);
        // Avenidas ganham postes de luz a cada dois quadradinhos (retas).
        if (kind === 2 && piece === "straight" && (x + y) % 2 === 0) {
          const alongX = (mask & 10) === 10;
          const ox = alongX ? 0 : 0.47;
          const oz = alongX ? 0.47 : 0;
          this.batches
            .get("roads/light-square")
            .push(x + 0.5 + ox, 0, y + 0.5 + oz, alongX ? HALF_PI : 0, 1, 1, 1);
        }
      }
    }
    this.batches.applyAll((m) => this.lib.get(m).mesh);
  }
}

export class BuildingLayer {
  private batches = new BatchSet();
  private visuals = new Map<string, BuildingVisual>();

  constructor(
    private lib: ModelLibrary,
    visuals: BuildingVisual[],
    private tileMeters: number,
  ) {
    for (const v of visuals) this.visuals.set(v.id, v);
  }

  static models(visuals: BuildingVisual[]): string[] {
    return [...visuals.flatMap((v) => v.models), "proc/construction"];
  }

  /** Altura desenhada do prédio (em quadradinhos), usada no clique. Mesma conta do desenho. */
  heightOf(b: BuildingView): number {
    const vis = this.visuals.get(b.type);
    const floors = vis?.floors ?? 1;
    if (b.state === 0) return Math.max(0.6, floors * 0.5) * Math.min(b.w, b.h);
    return Math.max(0.3, (floors * FLOOR_METERS + 2) / this.tileMeters);
  }

  update(list: BuildingView[]) {
    this.batches.resetAll();
    for (const m of BuildingLayer.models([...this.visuals.values()])) this.batches.get(m);
    for (const b of list) {
      const vis = this.visuals.get(b.type);
      if (!vis) continue;
      const cx = b.x + b.w / 2;
      const cz = b.y + b.h / 2;
      const quarter = (((MODEL_FRONT - b.facing) % 4) + 4) % 4;
      const rot = quarter * HALF_PI;
      if (b.state === 0) {
        const s = Math.min(b.w, b.h);
        this.batches.get("proc/construction").push(cx, 0, cz, 0, s, Math.max(0.6, vis.floors * 0.5) * s, s);
        continue;
      }
      const model = vis.models[b.variant % vis.models.length]!;
      const info = this.lib.get(model);
      const footprint = Math.min(b.w, b.h) * (model.startsWith("proc/") ? 1 : 0.92);
      const s = footprint / Math.max(info.size.x, info.size.z);
      const target = (vis.floors * FLOOR_METERS + 2) / this.tileMeters;
      const natural = info.size.y * s;
      const sy = model.startsWith("proc/") ? s : s * Math.min(1.6, Math.max(0.7, target / natural));
      this.batches.get(model).push(cx, 0, cz, rot, s, sy, s);
    }
    this.batches.applyAll((m) => this.lib.get(m).mesh);
  }
}

export class TreeLayer {
  private batches = new BatchSet();
  constructor(private lib: ModelLibrary) {}

  static models(): string[] {
    return ["suburban/tree-large", "suburban/tree-small"];
  }

  update(map: MapView, occupied: Uint8Array) {
    this.batches.resetAll();
    for (const m of TreeLayer.models()) this.batches.get(m);
    const { width, trees } = map;
    for (let i = 0; i < trees.length; i++) {
      if (!trees[i] || occupied[i] || map.roads[i]) continue;
      const x = i % width;
      const y = (i - x) / width;
      const n = hash(i) < 0.5 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const h1 = hash(i * 7 + k * 13 + 1);
        const h2 = hash(i * 11 + k * 17 + 3);
        const big = hash(i * 3 + k) < 0.6;
        // Copa de 5 a 9 m (o modelo Kenney tem ~0,2 de largura).
        const s = 1.4 + h1 * 1.0;
        this.batches
          .get(big ? "suburban/tree-large" : "suburban/tree-small")
          .push(x + 0.2 + h1 * 0.6, 0, y + 0.2 + h2 * 0.6, h2 * 6.28, s, s, s);
      }
    }
    this.batches.applyAll((m) => this.lib.get(m).mesh);
  }
}

export class VehicleLayer {
  private batches = new BatchSet();
  static readonly MODELS = [
    "cars/sedan",
    "cars/suv",
    "cars/hatchback-sports",
    "cars/van",
    "cars/truck",
    "cars/delivery",
  ];
  constructor(
    private lib: ModelLibrary,
    private tileMeters: number,
  ) {}

  update(v: VehiclesView) {
    this.batches.resetAll();
    for (const m of VehicleLayer.MODELS) this.batches.get(m);
    // Carro de passeio ~4,5 m; o modelo tem 2,55 unidades de comprimento.
    const s = 4.5 / this.tileMeters / 2.55;
    for (let k = 0; k < v.count; k++) {
      const x = v.data[k * 4]!;
      const y = v.data[k * 4 + 1]!;
      const angle = v.data[k * 4 + 2]!;
      const type = v.data[k * 4 + 3]! | 0;
      const model = VehicleLayer.MODELS[type % VehicleLayer.MODELS.length]!;
      this.batches.get(model).push(x, 0.02, y, angle, s, s, s);
    }
    this.batches.applyAll((m) => this.lib.get(m).mesh);
  }
}
