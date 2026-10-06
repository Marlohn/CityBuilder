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
const pocV4 = params.get("poc") === "v4";
const pocV4Cinema = pocV4 && params.get("cinema") === "1";
const seed = params.get("seed") ?? (pocV4 ? "poc-v4-live" : `cidade-${Math.floor(Math.random() * 1e9)}`);
// A POC visual usa sandbox só para montar uma cidade de avaliação determinística.
const overrides = params.get("modo") === "livre" || pocV4 ? { economy: { mode: "sandbox" } } : undefined;

const config = parseGameConfig(configTexts, overrides);
const data = parseGameData(dataTexts, config);
const store = new Store();
const client = new WorkerClient();
const canvas = document.getElementById("city") as HTMLCanvasElement;

if (pocV4) {
  document.title = "CityBuilder · POC visual v4 · assets GLB";
  const badge = document.createElement("div");
  badge.id = "poc-v4-badge";
  badge.textContent = "POC v4 · novos GLBs";
  Object.assign(badge.style, {
    position: "fixed",
    zIndex: "20",
    top: "12px",
    right: "12px",
    padding: "7px 10px",
    borderRadius: "9px",
    background: "rgba(24, 29, 34, 0.82)",
    color: "#f4f6f6",
    font: "12px system-ui, sans-serif",
    pointerEvents: "none",
  });
  document.body.append(badge);
}

const renderer = new CityRenderer(canvas, {
  modelsBaseUrl: new URL("./models", location.href).href.replace(/\/$/, ""),
  buildingVisuals: data.buildings.map((b) => ({ id: b.id, models: b.models, floors: b.floors })),
  tileMeters: config.world.tileMeters,
  visualStyle: pocV4 ? "poc-v4" : "default",
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
let pocV4Built = false;

function buildPocV4City() {
  if (!pocV4 || pocV4Built) return;
  pocV4Built = true;

  // Cidade pequena e real: usa os mesmos comandos/Worker da aplicação e apenas fixa a composição
  // para a avaliação visual. A espinha dorsal nasce conectada à estrada de acesso.
  const gridX = [68, 72, 76, 80, 84, 88, 92];
  const gridY = [116, 120, 124, 128, 132, 136, 140];
  client.command({ type: "buildRoad", kind: "avenue", x0: 47, y0: 128, x1: 96, y1: 128 });

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

  // Infraestrutura fica fora do enquadramento principal, mas mantém o crescimento da cidade real.
  client.command({ type: "placeService", service: "poco", x: 58, y: 129 });
  client.command({ type: "placeService", service: "subestacao", x: 60, y: 129 });

  const zones = ["residential_low", "commercial", "residential_low", "commercial"] as const;
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
  renderer.zoomBy(9.5 / renderer.cameraState().zoom);
}

client.onReady = () => {
  store.set({ ready: true });
  buildPocV4City();
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

if (!pocV4Cinema) {
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
