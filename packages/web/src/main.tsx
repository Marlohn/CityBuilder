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

function setupPocV4Cinema() {
  const width = 30;
  const height = 26;
  const roads = new Uint8Array(width * height);
  const zones = new Uint8Array(width * height);
  const trees = new Uint8Array(width * height);
  const water = new Uint8Array(width * height);
  const at = (x: number, y: number) => y * width + x;

  // Quatro quadras compactas: ruas locais + eixo comercial central.
  for (const y of [5, 10, 15, 20]) {
    for (let x = 3; x <= 26; x++) roads[at(x, y)] = y === 10 ? 2 : 1;
  }
  for (const x of [5, 10, 15, 20, 25]) {
    for (let y = 3; y <= 22; y++) roads[at(x, y)] = 1;
  }

  for (const [x, y] of [
    [2, 4],
    [3, 8],
    [7, 3],
    [8, 8],
    [12, 3],
    [13, 8],
    [17, 3],
    [18, 8],
    [22, 3],
    [23, 8],
    [4, 13],
    [8, 13],
    [12, 18],
    [18, 18],
    [23, 18],
    [27, 14],
    [27, 20],
  ] as const)
    trees[at(x, y)] = 1;

  const map: MapView = {
    width,
    height,
    tileMeters: config.world.tileMeters,
    roads,
    zones,
    trees,
    water,
    version: 1,
  };

  const active = (
    id: number,
    type: string,
    x: number,
    y: number,
    facing: number,
    variant: number,
  ): BuildingView => ({
    id,
    type,
    x,
    y,
    w: 1,
    h: 1,
    state: 1,
    facing,
    variant,
    residents: type === "casa" ? 3 : 0,
    households: type === "casa" ? 1 : 0,
    homesCapacity: type === "casa" ? 1 : 0,
    jobs: type === "loja" ? 6 : 0,
    jobsCapacity: type === "loja" ? 13 : 0,
    students: 0,
    studentsCapacity: 0,
    patients: 0,
    patientsCapacity: 0,
  });

  const showcaseBuildings: BuildingView[] = [
    active(1, "casa", 6, 6, 3, 0),
    active(2, "casa", 8, 6, 1, 1),
    active(3, "casa", 11, 6, 3, 1),
    active(4, "casa", 13, 6, 1, 0),
    active(5, "loja", 16, 6, 3, 0),
    active(6, "loja", 18, 6, 1, 1),
    active(7, "loja", 21, 6, 3, 1),
    active(8, "casa", 23, 6, 1, 0),
    active(9, "loja", 6, 11, 3, 0),
    active(10, "loja", 8, 11, 1, 1),
    active(11, "casa", 11, 11, 3, 0),
    active(12, "casa", 13, 11, 1, 1),
    active(13, "loja", 16, 11, 3, 1),
    active(14, "casa", 18, 11, 1, 0),
    active(15, "casa", 21, 11, 3, 1),
    active(16, "loja", 23, 11, 1, 0),
    active(17, "casa", 6, 16, 3, 1),
    active(18, "loja", 8, 16, 1, 0),
    active(19, "casa", 11, 16, 3, 0),
    active(20, "loja", 13, 16, 1, 1),
    active(21, "loja", 16, 16, 3, 0),
    active(22, "casa", 18, 16, 1, 1),
  ];

  const vehicles = new Float32Array([
    7.2,
    10.5,
    Math.PI / 2,
    0,
    13.2,
    10.5,
    -Math.PI / 2,
    1,
    19.2,
    10.5,
    Math.PI / 2,
    2,
    10.5,
    13.2,
    0,
    0,
    20.5,
    18.2,
    Math.PI,
    1,
    9.65,
    8.4,
    0,
    100,
    15.35,
    12.4,
    Math.PI,
    100,
    20.35,
    16.8,
    Math.PI / 2,
    100,
  ]);

  lastMap = map;
  indexBuildings(showcaseBuildings);
  renderer.setMap(map);
  renderer.setBuildings(showcaseBuildings);
  renderer.setVehicles({ data: vehicles, count: vehicles.length / 4 });
  renderer.lookAt(15, 12);
  renderer.zoomBy(0.4);
  renderer.tiltBy((5 * Math.PI) / 180);
  store.set({ ready: true });
}

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
      if (!pocV4Cinema && now - lastView > 200) {
        lastView = now;
        client.setView(renderer.visibleTileRect());
      }
    });
    if (pocV4Cinema) setupPocV4Cinema();
    else client.send({ type: "init", seed, configTexts, dataTexts, overrides });
  })
  .catch((e) => store.set({ error: `Erro ao carregar modelos: ${(e as Error).message}` }));

// Acesso para testes automáticos (Playwright) e depuração no console.
Object.assign(window, {
  __city: { client, store, renderer, seed, buildings: () => buildings, map: () => lastMap },
});
