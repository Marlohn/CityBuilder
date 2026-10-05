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

const ROLE_COLORS: Record<SemanticRole, readonly (readonly [number, number, number])[]> = {
  wall: [
    [0.82, 0.36, 0.29],
    [0.29, 0.62, 0.65],
    [0.9, 0.67, 0.37],
    [0.49, 0.4, 0.67],
  ],
  roof: [
    [0.82, 0.84, 0.82],
    [0.67, 0.71, 0.72],
    [0.89, 0.82, 0.7],
  ],
  glass: [
    [0.25, 0.66, 0.75],
    [0.37, 0.73, 0.78],
  ],
  trim: [
    [0.93, 0.91, 0.82],
    [0.78, 0.79, 0.75],
  ],
  accent: [
    [0.96, 0.58, 0.25],
    [0.2, 0.68, 0.59],
    [0.88, 0.34, 0.3],
    [0.42, 0.48, 0.72],
  ],
  ground: [
    [0.49, 0.7, 0.38],
    [0.42, 0.64, 0.34],
  ],
  paving: [
    [0.7, 0.72, 0.69],
    [0.6, 0.63, 0.62],
  ],
  vegetation: [
    [0.2, 0.52, 0.26],
    [0.29, 0.62, 0.31],
    [0.16, 0.44, 0.23],
  ],
  road: [
    [0.19, 0.22, 0.24],
    [0.13, 0.15, 0.17],
  ],
};

function material(scene: Scene, name: string, role: SemanticRole, variant = 0): StandardMaterial {
  const variants = ROLE_COLORS[role];
  const base = variants[Math.abs(variant) % variants.length];
  const mat = new StandardMaterial(`poc-v3/${name}`, scene);
  mat.diffuseColor = new Color3(base[0], base[1], base[2]);
  mat.ambientColor = mat.diffuseColor.scale(0.15);
  mat.specularColor = role === "glass" ? new Color3(0.18, 0.18, 0.18) : new Color3(0.025, 0.025, 0.025);
  if (role === "glass") mat.alpha = 0.86;
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
      ssao = new SSAO2RenderingPipeline("poc-v3-ssao", scene, { ssaoRatio: 0.55, blurRatio: 0.75 }, [camera]);
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
    const container = await LoadAssetContainerAsync(`${this.baseUrl}/poc-v3/kenney/${name}.glb`, this.scene);
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

  private cylinder(
    name: string,
    role: SemanticRole,
    x: number,
    y: number,
    z: number,
    diameter: number,
    height: number,
    variant = 0,
  ) {
    const mesh = MeshBuilder.CreateCylinder(
      `poc-v3/hero/${name}`,
      { height: 1, diameter: 1, tessellation: 8 },
      this.scene,
    );
    mesh.position.set(x, y + height / 2, z);
    mesh.scaling.set(diameter, height, diameter);
    const mat = material(this.scene, `hero-${name}`, role, variant);
    mesh.material = mat;
    mesh.receiveShadows = true;
    this.shadows.addShadowCaster(mesh);
    this.meshes.push(mesh);
    this.materials.push(mat);
    return mesh;
  }

  private tree(x: number, z: number, variant: number, scale = 1) {
    this.cylinder(`tree-trunk-${variant}-${x}-${z}`, "trim", x, 0.1, z, 0.13 * scale, 0.62 * scale, variant);
    for (const [dx, dy, dz, crownScale] of [
      [0, 0, 0, 1],
      [-0.22, -0.08, 0.04, 0.72],
      [0.2, -0.03, 0.1, 0.68],
    ] as const) {
      const crown = MeshBuilder.CreateSphere(
        `poc-v3/hero/tree-${variant}-${x}-${z}-${dx}`,
        { diameter: 1, segments: 6 },
        this.scene,
      );
      crown.position.set(x + dx * scale, 0.96 * scale + dy * scale, z + dz * scale);
      crown.scaling.set(0.52 * scale * crownScale, 0.62 * scale * crownScale, 0.52 * scale * crownScale);
      const mat = material(this.scene, `tree-${variant}-${dx}`, "vegetation", variant);
      crown.material = mat;
      crown.receiveShadows = true;
      this.shadows.addShadowCaster(crown);
      this.meshes.push(crown);
      this.materials.push(mat);
    }
  }

  private shrub(name: string, x: number, z: number, variant: number) {
    const crown = MeshBuilder.CreateSphere(`poc-v3/hero/${name}`, { diameter: 1, segments: 6 }, this.scene);
    crown.position.set(x, 0.28, z);
    crown.scaling.set(0.34, 0.26, 0.34);
    const mat = material(this.scene, name, "vegetation", variant);
    crown.material = mat;
    crown.receiveShadows = true;
    this.shadows.addShadowCaster(crown);
    this.meshes.push(crown);
    this.materials.push(mat);
  }

  private streetLight(name: string, x: number, z: number, flip = false) {
    this.cylinder(`${name}-pole`, "trim", x, 0.1, z, 0.07, 0.95, 1);
    this.box(`${name}-arm`, "trim", x + (flip ? -0.14 : 0.14), 0.96, z, 0.32, 0.055, 0.055, 1);
    this.box(`${name}-lamp`, "accent", x + (flip ? -0.29 : 0.29), 0.9, z, 0.12, 0.08, 0.12, 0);
  }

  private person(name: string, x: number, z: number, variant: number) {
    this.box(`${name}-body`, "accent", x, 0.1, z, 0.13, 0.34, 0.13, variant);
    const head = MeshBuilder.CreateSphere(
      `poc-v3/hero/${name}-head`,
      { diameter: 0.15, segments: 6 },
      this.scene,
    );
    head.position.set(x, 0.54, z);
    const mat = material(this.scene, `${name}-head`, "trim", variant);
    head.material = mat;
    head.receiveShadows = true;
    this.shadows.addShadowCaster(head);
    this.meshes.push(head);
    this.materials.push(mat);
  }

  private car(name: string, x: number, z: number, variant: number, vertical = false) {
    const lengthX = vertical ? 0.34 : 0.72;
    const lengthZ = vertical ? 0.72 : 0.34;
    this.box(`${name}-body`, "accent", x, 0.08, z, lengthX, 0.22, lengthZ, variant);
    this.box(
      `${name}-cabin`,
      "glass",
      x,
      0.3,
      z,
      vertical ? 0.28 : 0.38,
      0.16,
      vertical ? 0.38 : 0.28,
      variant,
    );
    for (const [dx, dz] of vertical
      ? [
          [-0.2, -0.23],
          [0.2, -0.23],
          [-0.2, 0.23],
          [0.2, 0.23],
        ]
      : [
          [-0.23, -0.2],
          [0.23, -0.2],
          [-0.23, 0.2],
          [0.23, 0.2],
        ]) {
      this.box(`${name}-wheel-${dx}-${dz}`, "road", x + dx, 0.055, z + dz, 0.12, 0.1, 0.08, 1);
    }
  }

  private window(id: string, x: number, y: number, z: number, width: number, variant: number, side = false) {
    if (side) {
      this.box(`${id}-frame`, "trim", x, y, z, 0.055, 0.37, width + 0.1, variant);
      this.box(`${id}-glass`, "glass", x + 0.03, y + 0.04, z, 0.035, 0.29, width, variant);
      return;
    }
    this.box(`${id}-frame`, "trim", x, y, z, width + 0.1, 0.37, 0.055, variant);
    this.box(`${id}-glass`, "glass", x, y + 0.04, z - 0.03, width, 0.29, 0.035, variant);
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
    const baseY = 0.12;
    this.box(`${id}-foundation`, "trim", x, baseY, z, w + 0.08, 0.12, d + 0.08, variant);
    this.box(`${id}-wall`, "wall", x, baseY + 0.12, z, w, h, d, variant);
    this.box(`${id}-roof`, "roof", x, baseY + 0.12 + h, z, w + 0.16, 0.16, d + 0.16, variant);
    this.box(`${id}-roof-cap`, "trim", x, baseY + 0.28 + h, z, w + 0.02, 0.06, d + 0.02, variant);

    const floors = Math.max(1, Math.round(h / 0.72));
    const columns = w > 2.55 ? 3 : 2;
    const windowWidth = columns === 3 ? 0.34 : 0.42;
    for (let floor = commerce ? 1 : 0; floor < floors; floor++) {
      const windowY = baseY + 0.38 + floor * 0.66;
      for (let column = 0; column < columns; column++) {
        const windowX = x + ((column + 1) / (columns + 1) - 0.5) * w * 0.78;
        this.window(
          `${id}-front-${floor}-${column}`,
          windowX,
          windowY,
          z - d / 2 - 0.035,
          windowWidth,
          variant + column,
        );
      }
      this.window(
        `${id}-side-${floor}`,
        x + w / 2 + 0.035,
        windowY,
        z,
        Math.min(0.42, d * 0.24),
        variant + floor,
        true,
      );
    }

    if (commerce) {
      this.box(
        `${id}-storefront-frame`,
        "trim",
        x,
        baseY + 0.21,
        z - d / 2 - 0.04,
        w * 0.76,
        0.58,
        0.07,
        variant,
      );
      this.box(
        `${id}-storefront`,
        "glass",
        x,
        baseY + 0.26,
        z - d / 2 - 0.08,
        w * 0.68,
        0.46,
        0.035,
        variant,
      );
      this.box(`${id}-awning`, "accent", x, baseY + 0.82, z - d / 2 - 0.18, w * 0.72, 0.12, 0.34, variant);
      this.box(`${id}-sign`, "accent", x, baseY + 1.03, z - d / 2 - 0.075, w * 0.42, 0.2, 0.05, variant + 1);
    } else {
      this.box(
        `${id}-door-frame`,
        "trim",
        x + w * 0.22,
        baseY + 0.12,
        z - d / 2 - 0.04,
        0.5,
        0.7,
        0.07,
        variant,
      );
      this.box(
        `${id}-door`,
        "accent",
        x + w * 0.22,
        baseY + 0.17,
        z - d / 2 - 0.08,
        0.38,
        0.58,
        0.035,
        variant,
      );
      this.box(`${id}-canopy`, "roof", x + w * 0.22, baseY + 0.86, z - d / 2 - 0.18, 0.7, 0.1, 0.34, variant);
    }

    if (h > 2) {
      this.box(`${id}-roof-unit-a`, "trim", x - 0.5, baseY + h + 0.35, z, 0.55, 0.28, 0.48, 1);
      this.box(`${id}-roof-unit-b`, "trim", x + 0.34, baseY + h + 0.35, z + 0.18, 0.38, 0.22, 0.36, 0);
    }
  }

  private buildHero() {
    this.box("ground", "ground", 64, -0.16, 64, 15, 0.16, 12);

    this.box("road-main", "road", 64, 0, 64, 15, 0.04, 1.8);
    this.box("road-side", "road", 64, 0, 64, 1.8, 0.04, 12);

    for (const [name, x, z, sx, sz] of [
      ["sidewalk-n", 64, 62.78, 15, 0.58],
      ["sidewalk-s", 64, 65.22, 15, 0.58],
      ["sidewalk-w", 62.78, 64, 0.58, 12],
      ["sidewalk-e", 65.22, 64, 0.58, 12],
    ] as const) {
      this.box(name, "paving", x, 0.04, z, sx, 0.07, sz);
    }

    for (const [name, x, z, sx, sz] of [
      ["curb-n", 64, 63.1, 15, 0.1],
      ["curb-s", 64, 64.9, 15, 0.1],
      ["curb-w", 63.1, 64, 0.1, 12],
      ["curb-e", 64.9, 64, 0.1, 12],
    ] as const) {
      this.box(name, "trim", x, 0.04, z, sx, 0.12, sz, 1);
    }

    for (let x = 57.2; x <= 70.8; x += 1.25) {
      if (x > 62.6 && x < 65.4) continue;
      this.box(`lane-main-${x}`, "trim", x, 0.041, 64, 0.58, 0.018, 0.06, 1);
    }
    for (let z = 58.8; z <= 69.2; z += 1.25) {
      if (z > 62.6 && z < 65.4) continue;
      this.box(`lane-side-${z}`, "trim", 64, 0.041, z, 0.06, 0.018, 0.58, 1);
    }

    for (let i = -3; i <= 3; i++) {
      this.box(`crosswalk-n-${i}`, "trim", 64 + i * 0.2, 0.043, 63.45, 0.1, 0.018, 0.5);
      this.box(`crosswalk-s-${i}`, "trim", 64 + i * 0.2, 0.043, 64.55, 0.1, 0.018, 0.5);
      this.box(`crosswalk-w-${i}`, "trim", 63.45, 0.043, 64 + i * 0.2, 0.5, 0.018, 0.1);
      this.box(`crosswalk-e-${i}`, "trim", 64.55, 0.043, 64 + i * 0.2, 0.5, 0.018, 0.1);
    }

    this.building("house-a", 59.4, 60.6, 2.35, 2.15, 1.45, 0);
    this.building("house-b", 68.4, 60.5, 2.25, 2.05, 1.5, 1);
    this.building("shop", 59.35, 67.2, 2.85, 2.15, 1.65, 2, true);
    this.building("midrise", 68.35, 67.0, 2.85, 2.45, 3.1, 3, true);

    for (const [name, x, z, sx, sz, variant] of [
      ["yard-a", 59.4, 62.15, 2.9, 0.18, 0],
      ["yard-b", 68.4, 62.05, 2.8, 0.18, 1],
      ["shop-hedge", 57.75, 67.25, 0.18, 2.4, 2],
    ] as const) {
      this.box(name, "vegetation", x, 0.08, z, sx, 0.22, sz, variant);
    }

    this.box("path-house-a", "paving", 60.0, 0.03, 62.0, 0.65, 0.055, 1.4, 1);
    this.box("path-house-b", "paving", 68.9, 0.03, 62.0, 0.65, 0.055, 1.45);
    this.box("path-shop", "paving", 60.0, 0.03, 65.95, 0.78, 0.055, 1.3);

    this.box("parking", "paving", 66.1, 0.03, 68.55, 2.2, 0.065, 1.55, 1);
    for (let i = 0; i < 3; i++) {
      const x = 65.38 + i * 0.7;
      this.box(`park-line-${i}`, "trim", x, 0.098, 68.55, 0.035, 0.015, 1.3, 1);
    }
    this.car("parked-a", 65.7, 68.45, 0, true);
    this.car("parked-b", 66.45, 68.6, 1, true);
    this.car("traffic-a", 61.4, 64.28, 2);
    this.car("traffic-b", 64.28, 60.0, 3, true);

    this.box("plaza", "paving", 61.45, 0.03, 68.2, 2.3, 0.07, 2.0);
    this.cylinder("fountain-base", "trim", 61.35, 0.1, 68.15, 0.92, 0.2, 1);
    this.cylinder("fountain-water", "glass", 61.35, 0.3, 68.15, 0.7, 0.08, 0);
    this.cylinder("fountain-center", "trim", 61.35, 0.38, 68.15, 0.16, 0.45, 1);
    this.box("bench-a", "trim", 60.4, 0.1, 67.5, 0.72, 0.18, 0.2, 0);
    this.box("bench-b", "trim", 62.2, 0.1, 68.85, 0.72, 0.18, 0.2, 1);
    this.box("planter-a", "accent", 60.45, 0.08, 68.85, 0.62, 0.24, 0.62, 1);
    this.box("planter-b", "accent", 62.25, 0.08, 67.48, 0.62, 0.24, 0.62, 0);

    for (const [x, z, v, scale] of [
      [57.8, 61.8, 0, 0.95],
      [60.9, 61.9, 1, 0.9],
      [67.0, 61.8, 2, 0.95],
      [70.3, 61.8, 0, 0.88],
      [57.6, 68.8, 1, 0.9],
      [62.5, 69.0, 2, 0.88],
      [70.4, 68.7, 1, 1.0],
      [69.9, 65.7, 2, 0.82],
    ] as const) {
      this.tree(x, z, v, scale);
    }

    for (const [name, x, z, variant] of [
      ["shrub-a", 58.2, 59.3, 0],
      ["shrub-b", 60.5, 59.4, 1],
      ["shrub-c", 67.2, 59.2, 2],
      ["shrub-d", 69.6, 59.3, 0],
      ["shrub-e", 60.45, 68.85, 1],
      ["shrub-f", 62.25, 67.48, 2],
    ] as const) {
      this.shrub(name, x, z, variant);
    }

    for (const [name, x, z, flip] of [
      ["light-nw", 62.65, 62.5, false],
      ["light-ne", 65.35, 62.5, true],
      ["light-sw", 62.65, 65.5, false],
      ["light-se", 65.35, 65.5, true],
      ["light-plaza", 62.35, 67.2, true],
    ] as const) {
      this.streetLight(name, x, z, flip);
    }

    for (const [name, x, z, variant] of [
      ["person-a", 62.6, 62.55, 0],
      ["person-b", 65.4, 65.45, 1],
      ["person-c", 60.8, 67.35, 2],
      ["person-d", 61.9, 68.65, 3],
      ["person-e", 67.0, 65.5, 0],
      ["person-f", 68.9, 65.55, 1],
    ] as const) {
      this.person(name, x, z, variant);
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
