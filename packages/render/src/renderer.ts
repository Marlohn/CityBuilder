/**
 * A tela 3D. Só lê o estado (contrato) e desenha; nunca muda a cidade.
 * Câmera ortográfica que começa no ângulo isométrico; controles como no Cities: Skylines II:
 * WASD move, Q/E giram, Z/X e roda dão zoom, Home/End inclinam, botão direito arrastando agarra o
 * mapa e botão do meio arrastando gira e inclina.
 */
import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  type Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { BuildingView, MapView, VehiclesView } from "@city/contract";
import { type PickBox, pickTile, rayGround, screenAxesOnGround, startTarget } from "./camera";
import { GroundLayer } from "./ground";
import { IllustratedLotLayer, stylizeIllustratedMeshes } from "./illustrated";
import { BuildingLayer, type BuildingVisual, RoadLayer, TreeLayer, VehicleLayer } from "./layers";
import { ModelLibrary } from "./models";

export interface RendererOptions {
  modelsBaseUrl: string;
  buildingVisuals: BuildingVisual[];
  tileMeters: number;
  /** Direção experimental da POC #296; não altera simulação nem contrato. */
  visualStyle?: "default" | "illustrated";
}

export interface TileEvent {
  x: number;
  y: number;
  button: number;
  shift: boolean;
}

/** Elevação isométrica clássica: 35,264° acima do horizonte. */
const ISO_BETA = Math.PI / 2 - Math.atan(1 / Math.SQRT2);
/** Limites de inclinação (beta: 0 = olhando de cima, π/2 = rente ao chão). */
const BETA_MIN = 0.25;
const BETA_MAX = 1.3;
/** Velocidades dos controles de teclado (por segundo). */
const ROTATE_PER_SEC = 1.6;
const TILT_PER_SEC = 0.9;
const ZOOM_PER_SEC = 1.8;
const PAN_SCREENS_PER_SEC = 0.9;

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
  private illustrated = false;
  private dressing: IllustratedLotLayer | null = null;
  private map: MapView | null = null;
  private targetChosen = false;
  private occupied = new Uint8Array(0);
  private zoom = 30;
  /** Tecla apertada → momento (ms) até onde o movimento dela já foi aplicado. */
  private keys = new Map<string, number>();
  private lastBuildings: BuildingView[] = [];
  private pickCache: PickBox[] | null = null;
  onTileDown: ((e: TileEvent) => void) | null = null;
  onTileMove: ((e: TileEvent) => void) | null = null;
  onTileUp: ((e: TileEvent) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: RendererOptions,
  ) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
    this.scene = new Scene(this.engine);
    this.illustrated = opts.visualStyle === "illustrated";
    this.scene.clearColor = this.illustrated
      ? new Color4(0.94, 0.97, 0.98, 1)
      : new Color4(0.62, 0.78, 0.92, 1);
    this.scene.ambientColor = this.illustrated ? new Color3(0.42, 0.42, 0.38) : new Color3(0.3, 0.3, 0.3);

    this.camera = new ArcRotateCamera("cam", -Math.PI / 4, ISO_BETA, 200, new Vector3(64, 0, 64), this.scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 2000;
    this.applyZoom();

    this.sky = new HemisphericLight("sky", new Vector3(0, 1, 0), this.scene);
    this.sky.intensity = this.illustrated ? 0.78 : 0.6;
    this.sky.groundColor = this.illustrated ? new Color3(0.5, 0.51, 0.45) : new Color3(0.35, 0.35, 0.3);
    this.sun = new DirectionalLight("sun", new Vector3(-0.55, -1, 0.45), this.scene);
    this.sun.intensity = this.illustrated ? 0.82 : 0.9;
    this.shadows = new ShadowGenerator(2048, this.sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.bias = this.illustrated ? 0.001 : 0.002;
    if (this.illustrated) {
      this.shadows.darkness = 0.18;
      this.scene.imageProcessingConfiguration.contrast = 1.08;
      this.scene.imageProcessingConfiguration.exposure = 1.03;
    }

    this.lib = new ModelLibrary(this.scene, opts.modelsBaseUrl);
    this.ground = new GroundLayer(this.scene, this.illustrated);
    this.roads = new RoadLayer(this.lib);
    this.buildingLayer = new BuildingLayer(this.lib, opts.buildingVisuals, opts.tileMeters);
    this.trees = new TreeLayer(this.lib);
    this.vehicles = new VehicleLayer(this.lib, opts.tileMeters);
    if (this.illustrated) this.dressing = new IllustratedLotLayer(this.scene);

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
      ...VehicleLayer.models(),
    ]);
    if (this.illustrated) stylizeIllustratedMeshes(this.lib.all());
    for (const m of this.lib.all()) {
      if (m.name.startsWith("roads/road")) continue;
      this.shadows.addShadowCaster(m);
      m.receiveShadows = true;
    }
    for (const m of this.dressing?.all() ?? []) this.shadows.addShadowCaster(m);
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
    if (first && !this.targetChosen) {
      // A partida começa olhando a estrada de acesso: é por ela que a cidade se liga ao país.
      const target = startTarget(map.accessRoad, map.width, map.height);
      this.camera.target.set(target.x, 0, target.z);
    }
  }

  setBuildings(list: BuildingView[]) {
    this.lastBuildings = list;
    this.pickCache = null;
    this.buildingLayer.update(list);
    this.dressing?.update(list);
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

    if (this.illustrated) {
      // A leitura principal é de ilustração: sombras gráficas e fundo limpo, sem o pôr-do-sol
      // dominar a paleta dos prédios. O ciclo dia/noite continua existindo, só é mais contido.
      this.sun.direction.set(Math.sin(az) * 0.32 - 0.35, -Math.max(0.45, sunHeight), Math.cos(az) * 0.32 + 0.45);
      this.sun.intensity = 0.48 + 0.38 * day;
      this.sky.intensity = 0.64 + 0.16 * day;
      const night = new Color3(0.18, 0.23, 0.3);
      const noon = new Color3(0.94, 0.97, 0.98);
      const bg = Color3.Lerp(night, noon, Math.max(0.28, day));
      this.scene.clearColor = new Color4(bg.r, bg.g, bg.b, 1);
      this.sun.diffuse = Color3.Lerp(new Color3(0.88, 0.77, 0.68), new Color3(1, 0.97, 0.91), day);
      return;
    }

    this.sun.direction.set(Math.sin(az) * 0.6, -Math.max(0.25, sunHeight), Math.cos(az) * 0.6 + 0.3);
    this.sun.intensity = 0.2 + 0.8 * day;
    // Noite com luar: escura, mas ainda dá para ver a cidade.
    this.sky.intensity = 0.45 + 0.25 * day;
    const night = new Color3(0.1, 0.13, 0.24);
    const noon = new Color3(0.62, 0.78, 0.92);
    const dusk = new Color3(0.95, 0.6, 0.4);
    const edge = Math.max(0, 1 - Math.abs(sunHeight) * 3) * 0.6;
    const base = Color3.Lerp(night, noon, day);
    const color = Color3.Lerp(base, dusk, edge * day);
    this.scene.clearColor = new Color4(color.r, color.g, color.b, 1);
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

  /** Gira a câmera (radianos). */
  rotateBy(radians: number) {
    this.camera.alpha += radians;
  }

  /** Inclina a câmera (radianos), dentro dos limites. */
  tiltBy(radians: number) {
    this.camera.beta = Math.max(BETA_MIN, Math.min(BETA_MAX, this.camera.beta + radians));
  }

  zoomBy(factor: number) {
    this.zoom = Math.max(3, Math.min(160, this.zoom * factor));
    this.applyZoom();
  }

  /**
   * Converte posição na tela para o quadradinho do mapa (ou null fora do mapa).
   * O raio testa primeiro os prédios (com a altura desenhada) e só depois o chão: clicar no corpo de
   * um prédio seleciona o prédio, não o chão atrás dele.
   */
  screenToTile(sx: number, sy: number): { x: number; y: number } | null {
    const ray = this.scene.createPickingRay(sx, sy, null, this.camera);
    const hit = pickTile(ray.origin, ray.direction, this.pickBoxes());
    if (!hit || !this.map) return null;
    if (hit.x < 0 || hit.y < 0 || hit.x >= this.map.width || hit.y >= this.map.height) return null;
    return { x: hit.x, y: hit.y };
  }

  /** Ponto do chão embaixo de uma posição da tela (sem olhar prédios). */
  screenToGround(sx: number, sy: number): { x: number; z: number } | null {
    const ray = this.scene.createPickingRay(sx, sy, null, this.camera);
    return rayGround(ray.origin, ray.direction);
  }

  /** Posição na tela (pixels do canvas) de um ponto do mundo. Usado nos testes de tela. */
  worldToScreen(x: number, y: number, z: number): { x: number; y: number } {
    const p = Vector3.Project(
      new Vector3(x, y, z),
      Matrix.Identity(),
      // Matrizes da câmera de agora (não a do último quadro desenhado).
      this.camera.getViewMatrix(true).multiply(this.camera.getProjectionMatrix(true)),
      this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight()),
    );
    return { x: p.x, y: p.y };
  }

  /** Estado da câmera (para testes e para salvar a vista). */
  cameraState() {
    const t = this.camera.target;
    return { alpha: this.camera.alpha, beta: this.camera.beta, zoom: this.zoom, x: t.x, z: t.z };
  }

  private pickBoxes(): PickBox[] {
    if (this.pickCache) return this.pickCache;
    this.pickCache = this.lastBuildings.map((b) => ({
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      height: this.buildingLayer.heightOf(b),
    }));
    return this.pickCache;
  }

  /** Retângulo aproximado (em quadradinhos) que aparece na tela. */
  visibleTileRect(): { x0: number; y0: number; x1: number; y1: number } {
    const t = this.camera.target;
    const ar = this.canvas.width / Math.max(1, this.canvas.height);
    const r = this.zoom * Math.max(1, ar) * 1.6;
    return { x0: t.x - r, y0: t.z - r, x1: t.x + r, y1: t.z + r };
  }

  lookAt(x: number, y: number) {
    this.targetChosen = true;
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

  /** Move o alvo da câmera no chão (em quadradinhos) e mantém dentro do mapa. */
  private moveTarget(dx: number, dz: number) {
    const t = this.camera.target;
    t.x += dx;
    t.z += dz;
    if (this.map) {
      t.x = Math.max(0, Math.min(this.map.width, t.x));
      t.z = Math.max(0, Math.min(this.map.height, t.z));
    }
    this.sun.position = t.add(new Vector3(40, 80, -40));
  }

  /**
   * Teclado: WASD/setas movem na direção da tela, Q/E giram, Z/X zoom, Home/End inclinam.
   * O movimento conta o tempo real que cada tecla ficou apertada (não o número de quadros), então
   * funciona igual em computador lento e um toque rápido entre dois quadros não se perde.
   */
  private updateCameraFromKeys(now = performance.now()) {
    for (const [key, since] of this.keys) {
      const dt = Math.min(0.5, (now - since) / 1000);
      this.keys.set(key, now);
      if (dt > 0) this.applyKey(key, dt);
    }
  }

  private applyKey(key: string, dt: number) {
    const move = (sx: number, sy: number) => {
      const { up, right } = screenAxesOnGround(this.camera.alpha);
      const step = this.zoom * 2 * PAN_SCREENS_PER_SEC * dt;
      this.moveTarget((right.x * sx + up.x * sy) * step, (right.z * sx + up.z * sy) * step);
    };
    if (key === "a" || key === "arrowleft") move(-1, 0);
    else if (key === "d" || key === "arrowright") move(1, 0);
    else if (key === "w" || key === "arrowup") move(0, 1);
    else if (key === "s" || key === "arrowdown") move(0, -1);
    else if (key === "q") this.rotateBy(ROTATE_PER_SEC * dt);
    else if (key === "e") this.rotateBy(-ROTATE_PER_SEC * dt);
    else if (key === "home") this.tiltBy(-TILT_PER_SEC * dt);
    else if (key === "end") this.tiltBy(TILT_PER_SEC * dt);
    else if (key === "z") this.zoomBy(1 / (1 + ZOOM_PER_SEC * dt));
    else if (key === "x") this.zoomBy(1 + ZOOM_PER_SEC * dt);
  }

  private bindInput() {
    const c = this.canvas;
    // Botão direito arrastando = agarra o mapa; botão do meio arrastando = gira e inclina.
    let drag: "pan" | "orbit" | null = null;
    let lastX = 0;
    let lastY = 0;
    const toCanvas = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (c.width / r.width),
        y: (e.clientY - r.top) * (c.height / r.height),
      };
    };
    const tileEvent = (e: PointerEvent): TileEvent | null => {
      const p = toCanvas(e);
      const t = this.screenToTile(p.x, p.y);
      return t ? { ...t, button: e.button, shift: e.shiftKey } : null;
    };
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      if (e.button === 2 || e.button === 1) {
        drag = e.button === 2 ? "pan" : "orbit";
        const p = toCanvas(e);
        lastX = p.x;
        lastY = p.y;
        c.setPointerCapture(e.pointerId);
        if (e.button === 1) e.preventDefault();
        return;
      }
      const t = tileEvent(e);
      if (t) this.onTileDown?.(t);
    });
    c.addEventListener("pointermove", (e) => {
      if (drag) {
        const p = toCanvas(e);
        if (drag === "pan") {
          // O ponto do chão que estava embaixo do mouse continua embaixo do mouse.
          const a = this.screenToGround(lastX, lastY);
          const b = this.screenToGround(p.x, p.y);
          if (a && b) this.moveTarget(a.x - b.x, a.z - b.z);
        } else {
          this.rotateBy(-(p.x - lastX) * 0.005);
          this.tiltBy(-(p.y - lastY) * 0.004);
        }
        lastX = p.x;
        lastY = p.y;
        return;
      }
      const t = tileEvent(e);
      if (t) this.onTileMove?.(t);
    });
    c.addEventListener("pointerup", (e) => {
      if (drag) {
        drag = null;
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
      // Hora em que a tecla foi apertada (não a hora em que o evento foi tratado).
      if (!this.keys.has(k)) this.keys.set(k, e.timeStamp || performance.now());
    });
    window.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      const since = this.keys.get(k);
      if (since === undefined) return;
      // Aplica o pedaço que faltou desde o último quadro.
      const dt = Math.min(0.5, ((e.timeStamp || performance.now()) - since) / 1000);
      this.keys.delete(k);
      if (dt > 0) this.applyKey(k, dt);
    });
    // Janela perdeu o foco: solta as teclas (senão a câmera continua andando sozinha).
    window.addEventListener("blur", () => this.keys.clear());
    this.engine.onResizeObservable.add(() => this.applyZoom());
  }
}
