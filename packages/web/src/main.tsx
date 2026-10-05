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
const artV2 = params.get("poc") === "art-v2" || params.get("visual") === "illustrated";
if (artV2) document.body.classList.add("poc-art-v2");
if (params.get("cinema") === "1") document.body.classList.add("poc-cinema");
const seed = params.get("seed") ?? `cidade-${Math.floor(Math.random() * 1e9)}`;
// ?modo=livre = dinheiro infinito (modo "sandbox" da config).
const overrides = params.get("modo") === "livre" ? { economy: { mode: "sandbox" } } : undefined;

const config = parseGameConfig(configTexts, overrides);
const data = parseGameData(dataTexts, config);
const store = new Store();
const client = new WorkerClient();
const canvas = document.getElementById("city") as HTMLCanvasElement;
const renderer = new CityRenderer(canvas, {
  modelsBaseUrl: new URL("./models", location.href).href.replace(/\/$/, ""),
  buildingVisuals: data.buildings.map((b) => ({ id: b.id, models: b.models, floors: b.floors })),
  tileMeters: config.world.tileMeters,
  visualStyle: artV2 ? "illustrated" : "default",
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
let artV2GalleryBuilt = false;
function buildArtV2Gallery() {
  if (!artV2 || artV2GalleryBuilt) return;
  artV2GalleryBuilt = true;

  // Quatro quadras compactas: a POC avalia composição e leitura urbana, não cobertura do mapa inteiro.
  client.command({ type: "buildRoad", kind: "avenue", x0: 47, y0: 128, x1: 103, y1: 128 });
  for (const x of [58, 73, 88, 103])
    client.command({ type: "buildRoad", kind: "street", x0: x, y0: 113, x1: x, y1: 143 });
  client.command({ type: "buildRoad", kind: "street", x0: 58, y0: 113, x1: 103, y1: 113 });
  client.command({ type: "buildRoad", kind: "street", x0: 58, y0: 143, x1: 103, y1: 143 });

  client.command({ type: "placeService", service: "poco", x: 50, y: 129 });
  client.command({ type: "placeService", service: "subestacao", x: 53, y: 129 });
  client.command({ type: "placeService", service: "escola", x: 59, y: 129 });
  client.command({ type: "placeService", service: "ubs", x: 74, y: 129 });
  client.command({ type: "placeService", service: "hospital", x: 89, y: 129 });

  client.command({ type: "zone", zone: "residential_low", x0: 59, y0: 114, x1: 71, y1: 127 });
  client.command({ type: "zone", zone: "residential_high", x0: 74, y0: 114, x1: 86, y1: 127 });
  client.command({ type: "zone", zone: "commercial", x0: 89, y0: 114, x1: 101, y1: 127 });
  client.command({ type: "zone", zone: "commercial", x0: 74, y0: 134, x1: 86, y1: 142 });
  client.command({ type: "zone", zone: "residential_low", x0: 89, y0: 134, x1: 101, y1: 142 });

  client.send({ type: "advance", ticks: 7600 });
  renderer.lookAt(80.5, 128.5);
  renderer.zoomBy(6.5 / renderer.cameraState().zoom);
}

client.onReady = () => {
  store.set({ ready: true });
  buildArtV2Gallery();
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

createRoot(document.getElementById("ui")!).render(
  <App
    store={store}
    client={client}
    tools={toolDefs(config, data.buildings)}
    typeLabels={Object.fromEntries(data.buildings.map((b) => [b.id, b.label]))}
  />,
);

renderer
  .loadAssets()
  .then(() => {
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
