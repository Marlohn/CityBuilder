/**
 * A tela 3D. Só lê o estado (contrato) e desenha; nunca muda a cidade.
 * Câmera 3D em ângulo isométrico, girando de 90 em 90 graus.
 */
import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  type Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { BuildingView, MapView, VehiclesView } from "@city/contract";
import { GroundLayer } from "./ground";
import { BuildingLayer, type BuildingVisual, RoadLayer, TreeLayer, VehicleLayer } from "./layers";
import { ModelLibrary } from "./models";

export interface RendererOptions {
  modelsBaseUrl: string;
  buildingVisuals: BuildingVisual[];
  tileMeters: number;
}

export interface TileEvent {
  x: number;
  y: number;
  button: number;
  shift: boolean;
}

/** Elevação isométrica clássica: 35,264° acima do horizonte. */
const ISO_BETA = Math.PI / 2 - Math.atan(1 / Math.SQRT2);

export class CityRenderer {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  private lib: ModelLibrary;
  private ground: GroundLayer;
  private roads: RoadLayer;
  private buildingLayer: BuildingLayer;
  private trees: TreeLayer;
  private vehicles: VehicleLayer;
  private sun: DirectionalLight;
  private sky: HemisphericLight;
  private shadows: ShadowGenerator;
  private preview: Mesh;
  private previewMat: StandardMaterial;
  private map: MapView | null = null;
  private occupied = new Uint8Array(0);
  private zoom = 30;
  private quarter = 0;
  private keys = new Set<string>();
  private lastBuildings: BuildingView[] = [];
  onTileDown: ((e: TileEvent) => void) | null = null;
  onTileMove: ((e: TileEvent) => void) | null = null;
  onTileUp: ((e: TileEvent) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: RendererOptions,
  ) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.62, 0.78, 0.92, 1);
    this.scene.ambientColor = new Color3(0.3, 0.3, 0.3);

    this.camera = new ArcRotateCamera("cam", -Math.PI / 4, ISO_BETA, 200, new Vector3(64, 0, 64), this.scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 2000;
    this.applyZoom();

    this.sky = new HemisphericLight("sky", new Vector3(0, 1, 0), this.scene);
    this.sky.intensity = 0.6;
    this.sky.groundColor = new Color3(0.35, 0.35, 0.3);
    this.sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.4), this.scene);
    this.sun.intensity = 0.9;
    this.shadows = new ShadowGenerator(2048, this.sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.bias = 0.002;

    this.lib = new ModelLibrary(this.scene, opts.modelsBaseUrl);
    this.ground = new GroundLayer(this.scene);
    this.roads = new RoadLayer(this.lib);
    this.buildingLayer = new BuildingLayer(this.lib, opts.buildingVisuals, opts.tileMeters);
    this.trees = new TreeLayer(this.lib);
    this.vehicles = new VehicleLayer(this.lib, opts.tileMeters);

    this.previewMat = new StandardMaterial("preview", this.scene);
    this.previewMat.alpha = 0.45;
    this.previewMat.emissiveColor = new Color3(0.2, 0.8, 0.3);
    this.preview = MeshBuilder.CreateBox("preview", { size: 1 }, this.scene);
    this.preview.material = this.previewMat;
    this.preview.isPickable = false;
    this.preview.isVisible = false;

    this.bindInput();
    window.addEventListener("resize", () => this.engine.resize());
  }

  async loadAssets() {
    await this.lib.load([
      ...RoadLayer.models(),
      ...BuildingLayer.models(this.opts.buildingVisuals),
      ...TreeLayer.models(),
      ...VehicleLayer.MODELS,
    ]);
    for (const m of this.lib.all()) {
      if (m.name.startsWith("roads/road")) continue;
      this.shadows.addShadowCaster(m);
      m.receiveShadows = true;
    }
  }

  start(onFrame: () => void) {
    this.engine.runRenderLoop(() => {
      this.updateCameraFromKeys();
      onFrame();
      this.scene.render();
    });
  }

  setMap(map: MapView) {
    const first = !this.map;
    this.map = map;
    if (this.occupied.length !== map.width * map.height)
      this.occupied = new Uint8Array(map.width * map.height);
    this.recomputeOccupied();
    this.ground.update(map, this.occupied);
    this.roads.update(map);
    this.trees.update(map, this.occupied);
    if (first) {
      this.camera.target.set(map.width / 2, 0, map.height / 2);
    }
  }

  setBuildings(list: BuildingView[]) {
    this.lastBuildings = list;
    this.buildingLayer.update(list);
    if (this.map) {
      this.recomputeOccupied();
      this.ground.update(this.map, this.occupied);
      this.trees.update(this.map, this.occupied);
    }
  }

  setVehicles(v: VehiclesView) {
    this.vehicles.update(v);
  }

  /** Luz do sol conforme a hora (minuto do dia). */
  setTimeOfDay(minuteOfDay: number) {
    const t = minuteOfDay / 1440;
    const sunHeight = -Math.cos(t * 2 * Math.PI); // -1 meia-noite, 1 meio-dia
    const day = Math.max(0, Math.min(1, (sunHeight + 0.15) / 0.5));
    const az = t * 2 * Math.PI;
    this.sun.direction.set(Math.sin(az) * 0.6, -Math.max(0.25, sunHeight), Math.cos(az) * 0.6 + 0.3);
    this.sun.intensity = 0.2 + 0.8 * day;
    // Noite com luar: escura, mas ainda dá para ver a cidade.
    this.sky.intensity = 0.45 + 0.25 * day;
    const night = new Color3(0.1, 0.13, 0.24);
    const noon = new Color3(0.62, 0.78, 0.92);
    const dusk = new Color3(0.95, 0.6, 0.4);
    const edge = Math.max(0, 1 - Math.abs(sunHeight) * 3) * 0.6;
    const base = Color3.Lerp(night, noon, day);
    const c = Color3.Lerp(base, dusk, edge * day);
    this.scene.clearColor = new Color4(c.r, c.g, c.b, 1);
    this.sun.diffuse = Color3.Lerp(new Color3(1, 0.75, 0.55), new Color3(1, 0.97, 0.9), day);
  }

  /** Mostra um retângulo de pré-visualização (ferramenta ativa). */
  setPreview(rect: { x0: number; y0: number; x1: number; y1: number } | null, valid = true) {
    if (!rect) {
      this.preview.isVisible = false;
      return;
    }
    const ax = Math.min(rect.x0, rect.x1);
    const ay = Math.min(rect.y0, rect.y1);
    const bx = Math.max(rect.x0, rect.x1) + 1;
    const by = Math.max(rect.y0, rect.y1) + 1;
    this.preview.isVisible = true;
    this.preview.scaling.set(bx - ax, 0.08, by - ay);
    this.preview.position.set((ax + bx) / 2, 0.05, (ay + by) / 2);
    this.previewMat.emissiveColor = valid ? new Color3(0.2, 0.8, 0.3) : new Color3(0.9, 0.2, 0.2);
  }

  rotate(dir: 1 | -1) {
    this.quarter = (this.quarter + dir + 4) % 4;
    this.camera.alpha = -Math.PI / 4 + (this.quarter * Math.PI) / 2;
  }

  zoomBy(factor: number) {
    this.zoom = Math.max(3, Math.min(160, this.zoom * factor));
    this.applyZoom();
  }

  /** Converte posição na tela para o quadradinho do mapa (ou null fora do mapa). */
  screenToTile(sx: number, sy: number): { x: number; y: number } | null {
    const ray = this.scene.createPickingRay(sx, sy, null, this.camera);
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = -ray.origin.y / ray.direction.y;
    const x = Math.floor(ray.origin.x + ray.direction.x * t);
    const y = Math.floor(ray.origin.z + ray.direction.z * t);
    if (!this.map || x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return null;
    return { x, y };
  }

  /** Retângulo aproximado (em quadradinhos) que aparece na tela. */
  visibleTileRect(): { x0: number; y0: number; x1: number; y1: number } {
    const t = this.camera.target;
    const ar = this.canvas.width / Math.max(1, this.canvas.height);
    const r = this.zoom * Math.max(1, ar) * 1.6;
    return { x0: t.x - r, y0: t.z - r, x1: t.x + r, y1: t.z + r };
  }

  lookAt(x: number, y: number) {
    this.camera.target.set(x, 0, y);
  }

  dispose() {
    this.engine.dispose();
  }

  private recomputeOccupied() {
    this.occupied.fill(0);
    const w = this.map?.width ?? 0;
    for (const b of this.lastBuildings) {
      for (let dy = 0; dy < b.h; dy++)
        for (let dx = 0; dx < b.w; dx++) this.occupied[(b.y + dy) * w + b.x + dx] = 1;
    }
  }

  private applyZoom() {
    const ar = this.canvas.width / Math.max(1, this.canvas.height);
    this.camera.orthoTop = this.zoom;
    this.camera.orthoBottom = -this.zoom;
    this.camera.orthoLeft = -this.zoom * ar;
    this.camera.orthoRight = this.zoom * ar;
    // A sombra acompanha o que está na tela.
    if (this.sun) {
      this.sun.shadowFrustumSize = this.zoom * 3;
      this.sun.position = this.camera.target.add(new Vector3(40, 80, -40));
    }
  }

  private pan(dx: number, dy: number) {
    const a = this.camera.alpha;
    // Direções "direita" e "para frente" da câmera projetadas no chão.
    const rightX = -Math.sin(a);
    const rightZ = Math.cos(a);
    const fwdX = -Math.cos(a);
    const fwdZ = -Math.sin(a);
    const speed = this.zoom / 300;
    this.camera.target.x += (rightX * dx + fwdX * dy) * speed;
    this.camera.target.z += (rightZ * dx + fwdZ * dy) * speed;
    if (this.map) {
      this.camera.target.x = Math.max(0, Math.min(this.map.width, this.camera.target.x));
      this.camera.target.z = Math.max(0, Math.min(this.map.height, this.camera.target.z));
    }
    this.sun.position = this.camera.target.add(new Vector3(40, 80, -40));
  }

  private updateCameraFromKeys() {
    const step = 12;
    let dx = 0;
    let dy = 0;
    if (this.keys.has("a") || this.keys.has("arrowleft")) dx -= step;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx += step;
    if (this.keys.has("w") || this.keys.has("arrowup")) dy -= step;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dy += step;
    if (dx || dy) this.pan(dx, dy);
  }

  private bindInput() {
    const c = this.canvas;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const tileEvent = (e: PointerEvent): TileEvent | null => {
      const r = c.getBoundingClientRect();
      const t = this.screenToTile(
        (e.clientX - r.left) * (c.width / r.width),
        (e.clientY - r.top) * (c.height / r.height),
      );
      return t ? { ...t, button: e.button, shift: e.shiftKey } : null;
    };
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      if (e.button === 2 || e.button === 1) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        c.setPointerCapture(e.pointerId);
        return;
      }
      const t = tileEvent(e);
      if (t) this.onTileDown?.(t);
    });
    c.addEventListener("pointermove", (e) => {
      if (dragging) {
        this.pan(-(e.clientX - lastX), -(e.clientY - lastY));
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      const t = tileEvent(e);
      if (t) this.onTileMove?.(t);
    });
    c.addEventListener("pointerup", (e) => {
      if (dragging) {
        dragging = false;
        return;
      }
      const t = tileEvent(e);
      if (t) this.onTileUp?.(t);
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12);
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (k === "q") this.rotate(-1);
      else if (k === "e") this.rotate(1);
      else this.keys.add(k);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    this.engine.onResizeObservable.add(() => this.applyZoom());
  }
}
