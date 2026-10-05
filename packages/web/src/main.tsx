/**
 * Ponto de entrada no navegador: liga a tela 3D, a interface e o motor (Worker).
 */
import type { BuildingView, MapView } from "@city/contract";
import { CityRenderer } from "@city/render";
import { parseGameConfig, parseGameData } from "@city/sim";
import { App, Store } from "@city/ui";
import { createRoot } from "react-dom/client";
import { configTexts, dataTexts } from "./assets";
import { WorkerClient } from "./client";
import { ToolController, toolDefs } from "./tools";

const params = new URLSearchParams(location.search);
const pocV3 = params.get("poc") === "v3";
const pocScene = (["kenney", "hero", "live", "play"] as const).includes(
  params.get("scene") as "kenney" | "hero" | "live" | "play",
)
  ? (params.get("scene") as "kenney" | "hero" | "live" | "play")
  : "live";
const pocCamera = params.get("camera") === "perspective" ? "perspective" : "orthographic";
const staticPoc = pocV3 && (pocScene === "kenney" || pocScene === "hero");
const seed = params.get("seed") ?? `cidade-${Math.floor(Math.random() * 1e9)}`;
// ?modo=livre = dinheiro infinito (modo "sandbox" da config).
const overrides = params.get("modo") === "livre" ? { economy: { mode: "sandbox" } } : undefined;

const config = parseGameConfig(configTexts, overrides);
const data = parseGameData(dataTexts, config);
const store = new Store();
const client = new WorkerClient();
const canvas = document.getElementById("city") as HTMLCanvasElement;

function pocHref(scene: "kenney" | "hero" | "live" | "play", camera: "orthographic" | "perspective") {
  const q = new URLSearchParams({
    poc: "v3",
    scene,
    camera,
    seed: "poc-v3-live",
    modo: "livre",
  });
  return `?${q.toString()}`;
}

function addPocChrome() {
  if (!pocV3) return;
  document.title = `CityBuilder · POC v3 · ${pocScene} · ${pocCamera}`;
  const controls = document.createElement("nav");
  controls.id = "poc-v3-controls";
  Object.assign(controls.style, {
    position: "fixed",
    zIndex: "20",
    top: "12px",
    right: "12px",
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    maxWidth: "520px",
    padding: "8px 10px",
    borderRadius: "10px",
    background: "rgba(24, 29, 34, 0.86)",
    color: "#f3f5f5",
    font: "12px system-ui, sans-serif",
    pointerEvents: "auto",
  });
  const label = document.createElement("strong");
  label.textContent = "POC v3";
  label.style.padding = "5px 4px";
  controls.append(label);
  for (const scene of ["kenney", "hero", "play", "live"] as const) {
    const a = document.createElement("a");
    a.href = pocHref(scene, pocCamera);
    a.textContent = scene === "play" ? "jogar" : scene;
    Object.assign(a.style, {
      color: scene === pocScene ? "#fff" : "#cbd4d7",
      background: scene === pocScene ? "#4c6955" : "rgba(255,255,255,.08)",
      borderRadius: "6px",
      padding: "5px 7px",
      textDecoration: "none",
    });
    controls.append(a);
  }
  for (const camera of ["orthographic", "perspective"] as const) {
    const a = document.createElement("a");
    a.href = pocHref(pocScene, camera);
    a.textContent = camera === "orthographic" ? "ortho" : "persp 20°";
    Object.assign(a.style, {
      color: camera === pocCamera ? "#fff" : "#cbd4d7",
      background: camera === pocCamera ? "#4d6177" : "rgba(255,255,255,.08)",
      borderRadius: "6px",
      padding: "5px 7px",
      textDecoration: "none",
    });
    controls.append(a);
  }
  document.body.append(controls);

  if (pocScene === "play") {
    const note = document.createElement("div");
    note.id = "poc-v3-play-note";
    note.textContent =
      "Modo jogável: o distrito premium é uma vitrine visual; construa e zoneie ao redor com a simulação real.";
    Object.assign(note.style, {
      position: "fixed",
      zIndex: "19",
      top: "58px",
      right: "12px",
      maxWidth: "430px",
      padding: "7px 10px",
      borderRadius: "8px",
      background: "rgba(24, 29, 34, 0.78)",
      color: "#dfe7e8",
      font: "11px system-ui, sans-serif",
      pointerEvents: "none",
    });
    document.body.append(note);
  }

  if (pocScene === "kenney") {
    canvas.style.left = "50%";
    canvas.style.width = "50%";
    const frame = document.createElement("div");
    frame.id = "poc-v3-reference-frame";
    Object.assign(frame.style, {
      position: "fixed",
      inset: "0 50% 0 0",
      zIndex: "2",
      background: "#8f98a2",
      display: "grid",
      placeItems: "center",
      padding: "24px",
    });
    const image = document.createElement("img");
    image.id = "poc-v3-reference";
    image.src = new URL("./models/poc-v3/kenney-reference.png", location.href).href;
    image.alt = "Screenshot oficial do Kenney Starter Kit City Builder";
    Object.assign(image.style, {
      display: "block",
      width: "100%",
      height: "100%",
      objectFit: "contain",
    });
    frame.append(image);
    document.body.append(frame);
  }
}

addPocChrome();

const renderer = new CityRenderer(canvas, {
  modelsBaseUrl: new URL("./models", location.href).href.replace(/\/$/, ""),
  buildingVisuals: data.buildings.map((b) => ({ id: b.id, models: b.models, floors: b.floors })),
  tileMeters: config.world.tileMeters,
  visualStyle: pocV3 ? "poc-v3" : "default",
  pocScene,
  cameraMode: pocCamera,
});

let buildings: BuildingView[] = [];
let lastMap: MapView | null = null;
const byTile = new Map<number, BuildingView>();
function indexBuildings(list: BuildingView[]) {
  buildings = list;
  byTile.clear();
  for (const b of list)
    for (let dy = 0; dy < b.h; dy++)
      for (let dx = 0; dx < b.w; dx++) byTile.set((b.y + dy) * config.world.width + b.x + dx, b);
}

const tools = new ToolController(
  () => store.get().tool,
  data.buildings,
  (c) => client.command(c),
  (b) => store.set({ selectedBuilding: b, selectedPerson: null }),
  (x, y) => byTile.get(y * config.world.width + x) ?? null,
);
renderer.onTileDown = (e) => tools.down(e);
renderer.onTileMove = (e) => tools.move(e);
renderer.onTileUp = (e) => tools.up(e);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    tools.cancel();
    store.set({ tool: "inspect", selectedBuilding: null, selectedPerson: null });
  }
  // I = abre/fecha o painel lateral (fora de campos de texto).
  if (e.key.toLowerCase() === "i" && (e.target as HTMLElement)?.tagName !== "INPUT")
    store.set({ panelOpen: !store.get().panelOpen });
});

client.onError = (message) => store.set({ error: `Erro: ${message}` });
client.onLoadRequested = (save) => {
  store.set({ ready: false, error: null });
  client.send({ type: "load", save, configTexts, dataTexts });
};

let pocGalleryBuilt = false;
let pocPlaygroundBuilt = false;

function buildPocV3Playground() {
  if (!pocV3 || pocScene !== "play" || pocPlaygroundBuilt) return;
  pocPlaygroundBuilt = true;

  // O Hero premium é uma vitrine visual, não estado da simulação. A cidade real recebe
  // uma moldura de vias conectada à estrada de acesso para o jogador construir ao redor.
  client.command({ type: "buildRoad", kind: "avenue", x0: 47, y0: 128, x1: 47, y1: 74 });
  client.command({ type: "buildRoad", kind: "avenue", x0: 47, y0: 74, x1: 74, y1: 74 });
  client.command({ type: "buildRoad", kind: "street", x0: 54, y0: 54, x1: 74, y1: 54 });
  client.command({ type: "buildRoad", kind: "street", x0: 54, y0: 54, x1: 54, y1: 74 });
  client.command({ type: "buildRoad", kind: "street", x0: 74, y0: 54, x1: 74, y1: 74 });
  client.command({ type: "buildRoad", kind: "street", x0: 54, y0: 74, x1: 74, y1: 74 });

  client.command({ type: "placeService", service: "poco", x: 50, y: 75 });
  client.command({ type: "placeService", service: "subestacao", x: 52, y: 75 });

  renderer.lookAt(64, 64);
  renderer.zoomBy(8.5 / renderer.cameraState().zoom);
}

function buildPocV3Gallery() {
  if (!pocV3 || pocScene !== "live" || pocGalleryBuilt) return;
  pocGalleryBuilt = true;

  // Blocos curtos e repetíveis: a cena mede leitura urbana, não capacidade máxima do mapa.
  const gridX = [68, 72, 76, 80, 84, 88, 92];
  const gridY = [116, 120, 124, 128, 132, 136, 140];
  // Liga primeiro a espinha dorsal à estrada de acesso; assim as vias seguintes já nascem conectadas
  // e a screenshot da POC não fica coberta por avisos transitórios de rua desconectada.
  client.command({ type: "buildRoad", kind: "avenue", x0: 47, y0: 128, x1: 98, y1: 128 });
  for (const x of gridX)
    client.command({ type: "buildRoad", kind: "street", x0: x, y0: gridY[0]!, x1: x, y1: gridY.at(-1)! });
  for (const y of gridY) {
    if (y === 128) continue;
    client.command({
      type: "buildRoad",
      kind: "street",
      x0: gridX[0]!,
      y0: y,
      x1: gridX.at(-1)!,
      y1: y,
    });
  }

  client.command({ type: "placeService", service: "poco", x: 63, y: 129 });
  client.command({ type: "placeService", service: "subestacao", x: 65, y: 129 });
  const zones = ["residential_low", "commercial", "residential_high", "residential_low"] as const;
  for (let row = 0; row < gridY.length - 1; row++) {
    for (let col = 0; col < gridX.length - 1; col++) {
      client.command({
        type: "zone",
        zone: zones[(row + col) % zones.length]!,
        x0: gridX[col]! + 1,
        y0: gridY[row]! + 1,
        x1: gridX[col + 1]! - 1,
        y1: gridY[row + 1]! - 1,
      });
    }
  }

  client.send({ type: "advance", ticks: 9000 });
  renderer.lookAt(80, 128);
  renderer.zoomBy(7.2 / renderer.cameraState().zoom);
}

client.onReady = () => {
  store.set({ ready: true });
  buildPocV3Playground();
  buildPocV3Gallery();
};
client.onFrame = (f) => {
  if (f.map) {
    lastMap = f.map;
    renderer.setMap(f.map);
  }
  if (f.buildings) {
    indexBuildings(f.buildings);
    renderer.setBuildings(f.buildings);
    const sel = store.get().selectedBuilding;
    if (sel) store.set({ selectedBuilding: f.buildings.find((b) => b.id === sel.id) ?? null });
  }
  renderer.setVehicles(f.vehicles);
  renderer.setTimeOfDay(f.stats.minuteOfDay);
  store.set({ stats: f.stats });
  store.pushResults(f.commandResults);
};

if (!staticPoc) {
  createRoot(document.getElementById("ui")!).render(
    <App
      store={store}
      client={client}
      tools={toolDefs(config, data.buildings)}
      typeLabels={Object.fromEntries(data.buildings.map((b) => [b.id, b.label]))}
    />,
  );
}

renderer
  .loadAssets()
  .then(() => {
    if (staticPoc) {
      renderer.start(() => {});
      return;
    }
    let lastView = 0;
    renderer.start(() => {
      const p = tools.preview();
      renderer.setPreview(p.rect, p.valid);
      const now = performance.now();
      if (now - lastView > 200) {
        lastView = now;
        client.setView(renderer.visibleTileRect());
      }
    });
    client.send({ type: "init", seed, configTexts, dataTexts, overrides });
  })
  .catch((e) => store.set({ error: `Erro ao carregar modelos: ${(e as Error).message}` }));

// Acesso para testes automáticos (Playwright) e depuração no console.
Object.assign(window, {
  __city: { client, store, renderer, seed, buildings: () => buildings, map: () => lastMap },
});
