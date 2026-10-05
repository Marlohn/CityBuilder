import {
  type AbstractMesh,
  Color3,
  Mesh,
  MeshBuilder,
  MultiMaterial,
  PBRMaterial,
  type Scene,
  StandardMaterial,
} from "@babylonjs/core";
import type { BuildingView } from "@city/contract";
import { BatchSet } from "./instances";

type RGB = readonly [number, number, number];

const COLORS = {
  lawn: [0.46, 0.65, 0.3],
  paving: [0.76, 0.77, 0.73],
  pavingDark: [0.59, 0.62, 0.6],
  path: [0.9, 0.88, 0.8],
  stripe: [0.96, 0.94, 0.86],
  hedge: [0.23, 0.48, 0.2],
  planter: [0.72, 0.7, 0.62],
  trunk: [0.44, 0.3, 0.2],
  crown: [0.25, 0.54, 0.24],
  crownLight: [0.39, 0.66, 0.31],
  bench: [0.46, 0.3, 0.2],
  benchMetal: [0.28, 0.31, 0.31],
} satisfies Record<string, RGB>;

const c = (rgb: RGB) => new Color3(rgb[0], rgb[1], rgb[2]);

function stableHash(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const facadePalette: readonly RGB[] = [
  [0.94, 0.9, 0.78],
  [0.93, 0.76, 0.72],
  [0.73, 0.86, 0.82],
  [0.74, 0.82, 0.9],
  [0.92, 0.83, 0.64],
  [0.85, 0.8, 0.9],
];

function stringHash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

function illustratedColor(original: Color3, accent: Color3): Color3 {
  const max = Math.max(original.r, original.g, original.b);
  const min = Math.min(original.r, original.g, original.b);
  const luma = (original.r + original.g + original.b) / 3;
  const saturation = max - min;

  // Vidro azul/ciano é uma assinatura forte das referências.
  if (original.b > original.r * 1.04 && original.b >= original.g * 0.95 && luma < 0.72)
    return new Color3(0.29, 0.61, 0.73);

  // Telhados, esquadrias e bases continuam escuros para segurar o contraste.
  if (luma < 0.26) return new Color3(0.24, 0.28, 0.3);

  // Concreto/reboco claro vira um branco quente, não cinza puro.
  if (luma > 0.72 && saturation < 0.22) return new Color3(0.94, 0.93, 0.87);

  // Cinzas médios viram a cor pastel da família do prédio.
  if (saturation < 0.16) return Color3.Lerp(accent, new Color3(1, 1, 1), 0.2);

  // Cores próprias do asset são mantidas, apenas suavizadas.
  return Color3.Lerp(original, new Color3(1, 1, 1), 0.12);
}

function styleMaterial(material: unknown, seen: Set<unknown>, accent: Color3, recolor: boolean) {
  if (!material || seen.has(material)) return;
  seen.add(material);

  if (material instanceof MultiMaterial) {
    for (const sub of material.subMaterials) styleMaterial(sub, seen, accent, recolor);
    return;
  }
  if (material instanceof StandardMaterial) {
    if (recolor) material.diffuseColor = illustratedColor(material.diffuseColor, accent);
    material.specularColor = new Color3(0.01, 0.01, 0.01);
    material.ambientColor = material.diffuseColor.scale(0.2);
    return;
  }
  if (material instanceof PBRMaterial) {
    if (recolor) material.albedoColor = illustratedColor(material.albedoColor, accent);
    material.metallic = 0;
    material.roughness = 0.96;
    material.environmentIntensity = 0.14;
  }
}

/**
 * Deixa os GLBs existentes com leitura próxima de uma ilustração editorial:
 * fachadas pastel, vidro ciano, telhados escuros e superfícies foscas.
 */
export function stylizeIllustratedMeshes(meshes: AbstractMesh[]) {
  const seen = new Set<unknown>();
  for (const mesh of meshes) {
    const accent = c(facadePalette[stringHash(mesh.name) % facadePalette.length]!);
    const recolor = mesh.name.startsWith("suburban/") || mesh.name.startsWith("commercial/");
    styleMaterial(mesh.material, seen, accent, recolor);
  }
}

/**
 * Dressing visual da POC v2. Os prédios continuam sendo os GLBs do jogo; esta camada
 * compõe cada lote com jardim, passeio, estacionamento e pequenos props para quebrar
 * a leitura de "modelo solto em um quadradinho".
 */
export class IllustratedLotLayer {
  private readonly batches = new BatchSet();
  private readonly meshes = new Map<string, Mesh>();

  constructor(private readonly scene: Scene) {
    this.addBox("lawn", COLORS.lawn);
    this.addBox("paving", COLORS.paving);
    this.addBox("pavingDark", COLORS.pavingDark);
    this.addBox("path", COLORS.path);
    this.addBox("stripe", COLORS.stripe);
    this.addBox("hedge", COLORS.hedge);
    this.addBox("planter", COLORS.planter);
    this.addBox("trunk", COLORS.trunk);
    this.addSphere("crown", COLORS.crown, 5);
    this.addSphere("crownLight", COLORS.crownLight, 5);
    this.addBox("bench", COLORS.bench);
    this.addBox("benchMetal", COLORS.benchMetal);

    for (const mesh of this.meshes.values()) {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.thinInstanceCount = 0;
    }
  }

  all(): Mesh[] {
    return [...this.meshes.values()];
  }

  update(buildings: BuildingView[]) {
    this.batches.resetAll();
    for (const key of this.meshes.keys()) this.batches.get(key);

    for (const b of buildings) {
      if (b.state === 0) continue;

      const cx = b.x + b.w / 2;
      const cz = b.y + b.h / 2;
      const seed = b.x * 911 + b.y * 3571 + b.variant * 13;
      const large = b.w * b.h >= 4;
      const civic = ["escola", "ubs", "hospital", "poco", "eta", "subestacao", "ete"].includes(b.type);

      this.batches
        .get(large || civic ? "paving" : "lawn")
        .push(cx, 0.012, cz, 0, b.w * 0.98, 0.024, b.h * 0.98);

      const front = this.frontRect(b);
      this.batches.get("path").push(front.x, 0.028, front.z, front.yaw, front.w, 0.018, front.d);

      if (large || civic) {
        const side = this.sideRect(b);
        this.batches.get("pavingDark").push(side.x, 0.026, side.z, side.yaw, side.w, 0.022, side.d);

        const slots = Math.max(2, Math.min(5, Math.round((side.yaw === 0 ? side.w : side.d) / 0.34)));
        for (let i = 1; i < slots; i++) {
          const t = i / slots - 0.5;
          const dx = side.yaw === 0 ? t * side.w : 0;
          const dz = side.yaw === 0 ? 0 : t * side.d;
          this.batches
            .get("stripe")
            .push(side.x + dx, 0.041, side.z + dz, side.yaw, side.yaw === 0 ? 0.015 : side.w, 0.012, side.yaw === 0 ? side.d : 0.015);
        }
      }

      if (b.w >= 2 || b.h >= 2) {
        const cornerX = b.x + (stableHash(seed) > 0.5 ? 0.22 : b.w - 0.22);
        const cornerZ = b.y + (stableHash(seed + 1) > 0.5 ? 0.22 : b.h - 0.22);
        this.tree(cornerX, cornerZ, seed);
      }

      if (large && !civic) {
        const bx = b.x + 0.24;
        const bz = b.y + b.h - 0.18;
        this.batches.get("benchMetal").push(bx, 0.075, bz, 0, 0.26, 0.08, 0.04);
        this.batches.get("bench").push(bx, 0.14, bz, 0, 0.25, 0.035, 0.05);
      }

      if (b.type === "casa") {
        const hedgeZ = b.y + (b.facing === 0 ? 0.09 : b.h - 0.09);
        this.batches.get("hedge").push(cx, 0.075, hedgeZ, 0, Math.max(0.25, b.w * 0.55), 0.13, 0.08);
      }
    }

    this.batches.applyAll((key) => {
      const mesh = this.meshes.get(key);
      if (!mesh) throw new Error(`malha de dressing inexistente: ${key}`);
      return mesh;
    });
  }

  private tree(x: number, z: number, seed: number) {
    const scale = 0.16 + stableHash(seed + 7) * 0.05;
    this.batches.get("planter").push(x, 0.045, z, 0, 0.21, 0.08, 0.21);
    this.batches.get("trunk").push(x, 0.14, z, 0, 0.035, 0.24, 0.035);
    this.batches
      .get(stableHash(seed + 9) > 0.5 ? "crown" : "crownLight")
      .push(x, 0.32, z, 0, scale, scale * 1.12, scale);
  }

  private frontRect(b: BuildingView) {
    const cx = b.x + b.w / 2;
    const cz = b.y + b.h / 2;
    const edge = 0.12;
    const depth = Math.min(0.28, Math.max(0.16, Math.min(b.w, b.h) * 0.18));
    switch (b.facing) {
      case 0:
        return { x: cx, z: b.y + edge, yaw: 0, w: Math.max(0.25, b.w * 0.34), d: depth };
      case 1:
        return { x: b.x + b.w - edge, z: cz, yaw: Math.PI / 2, w: Math.max(0.25, b.h * 0.34), d: depth };
      case 2:
        return { x: cx, z: b.y + b.h - edge, yaw: 0, w: Math.max(0.25, b.w * 0.34), d: depth };
      default:
        return { x: b.x + edge, z: cz, yaw: Math.PI / 2, w: Math.max(0.25, b.h * 0.34), d: depth };
    }
  }

  private sideRect(b: BuildingView) {
    const cx = b.x + b.w / 2;
    const cz = b.y + b.h / 2;
    const inset = 0.18;
    if (b.facing === 0 || b.facing === 2)
      return {
        x: b.x + b.w - inset,
        z: cz,
        yaw: Math.PI / 2,
        w: Math.min(0.42, b.h * 0.42),
        d: Math.max(0.24, b.w * 0.16),
      };
    return {
      x: cx,
      z: b.y + b.h - inset,
      yaw: 0,
      w: Math.min(0.42, b.w * 0.42),
      d: Math.max(0.24, b.h * 0.16),
    };
  }

  private addBox(name: string, color: RGB) {
    const mesh = MeshBuilder.CreateBox(`illustrated/${name}`, { size: 1 }, this.scene);
    mesh.material = this.material(name, color);
    this.meshes.set(name, mesh);
  }

  private addSphere(name: string, color: RGB, segments: number) {
    const mesh = MeshBuilder.CreateSphere(`illustrated/${name}`, { diameter: 1, segments }, this.scene);
    mesh.material = this.material(name, color);
    this.meshes.set(name, mesh);
  }

  private material(name: string, color: RGB) {
    const mat = new StandardMaterial(`illustrated-mat/${name}`, this.scene);
    mat.diffuseColor = c(color);
    mat.ambientColor = c(color).scale(0.16);
    mat.specularColor = new Color3(0.01, 0.01, 0.01);
    return mat;
  }
}
