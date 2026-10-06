/**
 * POC visual v4: adapta o pacote GLB autoral de 16 x 16 m ao renderer real sem
 * alterar a simulação, o contrato ou as camadas visuais padrão.
 */
import {
  type Camera,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  ImageProcessingConfiguration,
  type Mesh,
  type Scene,
  ShadowGenerator,
  SSAO2RenderingPipeline,
} from "@babylonjs/core";
import type { BuildingView, MapView, VehiclesView } from "@city/contract";
import { type BatchStats, ChunkedBatchSet, type TileRect } from "./instances";
import type { BuildingVisual } from "./layers";
import type { ModelLibrary } from "./models";
import { type RoadPiece, roadPieceFor } from "./roads";

const HALF_PI = Math.PI / 2;
const MODEL_FRONT = 2;
const FLOOR_METERS = 3;
const PEDESTRIAN_TYPE = 100;
const PREFIX = "poc-v4/";
const CHUNK_TILES = 16;

export interface PocV4GraphicsOptions {
  msaaSamples: 1 | 2 | 4;
  fxaa: boolean;
  bloom: boolean;
  ssao: boolean;
  shadowQuality: "low" | "medium" | "high";
}

export const POC_V4_HERO_GRAPHICS: PocV4GraphicsOptions = {
  msaaSamples: 4,
  fxaa: true,
  bloom: true,
  ssao: true,
  shadowQuality: "high",
};

export const POC_V4_PERF_GRAPHICS: PocV4GraphicsOptions = {
  msaaSamples: 1,
  fxaa: true,
  bloom: true,
  ssao: false,
  shadowQuality: "medium",
};

type ConfigureChunkMesh = (mesh: Mesh, model: string) => void;

const ROAD_MODELS: Record<RoadPiece, string> = {
  straight: `${PREFIX}rua_reta`,
  bend: `${PREFIX}rua_curva`,
  intersection: `${PREFIX}rua_t`,
  crossroad: `${PREFIX}rua_cruzamento`,
  end: `${PREFIX}rua_fim`,
  square: `${PREFIX}rua_praca`,
};

const BUILDING_MODELS: Record<string, readonly string[]> = {
  casa: [`${PREFIX}lote_casa_terracota`, `${PREFIX}lote_casa_frontao_azul`],
  predio_residencial: [`${PREFIX}lote_loja`],
  loja: [`${PREFIX}lote_loja`, `${PREFIX}lote_cafe`],
  escritorio: [`${PREFIX}lote_loja`],
  galpao: [`${PREFIX}lote_loja`],
};

const TREE_MODELS = [`${PREFIX}arvore_a`] as const;

const CAR_MODELS = [`${PREFIX}carro_vermelho`, `${PREFIX}carro_azul`, `${PREFIX}carro_amarelo`] as const;

const PEOPLE_MODELS = [`${PREFIX}pessoa_a`] as const;

function hash(i: number): number {
  let h = i | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function modelsFor(v: BuildingVisual): readonly string[] {
  return BUILDING_MODELS[v.id] ?? v.models;
}

function chunkKey(x: number, y: number): string {
  return `${Math.floor(x / CHUNK_TILES)}:${Math.floor(y / CHUNK_TILES)}`;
}

function parseChunkKey(key: string): [number, number] {
  const [x, y] = key.split(":");
  return [Number(x), Number(y)];
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function changedChunkKeys<T>(
  previous: ReadonlyMap<string, T>,
  next: ReadonlyMap<string, T>,
  equal: (a: T, b: T) => boolean,
): Set<string> {
  const changed = new Set<string>();
  for (const [key, value] of next) {
    const old = previous.get(key);
    if (old === undefined || !equal(old, value)) changed.add(key);
  }
  for (const key of previous.keys()) if (!next.has(key)) changed.add(key);
  return changed;
}

function byteChunkSnapshots(
  width: number,
  height: number,
  valueAt: (x: number, y: number) => number,
  border = 0,
): Map<string, Uint8Array> {
  const snapshots = new Map<string, Uint8Array>();
  const chunksX = Math.ceil(width / CHUNK_TILES);
  const chunksY = Math.ceil(height / CHUNK_TILES);
  for (let cy = 0; cy < chunksY; cy++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const x0 = Math.max(0, cx * CHUNK_TILES - border);
      const y0 = Math.max(0, cy * CHUNK_TILES - border);
      const x1 = Math.min(width, (cx + 1) * CHUNK_TILES + border);
      const y1 = Math.min(height, (cy + 1) * CHUNK_TILES + border);
      const data = new Uint8Array((x1 - x0) * (y1 - y0));
      let p = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) data[p++] = valueAt(x, y);
      }
      snapshots.set(`${cx}:${cy}`, data);
    }
  }
  return snapshots;
}

/** Receita de luz/pós-processamento fornecida junto dos GLBs, adaptada à escala em tiles. */
export class PocV4Environment {
  private readonly pipeline: DefaultRenderingPipeline;
  private readonly ssao: SSAO2RenderingPipeline | null;

  constructor(
    scene: Scene,
    camera: Camera,
    shadows: ShadowGenerator,
    tileMeters: number,
    private readonly graphics: PocV4GraphicsOptions = POC_V4_HERO_GRAPHICS,
  ) {
    scene.clearColor = Color4.FromHexString("#c8cad6ff");
    scene.ambientColor = new Color3(0.32, 0.34, 0.38);

    this.pipeline = new DefaultRenderingPipeline("poc-v4-pp", true, scene, [camera]);
    this.pipeline.samples = graphics.msaaSamples;
    this.pipeline.fxaaEnabled = graphics.fxaa;
    this.pipeline.imageProcessing.toneMappingEnabled = true;
    this.pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.pipeline.imageProcessing.exposure = 1;
    this.pipeline.imageProcessing.contrast = 1.1;
    this.pipeline.bloomEnabled = graphics.bloom;
    this.pipeline.bloomThreshold = 0.85;
    this.pipeline.bloomWeight = 0.22;
    this.pipeline.bloomKernel = 48;

    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality =
      graphics.shadowQuality === "high"
        ? ShadowGenerator.QUALITY_HIGH
        : graphics.shadowQuality === "medium"
          ? ShadowGenerator.QUALITY_MEDIUM
          : ShadowGenerator.QUALITY_LOW;
    shadows.darkness = 0.18;
    shadows.bias = 0.0008;
    shadows.normalBias = 0.03;

    let ssao: SSAO2RenderingPipeline | null = null;
    if (graphics.ssao && SSAO2RenderingPipeline.IsSupported) {
      ssao = new SSAO2RenderingPipeline("poc-v4-ssao", scene, { ssaoRatio: 0.75, blurRatio: 1 }, [camera]);
      ssao.radius = 1.6 / tileMeters;
      ssao.totalStrength = 1.15;
      ssao.samples = 16;
      ssao.maxZ = 100;
    }
    this.ssao = ssao;
  }

  state() {
    return {
      toneMapping: "ACES",
      exposure: this.pipeline.imageProcessing.exposure,
      contrast: this.pipeline.imageProcessing.contrast,
      bloom: this.pipeline.bloomEnabled,
      ssao: this.ssao !== null,
      msaaSamples: this.graphics.msaaSamples,
      fxaa: this.graphics.fxaa,
      shadowQuality: this.graphics.shadowQuality,
    };
  }

  dispose() {
    this.ssao?.dispose();
    this.pipeline.dispose();
  }
}

export class PocV4RoadLayer {
  private readonly batches: ChunkedBatchSet;
  private chunkSnapshots = new Map<string, Uint8Array>();

  constructor(
    private lib: ModelLibrary,
    private tileMeters: number,
    configureMesh?: ConfigureChunkMesh,
  ) {
    this.batches = new ChunkedBatchSet(CHUNK_TILES, (model) => this.lib.get(model).mesh, configureMesh);
  }

  static models(): string[] {
    return [...new Set([...Object.values(ROAD_MODELS), `${PREFIX}banco`, `${PREFIX}floreira`])];
  }

  update(map: MapView) {
    const { width, height, roads } = map;
    // A peça de borda depende dos vizinhos, então o snapshot inclui 1 tile ao redor do chunk.
    const nextSnapshots = byteChunkSnapshots(width, height, (x, y) => roads[y * width + x] ?? 0, 1);
    const dirty = changedChunkKeys(this.chunkSnapshots, nextSnapshots, sameBytes);
    this.chunkSnapshots = nextSnapshots;
    if (dirty.size === 0) return;

    this.batches.resetChunks(dirty);
    const s = 1 / this.tileMeters;
    const sidewalkY = 0.18 / this.tileMeters;

    for (const key of dirty) {
      const [cx, cy] = parseChunkKey(key);
      const x0 = cx * CHUNK_TILES;
      const y0 = cy * CHUNK_TILES;
      const x1 = Math.min(width, x0 + CHUNK_TILES);
      const y1 = Math.min(height, y0 + CHUNK_TILES);

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * width + x;
          if (!roads[i]) continue;

          let mask = 0;
          if (y > 0 && roads[i - width]) mask |= 1;
          if (x < width - 1 && roads[i + 1]) mask |= 2;
          if (y < height - 1 && roads[i + width]) mask |= 4;
          if (x > 0 && roads[i - 1]) mask |= 8;

          const { piece, quarterTurns } = roadPieceFor(mask);
          this.batches
            .get(ROAD_MODELS[piece], x + 0.5, y + 0.5)
            .push(x + 0.5, 0, y + 0.5, quarterTurns * HALF_PI, s, s, s);

          if (piece === "straight" && (x + y) % 2 === 0) {
            const alongX = (mask & 10) === 10;
            const side = (x + y) % 4 === 0 ? 1 : -1;
            const ox = alongX ? 0 : side * 0.41;
            const oz = alongX ? side * 0.41 : 0;
            this.batches
              .get(`${PREFIX}banco`, x + 0.5 + ox, y + 0.5 + oz)
              .push(x + 0.5 + ox, sidewalkY, y + 0.5 + oz, alongX ? HALF_PI : 0, s, s, s);
          }

          if (piece === "straight" && (x * 3 + y * 5) % 17 === 0) {
            const alongX = (mask & 10) === 10;
            const ox = alongX ? 0.34 : -0.39;
            const oz = alongX ? -0.39 : 0.34;
            this.batches
              .get(`${PREFIX}floreira`, x + 0.5 + ox, y + 0.5 + oz)
              .push(x + 0.5 + ox, sidewalkY, y + 0.5 + oz, 0, s, s, s);
          }
        }
      }
    }
    this.batches.applyChunks(dirty);
  }

  setVisibleRect(rect: TileRect) {
    this.batches.setVisibleRect(rect);
  }

  stats(): BatchStats {
    return this.batches.stats();
  }
}

export class PocV4BuildingLayer {
  private readonly batches: ChunkedBatchSet;
  private chunkSignatures = new Map<string, string>();
  private visuals = new Map<string, BuildingVisual>();

  constructor(
    private lib: ModelLibrary,
    visuals: BuildingVisual[],
    private tileMeters: number,
    configureMesh?: ConfigureChunkMesh,
  ) {
    this.batches = new ChunkedBatchSet(CHUNK_TILES, (model) => this.lib.get(model).mesh, configureMesh);
    for (const v of visuals) this.visuals.set(v.id, v);
  }

  static models(visuals: BuildingVisual[]): string[] {
    return [...new Set([...visuals.flatMap((v) => modelsFor(v)), "proc/construction"])];
  }

  heightOf(b: BuildingView): number {
    const vis = this.visuals.get(b.type);
    if (!vis) return 0.3;
    if (b.state === 0) return Math.max(0.6, vis.floors * 0.5) * Math.min(b.w, b.h);

    const choices = modelsFor(vis);
    const model = choices[b.variant % choices.length]!;
    if (model.startsWith(`${PREFIX}lote_`)) {
      const info = this.lib.get(model);
      const s = 0.92 / Math.max(info.size.x, info.size.z);
      return Math.max(0.2, info.size.y * s);
    }
    return Math.max(0.3, (vis.floors * FLOOR_METERS + 2) / this.tileMeters);
  }

  update(list: BuildingView[]) {
    const grouped = new Map<string, BuildingView[]>();
    for (const b of list) {
      if (!this.visuals.has(b.type)) continue;
      const key = chunkKey(b.x + b.w / 2, b.y + b.h / 2);
      const chunk = grouped.get(key);
      if (chunk) chunk.push(b);
      else grouped.set(key, [b]);
    }

    const nextSignatures = new Map<string, string>();
    for (const [key, chunk] of grouped) {
      nextSignatures.set(
        key,
        chunk
          .map((b) => `${b.id}:${b.type}:${b.x}:${b.y}:${b.w}:${b.h}:${b.state}:${b.facing}:${b.variant}`)
          .join("|"),
      );
    }
    const dirty = changedChunkKeys(this.chunkSignatures, nextSignatures, (a, b) => a === b);
    this.chunkSignatures = nextSignatures;
    if (dirty.size === 0) return;

    this.batches.resetChunks(dirty);
    for (const [key, chunk] of grouped) {
      if (!dirty.has(key)) continue;
      for (const b of chunk) {
        const vis = this.visuals.get(b.type);
        if (!vis) continue;
        const cx = b.x + b.w / 2;
        const cz = b.y + b.h / 2;
        const quarter = (((MODEL_FRONT - b.facing) % 4) + 4) % 4;
        const rot = quarter * HALF_PI;

        if (b.state === 0) {
          const scale = Math.min(b.w, b.h);
          this.batches
            .get("proc/construction", cx, cz)
            .push(cx, 0, cz, 0, scale, Math.max(0.6, vis.floors * 0.5) * scale, scale);
          continue;
        }

        const choices = modelsFor(vis);
        const model = choices[b.variant % choices.length]!;
        const info = this.lib.get(model);
        const footprint = model.startsWith(`${PREFIX}lote_`)
          ? 0.92
          : Math.min(b.w, b.h) * (model.startsWith("proc/") ? 1 : 0.92);
        const s = footprint / Math.max(info.size.x, info.size.z);

        if (model.startsWith(`${PREFIX}lote_`)) {
          this.batches.get(model, cx, cz).push(cx, 0, cz, rot, s, s, s);
          continue;
        }

        const target = (vis.floors * FLOOR_METERS + 2) / this.tileMeters;
        const natural = info.size.y * s;
        const sy = model.startsWith("proc/") ? s : s * Math.min(1.6, Math.max(0.7, target / natural));
        this.batches.get(model, cx, cz).push(cx, 0, cz, rot, s, sy, s);
      }
    }
    this.batches.applyChunks(dirty);
  }

  setVisibleRect(rect: TileRect) {
    this.batches.setVisibleRect(rect);
  }

  stats(): BatchStats {
    return this.batches.stats();
  }
}

export class PocV4TreeLayer {
  private readonly batches: ChunkedBatchSet;
  private chunkSnapshots = new Map<string, Uint8Array>();

  constructor(
    private lib: ModelLibrary,
    private tileMeters: number,
    configureMesh?: ConfigureChunkMesh,
  ) {
    this.batches = new ChunkedBatchSet(CHUNK_TILES, (model) => this.lib.get(model).mesh, configureMesh);
  }

  static models(): string[] {
    return [...TREE_MODELS];
  }

  update(map: MapView, occupied: Uint8Array) {
    const { width, height, trees, roads } = map;
    const nextSnapshots = byteChunkSnapshots(width, height, (x, y) => {
      const i = y * width + x;
      return (trees[i] ? 1 : 0) | (occupied[i] ? 2 : 0) | (roads[i] ? 4 : 0);
    });
    const dirty = changedChunkKeys(this.chunkSnapshots, nextSnapshots, sameBytes);
    this.chunkSnapshots = nextSnapshots;
    if (dirty.size === 0) return;

    this.batches.resetChunks(dirty);
    for (const key of dirty) {
      const [cx, cy] = parseChunkKey(key);
      const x0 = cx * CHUNK_TILES;
      const y0 = cy * CHUNK_TILES;
      const x1 = Math.min(width, x0 + CHUNK_TILES);
      const y1 = Math.min(height, y0 + CHUNK_TILES);

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * width + x;
          if (!trees[i] || occupied[i] || roads[i]) continue;
          const count = hash(i) < 0.45 ? 1 : 2;
          for (let k = 0; k < count; k++) {
            const h1 = hash(i * 7 + k * 13 + 1);
            const h2 = hash(i * 11 + k * 17 + 3);
            const model = TREE_MODELS[Math.floor(hash(i * 5 + k * 19) * TREE_MODELS.length)]!;
            const s = (0.8 + h1 * 0.4) / this.tileMeters;
            this.batches
              .get(model, x + 0.18 + h1 * 0.64, y + 0.18 + h2 * 0.64)
              .push(x + 0.18 + h1 * 0.64, 0, y + 0.18 + h2 * 0.64, h2 * Math.PI * 2, s, s, s);
          }
        }
      }
    }
    this.batches.applyChunks(dirty);
  }

  setVisibleRect(rect: TileRect) {
    this.batches.setVisibleRect(rect);
  }

  stats(): BatchStats {
    return this.batches.stats();
  }
}

export class PocV4VehicleLayer {
  private readonly batches: ChunkedBatchSet;

  constructor(
    private lib: ModelLibrary,
    private tileMeters: number,
    configureMesh?: ConfigureChunkMesh,
  ) {
    this.batches = new ChunkedBatchSet(CHUNK_TILES, (model) => this.lib.get(model).mesh, configureMesh);
  }

  static models(): string[] {
    return [...CAR_MODELS, ...PEOPLE_MODELS];
  }

  update(v: VehiclesView) {
    this.batches.resetAll();

    const carScale = 1.15 / this.tileMeters;
    const personScale = 1.33 / this.tileMeters;
    const roadY = 0.02 / this.tileMeters;
    const sidewalkY = 0.18 / this.tileMeters;

    for (let k = 0; k < v.count; k++) {
      const x = v.data[k * 4]!;
      const y = v.data[k * 4 + 1]!;
      const angle = v.data[k * 4 + 2]!;
      const type = v.data[k * 4 + 3]! | 0;

      if (type >= PEDESTRIAN_TYPE) {
        const model = PEOPLE_MODELS[(type - PEDESTRIAN_TYPE) % PEOPLE_MODELS.length]!;
        this.batches.get(model, x, y).push(x, sidewalkY, y, angle, personScale, personScale, personScale);
        continue;
      }

      const model = CAR_MODELS[type % CAR_MODELS.length]!;
      this.batches.get(model, x, y).push(x, roadY, y, angle, carScale, carScale, carScale);
    }
    this.batches.applyAll();
  }

  setVisibleRect(rect: TileRect) {
    this.batches.setVisibleRect(rect);
  }

  stats(): BatchStats {
    return this.batches.stats();
  }
}
