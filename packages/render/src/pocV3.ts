import {
  Color3,
  Color4,
  ImageProcessingConfiguration,
  LoadAssetContainerAsync,
  type Mesh,
  MeshBuilder,
  type Scene,
  type ShadowGenerator,
  SSAO2RenderingPipeline,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { MapView } from "@city/contract";
import { BatchSet } from "./instances";

export type PocV3Scene = "kenney" | "hero" | "live";
export type PocV3CameraMode = "orthographic" | "perspective";

type SemanticRole =
  | "wall"
  | "roof"
  | "glass"
  | "trim"
  | "accent"
  | "ground"
  | "paving"
  | "vegetation"
  | "road";

const ROLE_COLORS: Record<SemanticRole, readonly [number, number, number]> = {
  wall: [0.91, 0.78, 0.65],
  roof: [0.54, 0.25, 0.22],
  glass: [0.35, 0.68, 0.76],
  trim: [0.93, 0.91, 0.82],
  accent: [0.91, 0.52, 0.33],
  ground: [0.53, 0.68, 0.36],
  paving: [0.72, 0.73, 0.68],
  vegetation: [0.27, 0.52, 0.25],
  road: [0.28, 0.31, 0.32],
};

const rgb = (c: readonly [number, number, number]) => new Color3(c[0], c[1], c[2]);

function material(scene: Scene, name: string, role: SemanticRole, variant = 0): StandardMaterial {
  const base = ROLE_COLORS[role];
  const shift = variant === 0 ? 0 : ((variant % 3) - 1) * 0.045;
  const mat = new StandardMaterial(`poc-v3/${name}`, scene);
  mat.diffuseColor = new Color3(
    Math.max(0, Math.min(1, base[0] + shift)),
    Math.max(0, Math.min(1, base[1] + shift)),
    Math.max(0, Math.min(1, base[2] + shift)),
  );
  mat.ambientColor = mat.diffuseColor.scale(0.15);
  mat.specularColor = role === "glass" ? new Color3(0.18, 0.18, 0.18) : new Color3(0.025, 0.025, 0.025);
  if (role === "glass") mat.alpha = 0.82;
  return mat;
}

/** Pipeline visual experimental centralizada. Não altera simulação nem contrato. */
export class PocV3Environment {
  readonly ssao: SSAO2RenderingPipeline | null;

  constructor(
    scene: Scene,
    camera: import("@babylonjs/core").Camera,
    private shadows: ShadowGenerator,
  ) {
    scene.clearColor = new Color4(0.76, 0.82, 0.85, 1);
    scene.ambientColor = new Color3(0.55, 0.57, 0.58);

    const image = scene.imageProcessingConfiguration;
    image.toneMappingEnabled = true;
    image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    image.exposure = 1.08;
    image.contrast = 1.07;

    shadows.usePercentageCloserFiltering = true;
    shadows.darkness = 0.24;
    shadows.bias = 0.001;

    let ssao: SSAO2RenderingPipeline | null = null;
    if (SSAO2RenderingPipeline.IsSupported) {
      ssao = new SSAO2RenderingPipeline(
        "poc-v3-ssao",
        scene,
        { ssaoRatio: 0.55, blurRatio: 0.75 },
        [camera],
      );
      ssao.radius = 1.25;
      ssao.totalStrength = 0.72;
      ssao.base = 0.08;
      ssao.samples = 12;
      ssao.bilateralSamples = 12;
      ssao.bilateralSoften = 0.55;
    }
    this.ssao = ssao;
  }

  state() {
    return {
      toneMapping: "ACES",
      exposure: 1.08,
      contrast: 1.07,
      ssao: this.ssao !== null,
      shadowDarkness: this.shadows.darkness,
    };
  }

  dispose() {
    this.ssao?.dispose();
  }
}

/** Cenas estáticas controladas: benchmark Kenney e hero block sem dependência da simulação. */
export class PocV3Showcase {
  private roots: TransformNode[] = [];
  private meshes: Mesh[] = [];
  private materials: StandardMaterial[] = [];

  constructor(
    private scene: Scene,
    private shadows: ShadowGenerator,
    private baseUrl: string,
  ) {}

  async build(kind: Exclude<PocV3Scene, "live">) {
    if (kind === "kenney") await this.buildKenney();
    else this.buildHero();
  }

  private async addKenney(
    name: "building-small-a" | "building-small-b" | "road-straight" | "pavement" | "grass-trees",
    x: number,
    z: number,
    rotY = 0,
  ) {
    const container = await LoadAssetContainerAsync(
      `${this.baseUrl}/poc-v3/kenney/${name}.glb`,
      this.scene,
    );
    container.addAllToScene();
    const root = new TransformNode(`poc-v3/kenney/${name}/${this.roots.length}`, this.scene);
    root.position.set(x, 0, z);
    root.rotation.y = rotY;
    for (const node of container.rootNodes) node.parent = root;
    for (const mesh of container.meshes) {
      mesh.receiveShadows = true;
      this.shadows.addShadowCaster(mesh);
    }
    this.roots.push(root);
  }

  private async buildKenney() {
    const jobs: Promise<void>[] = [];
    for (let z = 61; z <= 67; z++) jobs.push(this.addKenney("road-straight", 64, z));
    for (const x of [62, 66]) {
      for (const z of [61, 63, 65, 67]) {
        jobs.push(this.addKenney("pavement", x, z));
      }
    }
    jobs.push(this.addKenney("building-small-a", 62, 62, Math.PI / 2));
    jobs.push(this.addKenney("building-small-b", 66, 62, -Math.PI / 2));
    jobs.push(this.addKenney("building-small-b", 62, 66, Math.PI / 2));
    jobs.push(this.addKenney("building-small-a", 66, 66, -Math.PI / 2));
    jobs.push(this.addKenney("grass-trees", 60.5, 60.5));
    jobs.push(this.addKenney("grass-trees", 67.5, 68));
    await Promise.all(jobs);
  }

  private box(
    name: string,
    role: SemanticRole,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    variant = 0,
  ) {
    const mesh = MeshBuilder.CreateBox(`poc-v3/hero/${name}`, { size: 1 }, this.scene);
    mesh.position.set(x, y + sy / 2, z);
    mesh.scaling.set(sx, sy, sz);
    const mat = material(this.scene, `hero-${name}`, role, variant);
    mesh.material = mat;
    mesh.receiveShadows = true;
    this.shadows.addShadowCaster(mesh);
    this.meshes.push(mesh);
    this.materials.push(mat);
    return mesh;
  }

  private tree(x: number, z: number, variant: number) {
    this.box(`tree-trunk-${variant}-${x}-${z}`, "trim", x, 0.02, z, 0.12, 0.7, 0.12, variant);
    const crown = MeshBuilder.CreateSphere(
      `poc-v3/hero/tree-${variant}-${x}-${z}`,
      { diameter: 1, segments: 7 },
      this.scene,
    );
    crown.position.set(x, 0.93, z);
    crown.scaling.set(0.58, 0.68, 0.58);
    const mat = material(this.scene, `tree-${variant}`, "vegetation", variant);
    crown.material = mat;
    crown.receiveShadows = true;
    this.shadows.addShadowCaster(crown);
    this.meshes.push(crown);
    this.materials.push(mat);
  }

  private building(
    id: string,
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    variant: number,
    commerce = false,
  ) {
    this.box(`${id}-wall`, "wall", x, 0.06, z, w, h, d, variant);
    this.box(`${id}-roof`, "roof", x, 0.06 + h, z, w + 0.08, 0.16, d + 0.08, variant);
    this.box(`${id}-glass`, "glass", x, 0.38, z - d / 2 - 0.012, w * 0.48, h * 0.32, 0.025, variant);
    this.box(`${id}-trim`, "trim", x, 0.08, z - d / 2 - 0.025, w * 0.7, 0.09, 0.045, variant);
    if (commerce)
      this.box(`${id}-accent`, "accent", x, 0.78, z - d / 2 - 0.035, w * 0.62, 0.16, 0.05, variant);
  }

  private buildHero() {
    this.box("ground", "ground", 64, -0.08, 64, 15, 0.16, 12);
    this.box("road-main", "road", 64, 0, 64, 15, 0.035, 1.35);
    this.box("road-side", "road", 64, 0, 64, 1.35, 0.04, 12);
    this.box("paving-n", "paving", 64, 0.02, 62.95, 15, 0.06, 0.65);
    this.box("paving-s", "paving", 64, 0.02, 65.05, 15, 0.06, 0.65);
    this.box("paving-w", "paving", 62.95, 0.025, 64, 0.65, 0.06, 12);
    this.box("paving-e", "paving", 65.05, 0.025, 64, 0.65, 0.06, 12);

    this.building("house-a", 59.7, 60.8, 2.25, 2.25, 1.35, 0);
    this.building("house-b", 68.3, 60.9, 2.15, 2.15, 1.28, 1);
    this.building("shop", 59.7, 67.25, 2.65, 2.0, 1.55, 2, true);
    this.building("midrise", 68.2, 67.0, 2.75, 2.35, 3.05, 1, true);

    this.box("parking", "paving", 64.9, 0.025, 68.1, 3.0, 0.065, 2.15);
    for (let i = 0; i < 3; i++) {
      const x = 63.95 + i * 0.85;
      this.box(`park-line-${i}`, "trim", x, 0.065, 68.1, 0.035, 0.015, 1.65);
      this.box(`car-${i}`, "accent", x + 0.25, 0.08, 67.95 + (i % 2) * 0.24, 0.55, 0.28, 0.3, i);
    }

    this.box("plaza", "paving", 61.75, 0.025, 68.0, 2.0, 0.06, 2.0);
    this.box("planter-a", "accent", 61.2, 0.07, 68.3, 0.65, 0.22, 0.65);
    this.box("bench", "trim", 62.25, 0.08, 67.65, 0.75, 0.2, 0.2);
    for (const [x, z, v] of [
      [58.3, 63.0, 0],
      [60.9, 63.0, 1],
      [67.0, 63.0, 2],
      [69.7, 63.0, 0],
      [61.2, 68.3, 1],
      [70.2, 68.4, 2],
    ] as const)
      this.tree(x, z, v);

    for (let i = 0; i < 5; i++) {
      const x = 62.8 + i * 0.55;
      this.box(`person-${i}`, i % 2 ? "accent" : "trim", x, 0.06, 62.65, 0.12, 0.38, 0.12, i);
    }
  }

  dispose() {
    for (const root of this.roots) root.dispose();
    for (const mesh of this.meshes) mesh.dispose();
    for (const mat of this.materials) mat.dispose();
  }
}

/** Superfície urbana derivada da vizinhança do mapa, somente para a cena live da POC. */
export class PocV3LiveSurface {
  private batches = new BatchSet();
  private meshes = new Map<string, Mesh>();
  private materials: StandardMaterial[] = [];

  constructor(private scene: Scene) {
    this.addBox("paving", "paving");
    this.addBox("curb", "trim");
  }

  update(map: MapView, occupied: Uint8Array) {
    this.batches.resetAll();
    this.batches.get("paving");
    this.batches.get("curb");
    const paved = new Set<number>();
    const { width, height, roads } = map;
    const isRoad = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < width && y < height && !!roads[y * width + x];
    const canPave = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const i = y * width + x;
      return !roads[i] && !map.water?.[i] && !occupied[i];
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isRoad(x, y)) continue;
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (!canPave(nx, ny)) continue;
          const ni = ny * width + nx;
          if (!paved.has(ni)) {
            paved.add(ni);
            this.batches.get("paving").push(nx + 0.5, 0.018, ny + 0.5, 0, 1.02, 0.035, 1.02);
          }
          const edgeX = x + 0.5 + dx * 0.5;
          const edgeZ = y + 0.5 + dy * 0.5;
          const alongX = dy !== 0;
          this.batches
            .get("curb")
            .push(edgeX, 0.055, edgeZ, 0, alongX ? 1.02 : 0.08, 0.08, alongX ? 0.08 : 1.02);
        }
      }
    }
    this.batches.applyAll((key) => {
      const mesh = this.meshes.get(key);
      if (!mesh) throw new Error(`malha POC v3 inexistente: ${key}`);
      return mesh;
    });
  }

  private addBox(name: string, role: SemanticRole) {
    const mesh = MeshBuilder.CreateBox(`poc-v3/live/${name}`, { size: 1 }, this.scene);
    const mat = material(this.scene, `live-${name}`, role);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.thinInstanceCount = 0;
    this.meshes.set(name, mesh);
    this.materials.push(mat);
  }

  dispose() {
    for (const mesh of this.meshes.values()) mesh.dispose();
    for (const mat of this.materials) mat.dispose();
  }
}

export const POC_V3_CENTER = new Vector3(64, 0, 64);
