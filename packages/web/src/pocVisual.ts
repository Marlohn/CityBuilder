import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  type Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { BuildingView, MapView, VehiclesView } from "@city/contract";

/** POC #296: substitui apenas a apresentação 3D por uma maquete isométrica pastel. */
export interface PocBuildingVisual {
  id: string;
  floors: number;
  zone?: string;
  service?: string;
}

type RGB = readonly [number, number, number];
const P = {
  sky: [0.9, 0.95, 0.98], night: [0.12, 0.17, 0.26], road: [0.2, 0.25, 0.27], avenue: [0.16, 0.21, 0.23],
  sidewalk: [0.84, 0.85, 0.82], white: [0.96, 0.96, 0.92], yellow: [0.96, 0.74, 0.18], water: [0.14, 0.64, 0.8],
  lot: [0.88, 0.87, 0.8], lawn: [0.46, 0.72, 0.35], tree: [0.22, 0.64, 0.28], tree2: [0.38, 0.76, 0.35], trunk: [0.46, 0.31, 0.2],
  window: [0.17, 0.43, 0.55], roof: [0.87, 0.89, 0.87], coral: [0.9, 0.38, 0.3], pink: [0.95, 0.55, 0.64], teal: [0.2, 0.67, 0.66],
  cyan: [0.21, 0.62, 0.78], blue: [0.27, 0.48, 0.68], cream: [0.94, 0.84, 0.62], gray: [0.56, 0.62, 0.62], dark: [0.19, 0.3, 0.34],
  platform: [0.76, 0.48, 0.34], platform2: [0.56, 0.34, 0.27], construction: [0.95, 0.67, 0.18],
} satisfies Record<string, RGB>;
const bodyColors: readonly RGB[] = [P.white, P.pink, P.teal, P.cream, P.cyan, P.blue, P.coral, P.gray];
const carColors: readonly RGB[] = [P.coral, P.cyan, P.white, P.yellow, P.teal, P.pink];
const pedestrianType = 100;
const c = (v: RGB) => new Color3(v[0], v[1], v[2]);

function hash(n: number) {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

class Batch {
  private data = new Float32Array(16 * 128);
  private count = 0;
  private readonly m = new Matrix();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly t = new Vector3();
  constructor(readonly mesh: Mesh) {
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.thinInstanceCount = 0;
  }
  reset() { this.count = 0; }
  push(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number) {
    if ((this.count + 1) * 16 > this.data.length) {
      const next = new Float32Array(this.data.length * 2); next.set(this.data); this.data = next;
    }
    Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, this.q);
    this.s.set(sx, sy, sz); this.t.set(x, y, z); Matrix.ComposeToRef(this.s, this.q, this.t, this.m);
    this.m.copyToArray(this.data, this.count * 16); this.count++;
  }
  apply() {
    this.mesh.isVisible = this.count > 0;
    if (!this.count) { this.mesh.thinInstanceCount = 0; return; }
    this.mesh.thinInstanceSetBuffer("matrix", this.data.subarray(0, this.count * 16), 16, false);
  }
}

export class IsometricPocVisual {
  private readonly info = new Map<string, PocBuildingVisual>();
  private readonly batches = new Map<string, Batch>();
  private readonly mats = new Map<string, StandardMaterial>();
  private map: MapView | null = null;
  private buildings: BuildingView[] = [];
  private active = false;
  private readonly platform: Mesh;
  private readonly lip: Mesh;

  constructor(private readonly scene: Scene, visuals: PocBuildingVisual[]) {
    for (const v of visuals) this.info.set(v.id, v);
    this.platform = this.box("poc/platform", P.platform); this.lip = this.box("poc/lip", P.platform2);
    const defs: Array<[string, RGB, "box" | "sphere" | "cylinder"]> = [
      ["road", P.road, "box"], ["avenue", P.avenue, "box"], ["sidewalk", P.sidewalk, "box"], ["line", P.white, "box"], ["yellow", P.yellow, "box"],
      ["water", P.water, "box"], ["lot", P.lot, "box"], ["lawn", P.lawn, "box"], ["window", P.window, "box"], ["roof", P.roof, "box"],
      ["accent", P.coral, "box"], ["accent2", P.teal, "box"], ["dark", P.dark, "box"], ["construction", P.construction, "box"],
      ["trunk", P.trunk, "cylinder"], ["tree", P.tree, "sphere"], ["tree2", P.tree2, "sphere"], ["person", P.blue, "box"], ["head", P.cream, "sphere"], ["carTop", P.white, "box"],
    ];
    bodyColors.forEach((x, i) => defs.push([`body${i}`, x, "box"]));
    carColors.forEach((x, i) => defs.push([`car${i}`, x, "box"]));
    for (const [key, rgb, shape] of defs) {
      const mesh = shape === "sphere" ? this.sphere(`poc/${key}`, rgb) : shape === "cylinder" ? this.cylinder(`poc/${key}`, rgb) : this.box(`poc/${key}`, rgb);
      this.batches.set(key, new Batch(mesh));
    }
  }

  activate() {
    if (this.active) return;
    this.active = true;
    for (const mesh of this.scene.meshes) {
      if (mesh.name.startsWith("poc/")) continue;
      if (/^(roads|suburban|commercial|cars|proc)\//.test(mesh.name)) mesh.visibility = 0;
    }
    this.scene.ambientColor = new Color3(0.42, 0.44, 0.42);
    this.scene.imageProcessingConfiguration.contrast = 1.04;
    this.scene.imageProcessingConfiguration.exposure = 1.08;
    const shadow = this.scene.getLightByName("sun")?.getShadowGenerator();
    for (const batch of this.batches.values()) { shadow?.addShadowCaster(batch.mesh); batch.mesh.receiveShadows = true; }
    this.rebuild();
  }

  setMap(map: MapView) { this.map = map; this.rebuild(); }
  setBuildings(buildings: BuildingView[]) { this.buildings = buildings; this.rebuild(); }

  setVehicles(v: VehiclesView) {
    if (!this.active) return;
    const keys = [...carColors.map((_, i) => `car${i}`), "carTop", "person", "head"];
    keys.forEach((k) => this.b(k).reset());
    for (let i = 0; i < v.count; i++) {
      const x = v.data[i * 4]!, z = v.data[i * 4 + 1]!, a = v.data[i * 4 + 2]!, type = v.data[i * 4 + 3]! | 0;
      if (type >= pedestrianType) {
        this.b("person").push(x, 0.075, z, a, 0.055, 0.15, 0.055); this.b("head").push(x, 0.18, z, 0, 0.075, 0.075, 0.075);
      } else {
        this.b(`car${type % carColors.length}`).push(x, 0.055, z, a, 0.22, 0.09, 0.11); this.b("carTop").push(x, 0.115, z, a, 0.11, 0.055, 0.095);
      }
    }
    keys.forEach((k) => this.b(k).apply());
  }

  setTimeOfDay(minute: number) {
    if (!this.active) return;
    const sunHeight = -Math.cos((minute / 1440) * Math.PI * 2);
    const day = Math.max(0.2, Math.min(1, (sunHeight + 0.2) / 0.65));
    const sky = Color3.Lerp(c(P.night), c(P.sky), day); this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    const hemi = this.scene.getLightByName("sky");
    if (hemi instanceof HemisphericLight) { hemi.intensity = 0.6 + day * 0.32; hemi.groundColor = new Color3(0.42, 0.46, 0.38); }
    const sun = this.scene.getLightByName("sun");
    if (sun instanceof DirectionalLight) { sun.intensity = 0.3 + day * 0.7; sun.diffuse = Color3.Lerp(new Color3(0.85, 0.66, 0.55), new Color3(1, 0.94, 0.82), day); }
  }

  private rebuild() {
    if (!this.active || !this.map) return;
    const map = this.map;
    const staticKeys = ["road", "avenue", "sidewalk", "line", "yellow", "water", "lot", "lawn", "window", "roof", "accent", "accent2", "dark", "construction", "trunk", "tree", "tree2", ...bodyColors.map((_, i) => `body${i}`)];
    staticKeys.forEach((k) => this.b(k).reset());
    this.platform.scaling.set(map.width + 0.8, 0.2, map.height + 0.8); this.platform.position.set(map.width / 2, -0.105, map.height / 2);
    this.lip.scaling.set(map.width + 1.05, 0.09, map.height + 1.05); this.lip.position.set(map.width / 2, -0.205, map.height / 2);

    const occupied = new Uint8Array(map.width * map.height);
    for (const b of this.buildings) for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) occupied[(b.y + dy) * map.width + b.x + dx] = 1;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x, kind = map.roads[i]!;
      if (map.water[i]) this.b("water").push(x + 0.5, 0.026, y + 0.5, 0, 0.985, 0.026, 0.985);
      if (kind) this.road(map, x, y, kind);
      if (map.trees[i] && !kind && !map.water[i] && !occupied[i]) {
        const tx = x + 0.28 + hash(i * 17) * 0.44, tz = y + 0.28 + hash(i * 31) * 0.44, s = 0.18 + hash(i * 47) * 0.07;
        this.b("trunk").push(tx, 0.11, tz, 0, 0.035, 0.22, 0.035); this.b(i % 3 ? "tree" : "tree2").push(tx, 0.31, tz, 0, s, s * 1.15, s);
      }
    }
    for (const building of this.buildings) this.building(building);
    staticKeys.forEach((k) => this.b(k).apply());
  }

  private road(map: MapView, x: number, y: number, kind: number) {
    const i = y * map.width + x;
    const n = y > 0 && map.roads[i - map.width], e = x < map.width - 1 && map.roads[i + 1], s = y < map.height - 1 && map.roads[i + map.width], w = x > 0 && map.roads[i - 1];
    this.b(kind === 2 ? "avenue" : "road").push(x + 0.5, 0.032, y + 0.5, 0, 0.94, 0.035, 0.94);
    if (!n) this.b("sidewalk").push(x + 0.5, 0.055, y + 0.055, 0, 0.96, 0.035, 0.11); if (!s) this.b("sidewalk").push(x + 0.5, 0.055, y + 0.945, 0, 0.96, 0.035, 0.11);
    if (!w) this.b("sidewalk").push(x + 0.055, 0.055, y + 0.5, 0, 0.11, 0.035, 0.96); if (!e) this.b("sidewalk").push(x + 0.945, 0.055, y + 0.5, 0, 0.11, 0.035, 0.96);
    const horizontal = !!e && !!w && !n && !s, vertical = !!n && !!s && !e && !w;
    if (horizontal || vertical) {
      const key = kind === 2 ? "yellow" : "line";
      if (horizontal) this.b(key).push(x + 0.5, 0.058, y + 0.5, 0, kind === 2 ? 0.74 : 0.42, 0.01, kind === 2 ? 0.025 : 0.018);
      else this.b(key).push(x + 0.5, 0.058, y + 0.5, 0, kind === 2 ? 0.025 : 0.018, 0.01, kind === 2 ? 0.74 : 0.42);
    }
  }

  private building(b: BuildingView) {
    const meta = this.info.get(b.type); if (!meta) return;
    const cx = b.x + b.w / 2, cz = b.y + b.h / 2, lotW = b.w * 0.92, lotD = b.h * 0.92;
    this.b("lot").push(cx, 0.055, cz, 0, lotW, 0.055, lotD); this.b("lawn").push(cx, 0.086, cz, 0, lotW * 0.88, 0.022, lotD * 0.88);
    if (b.state === 0) { this.b("construction").push(cx, 0.24, cz, 0, b.w * 0.62, 0.42, b.h * 0.62); return; }
    const floors = Math.max(1, meta.floors), bw = Math.max(0.42, b.w * (meta.zone === "industrial" ? 0.72 : 0.58)), bd = Math.max(0.42, b.h * (meta.zone === "industrial" ? 0.72 : 0.58));
    const h = 0.22 + floors * (meta.zone === "residential_low" ? 0.28 : 0.31), body = (b.variant + (meta.service ? 1 : 0)) % bodyColors.length;
    this.b(`body${body}`).push(cx, 0.1 + h / 2, cz, 0, bw, h, bd); this.b("roof").push(cx, 0.115 + h, cz, 0, bw * 1.04, 0.055, bd * 1.04);
    const rows = Math.min(floors, 6), cols = Math.max(2, Math.min(5, Math.round(bw / 0.2)));
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const wx = cx - bw * 0.36 + (col / Math.max(1, cols - 1)) * bw * 0.72, wy = 0.22 + row * (h / floors);
      this.b("window").push(wx, wy, cz - bd / 2 - 0.012, 0, 0.085, 0.105, 0.02); this.b("window").push(wx, wy, cz + bd / 2 + 0.012, 0, 0.085, 0.105, 0.02);
    }
    const accent = meta.service === "water" || meta.service === "sewage" || meta.service === "power" ? "accent2" : "accent";
    this.b(accent).push(cx, 0.2, cz + bd / 2 + 0.02, 0, Math.min(0.28, bw * 0.48), 0.18, 0.035);
    if (meta.service === "health") { this.b("accent").push(cx, 0.17 + h, cz, 0, 0.22, 0.035, 0.065); this.b("accent").push(cx, 0.17 + h, cz, 0, 0.065, 0.035, 0.22); }
  }

  private b(key: string) { const batch = this.batches.get(key); if (!batch) throw new Error(`batch visual inexistente: ${key}`); return batch; }
  private mat(key: string, rgb: RGB) {
    const old = this.mats.get(key); if (old) return old;
    const m = new StandardMaterial(`poc-mat/${key}`, this.scene), col = c(rgb); m.diffuseColor = col; m.ambientColor = col.scale(0.2); m.specularColor = new Color3(0.03, 0.03, 0.03); this.mats.set(key, m); return m;
  }
  private box(name: string, rgb: RGB) { const m = MeshBuilder.CreateBox(name, { size: 1 }, this.scene); m.material = this.mat(name, rgb); m.isPickable = false; return m; }
  private sphere(name: string, rgb: RGB) { const m = MeshBuilder.CreateSphere(name, { diameter: 1, segments: 4 }, this.scene); m.material = this.mat(name, rgb); m.isPickable = false; return m; }
  private cylinder(name: string, rgb: RGB) { const m = MeshBuilder.CreateCylinder(name, { height: 1, diameter: 1, tessellation: 6 }, this.scene); m.material = this.mat(name, rgb); m.isPickable = false; return m; }
}
