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
  type Scene,
  ShadowGenerator,
  SSAO2RenderingPipeline,
} from "@babylonjs/core";
import type { BuildingView, MapView, VehiclesView } from "@city/contract";
import { BatchSet } from "./instances";
import type { BuildingVisual } from "./layers";
import type { ModelLibrary } from "./models";
import { type RoadPiece, roadPieceFor } from "./roads";

const HALF_PI = Math.PI / 2;
const MODEL_FRONT = 2;
const FLOOR_METERS = 3;
const PEDESTRIAN_TYPE = 100;
const PREFIX = "poc-v4/";

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

/** Receita de luz/pós-processamento fornecida junto dos GLBs, adaptada à escala em tiles. */
export class PocV4Environment {
  private readonly pipeline: DefaultRenderingPipeline;
  private readonly ssao: SSAO2RenderingPipeline | null;

  constructor(scene: Scene, camera: Camera, shadows: ShadowGenerator, tileMeters: number) {
    scene.clearColor = Color4.FromHexString("#c8cad6ff");
    scene.ambientColor = new Color3(0.32, 0.34, 0.38);

    this.pipeline = new DefaultRenderingPipeline("poc-v4-pp", true, scene, [camera]);
    this.pipeline.samples = 4;
    this.pipeline.fxaaEnabled = true;
    this.pipeline.imageProcessing.toneMappingEnabled = true;
    this.pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.pipeline.imageProcessing.exposure = 1;
    this.pipeline.imageProcessing.contrast = 1.1;
    this.pipeline.bloomEnabled = true;
    this.pipeline.bloomThreshold = 0.85;
    this.pipeline.bloomWeight = 0.22;
    this.pipeline.bloomKernel = 48;

    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_HIGH;
    shadows.darkness = 0.18;
    shadows.bias = 0.0008;
    shadows.normalBias = 0.03;

    let ssao: SSAO2RenderingPipeline | null = null;
    if (SSAO2RenderingPipeline.IsSupported) {
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
    };
  }

  dispose() {
    this.ssao?.dispose();
    this.pipeline.dispose();
  }
}

export class PocV4RoadLayer {
  private batches = new BatchSet();

  constructor(
    private lib: ModelLibrary,
    private tileMeters: number,
  ) {}

  static models(): string[] {
    return [...new Set([...Object.values(ROAD_MODELS), `${PREFIX}banco`, `${PREFIX}floreira`])];
  }

  update(map: MapView) {
    this.batches.resetAll();
    for (const m of PocV4RoadLayer.models()) this.batches.get(m);
    const { width, height, roads } = map;
    const s = 1 / this.tileMeters;
    const sidewalkY = 0.18 / this.tileMeters;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!roads[i]) continue;

        let mask = 0;
        if (y > 0 && roads[i - width]) mask |= 1;
        if (x < width - 1 && roads[i + 1]) mask |= 2;
        if (y < height - 1 && roads[i + width]) mask |= 4;
        if (x > 0 && roads[i - 1]) mask |= 8;

        const { piece, quarterTurns } = roadPieceFor(mask);
        this.batches.get(ROAD_MODELS[piece]).push(x + 0.5, 0, y + 0.5, quarterTurns * HALF_PI, s, s, s);

        if (piece === "straight" && (x + y) % 2 === 0) {
          const alongX = (mask & 10) === 10;
          const side = (x + y) % 4 === 0 ? 1 : -1;
          const ox = alongX ? 0 : side * 0.41;
          const oz = alongX ? side * 0.41 : 0;
          this.batches
            .get(`${PREFIX}banco`)
            .push(x + 0.5 + ox, sidewalkY, y + 0.5 + oz, alongX ? HALF_PI : 0, s, s, s);
        }

        if (piece === "straight" && (x * 3 + y * 5) % 17 === 0) {
          const alongX = (mask & 10) === 10;
          const ox = alongX ? 0.34 : -0.39;
          const oz = alongX ? -0.39 : 0.34;
          this.batches.get(`${PREFIX}floreira`).push(x + 0.5 + ox, sidewalkY, y + 0.5 + oz, 0, s, s, s);
        }
      }
    }
    this.batches.applyAll((m) => this.lib.get(m).mesh);
  }
}

export class PocV4BuildingLayer {
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
    this.batches.resetAll();
    for (const m of PocV4BuildingLayer.models([...this.visuals.values()])) this.batches.get(m);

    for (const b of list) {
      const vis = this.visuals.get(b.type);
      if (!vis) continue;
      const cx = b.x + b.w / 2;
      const cz = b.y + b.h / 2;
      const quarter = (((MODEL_FRONT - b.facing) % 4) + 4) % 4;
      const rot = quarter * HALF_PI;

      if (b.state === 0) {
        const scale = Math.min(b.w, b.h);
        this.batches
          .get("proc/construction")
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
        // O lote GLB já contém prédio, jardim, árvores e cotas corretas em metros.
        this.batches.get(model).push(cx, 0, cz, rot, s, s, s);
        continue;
      }

      const target = (vis.floors * FLOOR_METERS + 2) / this.tileMeters;
      const natural = info.size.y * s;
      const sy = model.startsWith("proc/") ? s : s * Math.min(1.6, Math.max(0.7, target / natural));
      this.batches.get(model).push(cx, 0, cz, rot, s, sy, s);
    }
    this.batches.applyAll((m) => this.lib.get(m).mesh);
  }
}

export class PocV4TreeLayer {
  private batches = new BatchSet();

  constructor(
    private lib: ModelLibrary,
    private tileMeters: number,
  ) {}

  static models(): string[] {
    return [...TREE_MODELS];
  }

  update(map: MapView, occupied: Uint8Array) {
    this.batches.resetAll();
    for (const m of PocV4TreeLayer.models()) this.batches.get(m);
    const { width, trees } = map;

    for (let i = 0; i < trees.length; i++) {
      if (!trees[i] || occupied[i] || map.roads[i]) continue;
      const x = i % width;
      const y = (i - x) / width;
      const count = hash(i) < 0.45 ? 1 : 2;

      for (let k = 0; k < count; k++) {
        const h1 = hash(i * 7 + k * 13 + 1);
        const h2 = hash(i * 11 + k * 17 + 3);
        const model = TREE_MODELS[Math.floor(hash(i * 5 + k * 19) * TREE_MODELS.length)]!;
        const s = (0.8 + h1 * 0.4) / this.tileMeters;
        this.batches
          .get(model)
          .push(x + 0.18 + h1 * 0.64, 0, y + 0.18 + h2 * 0.64, h2 * Math.PI * 2, s, s, s);
      }
    }
    this.batches.applyAll((m) => this.lib.get(m).mesh);
  }
}

export class PocV4VehicleLayer {
  private batches = new BatchSet();

  constructor(
    private lib: ModelLibrary,
    private tileMeters: number,
  ) {}

  static models(): string[] {
    return [...CAR_MODELS, ...PEOPLE_MODELS];
  }

  update(v: VehiclesView) {
    this.batches.resetAll();
    for (const m of PocV4VehicleLayer.models()) this.batches.get(m);

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
        this.batches.get(model).push(x, sidewalkY, y, angle, personScale, personScale, personScale);
        continue;
      }

      const model = CAR_MODELS[type % CAR_MODELS.length]!;
      this.batches.get(model).push(x, roadY, y, angle, carScale, carScale, carScale);
    }
    this.batches.applyAll((m) => this.lib.get(m).mesh);
  }
}
