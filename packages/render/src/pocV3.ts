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

  private boxRotated(
    name: string,
    role: SemanticRole,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rx: number,
    ry: number,
    rz: number,
    variant = 0,
  ) {
    const mesh = this.box(name, role, x, y, z, sx, sy, sz, variant);
    mesh.rotation.set(rx, ry, rz);
    return mesh;
  }

  private balcony(name: string, x: number, y: number, z: number, width: number, variant: number) {
    this.box(`${name}-slab`, "trim", x, y, z, width, 0.08, 0.38, variant);
    this.box(`${name}-rail-front`, "trim", x, y + 0.16, z - 0.17, width, 0.05, 0.035, variant);
    this.box(`${name}-rail-left`, "trim", x - width / 2 + 0.03, y + 0.16, z, 0.035, 0.27, 0.34, variant);
    this.box(`${name}-rail-right`, "trim", x + width / 2 - 0.03, y + 0.16, z, 0.035, 0.27, 0.34, variant);
  }

  private planter(name: string, x: number, z: number, width: number, depth: number, variant: number) {
    this.box(`${name}-bed`, "accent", x, 0.08, z, width, 0.2, depth, variant);
    for (let i = 0; i < Math.max(2, Math.round(width / 0.34)); i++) {
      const px = x - width * 0.38 + (i / Math.max(1, Math.round(width / 0.34) - 1)) * width * 0.76;
      this.shrub(`${name}-shrub-${i}`, px, z, variant + i);
    }
  }

  private bollard(name: string, x: number, z: number, variant = 1) {
    this.cylinder(name, "trim", x, 0.06, z, 0.07, 0.38, variant);
  }

  private cafeSet(name: string, x: number, z: number, variant: number) {
    this.cylinder(`${name}-table`, "trim", x, 0.08, z, 0.42, 0.09, 0);
    this.cylinder(`${name}-umbrella-pole`, "trim", x, 0.15, z, 0.045, 0.82, 1);
    const shade = MeshBuilder.CreateCylinder(
      `poc-v3/hero/${name}-umbrella`,
      { height: 0.08, diameterTop: 0.12, diameterBottom: 1.05, tessellation: 8 },
      this.scene,
    );
    shade.position.set(x, 1.0, z);
    const mat = material(this.scene, `${name}-umbrella`, "accent", variant);
    shade.material = mat;
    shade.receiveShadows = true;
    this.shadows.addShadowCaster(shade);
    this.meshes.push(shade);
    this.materials.push(mat);
    for (const [dx, dz] of [
      [-0.42, 0],
      [0.42, 0],
      [0, -0.42],
      [0, 0.42],
    ] as const) {
      this.box(`${name}-chair-${dx}-${dz}`, "trim", x + dx, 0.08, z + dz, 0.18, 0.26, 0.18, variant);
    }
  }

  private bikeRack(name: string, x: number, z: number) {
    for (let i = 0; i < 3; i++) {
      const bx = x + i * 0.22;
      this.box(`${name}-post-a-${i}`, "trim", bx, 0.06, z - 0.1, 0.035, 0.34, 0.035, 1);
      this.box(`${name}-post-b-${i}`, "trim", bx, 0.06, z + 0.1, 0.035, 0.34, 0.035, 1);
      this.box(`${name}-bar-${i}`, "trim", bx, 0.35, z, 0.035, 0.035, 0.24, 1);
    }
  }

  private roofGarden(name: string, x: number, y: number, z: number, w: number, d: number, variant: number) {
    this.box(`${name}-deck`, "paving", x, y, z, w * 0.72, 0.07, d * 0.64, 1);
    this.planter(`${name}-planter-a`, x - w * 0.23, z, w * 0.16, d * 0.5, variant);
    this.planter(`${name}-planter-b`, x + w * 0.23, z, w * 0.16, d * 0.5, variant + 1);
    this.box(`${name}-pergola-a`, "trim", x - w * 0.2, y + 0.05, z - d * 0.22, 0.06, 0.58, 0.06, 1);
    this.box(`${name}-pergola-b`, "trim", x + w * 0.2, y + 0.05, z - d * 0.22, 0.06, 0.58, 0.06, 1);
    this.box(`${name}-pergola-top`, "trim", x, y + 0.58, z - d * 0.22, w * 0.48, 0.06, 0.12, 1);
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
    this.box(`${id}-foundation`, "trim", x, baseY, z, w + 0.1, 0.12, d + 0.1, variant);
    this.box(`${id}-wall`, "wall", x, baseY + 0.12, z, w, h, d, variant);

    this.box(`${id}-corner-left`, "trim", x - w / 2 + 0.06, baseY + 0.12, z - d / 2 - 0.035, 0.11, h, 0.07, 1);
    this.box(`${id}-corner-right`, "trim", x + w / 2 - 0.06, baseY + 0.12, z - d / 2 - 0.035, 0.11, h, 0.07, 1);

    const floors = Math.max(1, Math.round(h / 0.68));
    const columns = w >= 2.7 ? 4 : w >= 2.1 ? 3 : 2;
    const windowWidth = columns >= 4 ? 0.3 : 0.36;

    for (let floor = 0; floor < floors; floor++) {
      const windowY = baseY + 0.34 + floor * 0.63;
      this.box(`${id}-band-${floor}`, "trim", x, windowY + 0.34, z - d / 2 - 0.035, w * 0.9, 0.045, 0.05, 1);

      if (!(commerce && floor === 0)) {
        for (let column = 0; column < columns; column++) {
          const windowX = x + ((column + 1) / (columns + 1) - 0.5) * w * 0.82;
          this.window(
            `${id}-front-${floor}-${column}`,
            windowX,
            windowY,
            z - d / 2 - 0.04,
            windowWidth,
            variant + column + floor,
          );
          this.box(
            `${id}-sill-${floor}-${column}`,
            "trim",
            windowX,
            windowY - 0.03,
            z - d / 2 - 0.085,
            windowWidth + 0.08,
            0.05,
            0.1,
            1,
          );
        }
      }

      for (const side of [-1, 1] as const) {
        const sideX = x + side * (w / 2 + 0.035);
        const sideZ = z + (floor % 2 === 0 ? -0.27 : 0.27);
        this.window(
          `${id}-side-${floor}-${side}`,
          sideX,
          windowY,
          sideZ,
          Math.min(0.38, d * 0.22),
          variant + floor + side,
          true,
        );
      }

      if (!commerce && floor > 0 && (floor + variant) % 2 === 0) {
        this.balcony(
          `${id}-balcony-${floor}`,
          x,
          windowY - 0.08,
          z - d / 2 - 0.26,
          Math.min(w * 0.62, 1.65),
          variant + floor,
        );
      }
    }

    if (commerce) {
      this.box(
        `${id}-storefront-frame`,
        "trim",
        x,
        baseY + 0.18,
        z - d / 2 - 0.05,
        w * 0.84,
        0.61,
        0.08,
        1,
      );
      for (const offset of [-0.26, 0.26]) {
        this.box(
          `${id}-storefront-${offset}`,
          "glass",
          x + offset * w,
          baseY + 0.23,
          z - d / 2 - 0.095,
          w * 0.34,
          0.48,
          0.04,
          variant,
        );
      }
      this.box(
        `${id}-door`,
        "accent",
        x,
        baseY + 0.18,
        z - d / 2 - 0.1,
        0.42,
        0.55,
        0.04,
        variant + 1,
      );
      this.box(
        `${id}-awning`,
        "accent",
        x,
        baseY + 0.82,
        z - d / 2 - 0.22,
        w * 0.82,
        0.12,
        0.38,
        variant,
      );
      this.box(
        `${id}-sign`,
        "accent",
        x,
        baseY + 1.08,
        z - d / 2 - 0.085,
        w * 0.48,
        0.22,
        0.05,
        variant + 2,
      );
    } else {
      this.box(
        `${id}-door-frame`,
        "trim",
        x + w * 0.26,
        baseY + 0.12,
        z - d / 2 - 0.05,
        0.52,
        0.72,
        0.08,
        1,
      );
      this.box(
        `${id}-door`,
        "accent",
        x + w * 0.26,
        baseY + 0.17,
        z - d / 2 - 0.095,
        0.38,
        0.58,
        0.04,
        variant,
      );
      this.box(
        `${id}-canopy`,
        "roof",
        x + w * 0.26,
        baseY + 0.88,
        z - d / 2 - 0.2,
        0.72,
        0.1,
        0.36,
        variant,
      );
    }

    const roofY = baseY + h + 0.24;
    this.box(`${id}-roof`, "roof", x, baseY + 0.12 + h, z, w + 0.12, 0.14, d + 0.12, variant);
    for (const [name, rx, rz, sx, sz] of [
      ["front", 0, -d / 2 + 0.05, w - 0.08, 0.08],
      ["back", 0, d / 2 - 0.05, w - 0.08, 0.08],
      ["left", -w / 2 + 0.05, 0, 0.08, d - 0.08],
      ["right", w / 2 - 0.05, 0, 0.08, d - 0.08],
    ] as const) {
      this.box(`${id}-parapet-${name}`, "trim", x + rx, roofY, z + rz, sx, 0.2, sz, 1);
    }

    if (h > 2.1) {
      this.box(`${id}-roof-unit-a`, "trim", x - 0.48, roofY + 0.14, z + 0.12, 0.5, 0.3, 0.44, 1);
      this.box(`${id}-roof-unit-b`, "trim", x + 0.38, roofY + 0.14, z + 0.16, 0.34, 0.24, 0.34, 0);
      if (variant % 2 === 1) this.roofGarden(id, x, roofY + 0.1, z, w, d, variant);
    }
  }

  private steppedBuilding(id: string, x: number, z: number, variant: number) {
    this.building(`${id}-base`, x, z, 3.15, 2.55, 2.2, variant, true);
    this.box(`${id}-upper-wall`, "wall", x + 0.24, 2.42, z + 0.08, 2.18, 1.35, 1.7, variant + 1);
    this.box(`${id}-upper-roof`, "roof", x + 0.24, 3.77, z + 0.08, 2.3, 0.14, 1.82, variant + 1);
    for (let floor = 0; floor < 2; floor++) {
      for (let column = 0; column < 3; column++) {
        const wx = x - 0.42 + column * 0.66;
        const wy = 2.68 + floor * 0.58;
        this.window(`${id}-upper-${floor}-${column}`, wx, wy, z - 0.81, 0.3, variant + floor + column);
      }
    }
    this.balcony(`${id}-upper-balcony`, x + 0.24, 3.13, z - 0.98, 1.5, variant);
    this.planter(`${id}-roof-planter`, x + 0.15, z + 0.16, 0.9, 0.42, variant);
  }

  private rowHouse(id: string, x: number, z: number, variant: number) {
    this.building(id, x, z, 1.72, 1.9, 1.72, variant, false);
    this.boxRotated(`${id}-roof-left`, "roof", x - 0.41, 1.96, z, 0.98, 0.12, 2.0, 0, 0, 0.32, variant);
    this.boxRotated(`${id}-roof-right`, "roof", x + 0.41, 1.96, z, 0.98, 0.12, 2.0, 0, 0, -0.32, variant);
  }

  private buildHero() {
    this.box("ground", "ground", 64, -0.16, 64, 15.4, 0.16, 12.4);

    this.box("road-main", "road", 64, 0, 64, 15.4, 0.04, 1.82);
    this.box("road-side", "road", 64, 0, 64, 1.82, 0.04, 12.4);

    for (const [name, x, z, sx, sz] of [
      ["sidewalk-n", 64, 62.77, 15.4, 0.6],
      ["sidewalk-s", 64, 65.23, 15.4, 0.6],
      ["sidewalk-w", 62.77, 64, 0.6, 12.4],
      ["sidewalk-e", 65.23, 64, 0.6, 12.4],
    ] as const) {
      this.box(name, "paving", x, 0.04, z, sx, 0.07, sz);
    }

    for (const [name, x, z, sx, sz] of [
      ["curb-n", 64, 63.1, 15.4, 0.1],
      ["curb-s", 64, 64.9, 15.4, 0.1],
      ["curb-w", 63.1, 64, 0.1, 12.4],
      ["curb-e", 64.9, 64, 0.1, 12.4],
    ] as const) {
      this.box(name, "trim", x, 0.04, z, sx, 0.12, sz, 1);
    }

    for (let x = 56.9; x <= 71.1; x += 1.1) {
      if (x > 62.55 && x < 65.45) continue;
      this.box(`lane-main-${x}`, "trim", x, 0.041, 64, 0.52, 0.018, 0.06, 1);
    }
    for (let z = 58.4; z <= 69.6; z += 1.1) {
      if (z > 62.55 && z < 65.45) continue;
      this.box(`lane-side-${z}`, "trim", 64, 0.041, z, 0.06, 0.018, 0.52, 1);
    }

    for (let i = -3; i <= 3; i++) {
      this.box(`crosswalk-n-${i}`, "trim", 64 + i * 0.2, 0.043, 63.45, 0.1, 0.018, 0.52);
      this.box(`crosswalk-s-${i}`, "trim", 64 + i * 0.2, 0.043, 64.55, 0.1, 0.018, 0.52);
      this.box(`crosswalk-w-${i}`, "trim", 63.45, 0.043, 64 + i * 0.2, 0.52, 0.018, 0.1);
      this.box(`crosswalk-e-${i}`, "trim", 64.55, 0.043, 64 + i * 0.2, 0.52, 0.018, 0.1);
    }

    // North-west: dense row houses plus a corner cafe facing the intersection.
    this.rowHouse("row-a", 57.75, 59.55, 0);
    this.rowHouse("row-b", 59.6, 59.55, 1);
    this.rowHouse("row-c", 61.45, 59.55, 2);
    this.building("corner-cafe", 60.4, 61.55, 2.95, 1.7, 1.72, 3, true);
    this.box("cafe-terrace", "paving", 58.15, 0.03, 61.55, 1.35, 0.06, 1.45, 1);
    this.cafeSet("cafe-table-a", 57.82, 61.3, 0);
    this.cafeSet("cafe-table-b", 58.42, 61.75, 2);
    this.planter("cafe-planter", 57.15, 61.55, 0.26, 1.18, 1);
    this.bikeRack("cafe-bikes", 61.95, 62.45);

    // North-east: colorful residences with a tiny shared garden.
    this.building("residence-a", 66.55, 60.15, 2.2, 2.15, 2.2, 1, false);
    this.building("residence-b", 69.05, 60.15, 2.35, 2.15, 1.55, 2, false);
    this.building("residence-c", 70.0, 62.05, 1.65, 1.4, 1.45, 0, false);
    this.box("garden-path", "paving", 66.95, 0.03, 62.05, 2.8, 0.055, 1.05, 1);
    this.planter("garden-bed-a", 66.1, 62.05, 0.42, 0.82, 1);
    this.planter("garden-bed-b", 67.85, 62.05, 0.42, 0.82, 2);
    this.box("garden-bench", "trim", 67.0, 0.09, 62.05, 0.76, 0.2, 0.2, 1);

    // South-west: public square framed by retail, not an empty lawn.
    this.building("market", 58.25, 66.65, 2.65, 2.25, 1.68, 2, true);
    this.building("bookshop", 58.35, 69.0, 2.55, 1.55, 1.42, 0, true);
    this.box("plaza", "paving", 61.15, 0.03, 68.0, 3.2, 0.07, 3.1);
    this.cylinder("fountain-base", "trim", 61.05, 0.1, 68.05, 1.02, 0.22, 1);
    this.cylinder("fountain-water", "glass", 61.05, 0.32, 68.05, 0.78, 0.08, 0);
    this.cylinder("fountain-center", "trim", 61.05, 0.4, 68.05, 0.18, 0.5, 1);
    for (const [name, x, z] of [
      ["plaza-bench-a", 60.0, 66.8],
      ["plaza-bench-b", 62.2, 69.15],
      ["plaza-bench-c", 62.25, 66.9],
    ] as const) {
      this.box(name, "trim", x, 0.09, z, 0.82, 0.2, 0.2, 1);
    }
    this.cafeSet("plaza-table-a", 60.05, 69.0, 1);
    this.cafeSet("plaza-table-b", 62.15, 68.0, 3);
    this.planter("plaza-planter-a", 59.7, 67.9, 0.34, 0.85, 0);
    this.planter("plaza-planter-b", 62.55, 67.2, 0.34, 0.85, 2);

    // South-east: a stepped mixed-use landmark with a lower companion building.
    this.steppedBuilding("landmark", 68.55, 67.0, 3);
    this.building("studio", 70.55, 68.85, 1.5, 1.62, 1.82, 1, false);
    this.box("parking", "paving", 65.85, 0.03, 68.55, 2.2, 0.065, 1.72, 1);
    for (let i = 0; i < 3; i++) {
      const x = 65.15 + i * 0.7;
      this.box(`park-line-${i}`, "trim", x, 0.098, 68.55, 0.035, 0.015, 1.45, 1);
    }
    this.car("parked-a", 65.45, 68.42, 0, true);
    this.car("parked-b", 66.18, 68.62, 1, true);
    this.planter("landmark-planter", 70.05, 65.7, 1.25, 0.3, 2);

    // Traffic and life make the hero read as a living neighborhood.
    this.car("traffic-a", 61.15, 64.28, 2);
    this.car("traffic-b", 64.28, 59.3, 3, true);
    this.car("traffic-c", 67.25, 63.72, 1);
    this.car("traffic-d", 63.72, 67.4, 0, true);

    for (const [x, z, v, scale] of [
      [56.95, 58.75, 0, 0.9],
      [61.95, 58.75, 1, 0.82],
      [65.7, 58.85, 2, 0.9],
      [70.65, 58.85, 0, 0.9],
      [66.0, 62.25, 1, 0.8],
      [68.0, 62.35, 2, 0.78],
      [56.95, 65.45, 1, 0.86],
      [59.45, 65.35, 2, 0.8],
      [62.55, 69.35, 0, 0.9],
      [70.95, 65.65, 1, 0.9],
      [70.75, 69.55, 2, 0.94],
    ] as const) {
      this.tree(x, z, v, scale);
    }

    for (const [name, x, z, variant] of [
      ["shrub-a", 57.0, 60.3, 0],
      ["shrub-b", 61.9, 60.25, 1],
      ["shrub-c", 65.45, 60.9, 2],
      ["shrub-d", 70.8, 60.75, 0],
      ["shrub-e", 57.0, 68.2, 1],
      ["shrub-f", 63.0, 67.45, 2],
      ["shrub-g", 69.95, 65.55, 0],
      ["shrub-h", 70.85, 67.5, 1],
    ] as const) {
      this.shrub(name, x, z, variant);
    }

    for (const [name, x, z, flip] of [
      ["light-nw", 62.6, 62.5, false],
      ["light-ne", 65.4, 62.5, true],
      ["light-sw", 62.6, 65.5, false],
      ["light-se", 65.4, 65.5, true],
      ["light-cafe", 57.0, 62.45, false],
      ["light-garden", 69.0, 62.45, true],
      ["light-plaza-a", 59.55, 65.55, false],
      ["light-plaza-b", 62.55, 69.35, true],
      ["light-landmark", 70.75, 65.55, true],
    ] as const) {
      this.streetLight(name, x, z, flip);
    }

    for (let i = 0; i < 5; i++) {
      this.bollard(`bollard-cafe-${i}`, 56.95 + i * 0.34, 62.52);
      this.bollard(`bollard-plaza-${i}`, 59.7 + i * 0.4, 65.48);
    }

    for (const [name, x, z, variant] of [
      ["person-a", 62.55, 62.5, 0],
      ["person-b", 65.45, 65.45, 1],
      ["person-c", 57.75, 62.35, 2],
      ["person-d", 58.35, 61.15, 3],
      ["person-e", 60.2, 67.1, 0],
      ["person-f", 61.8, 68.65, 1],
      ["person-g", 62.15, 66.85, 2],
      ["person-h", 66.0, 62.25, 3],
      ["person-i", 67.45, 62.35, 0],
      ["person-j", 69.6, 65.5, 1],
      ["person-k", 70.45, 65.6, 2],
      ["person-l", 68.0, 65.55, 3],
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
