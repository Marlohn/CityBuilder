/// <reference lib="webworker" />
/**
 * O motor da cidade rodando fora da tela (Web Worker). A tela nunca trava por causa da simulação:
 * se o motor não der conta da velocidade pedida, ele avisa ("behind") e segue no ritmo possível.
 */
import type { FromWorker, ToWorker, ViewRect } from "@city/contract";
import {
  buildingsView,
  createGame,
  type Game,
  mapView,
  parseGameConfig,
  parseGameData,
  statsView,
} from "@city/sim";
import { answerQuery } from "./queries";

declare const self: DedicatedWorkerGlobalScope;

let game: Game | null = null;
let speed = 1;
let ticksPerSecond1x = 12;
let backlog = 0;
let last = performance.now();
let lastFrame = 0;
let sentMapVersion = -1;
let sentStructureVersion = -1;
let behind = false;
let view: ViewRect = { x0: 0, y0: 0, x1: 0, y1: 0 };

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

function startGame(g: Game) {
  game = g;
  const t = g.sim.config.time;
  ticksPerSecond1x = 1440 / t.minutesPerTick / t.realSecondsPerDayAt1x;
  sentMapVersion = -1;
  sentStructureVersion = -1;
  post({ type: "ready" });
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case "init": {
        const config = parseGameConfig(msg.configTexts, msg.overrides);
        const data = parseGameData(msg.dataTexts, config);
        startGame(createGame({ config, data, seed: msg.seed }));
        break;
      }
      case "command":
        game?.sim.enqueue(msg.command);
        break;
      case "speed":
        speed = msg.speed;
        backlog = 0;
        break;
      case "view":
        view = msg.rect;
        break;
      case "advance":
        game?.sim.step(msg.ticks);
        break;
      default:
        if (game) {
          const reply = answerQuery(game, msg);
          if (reply) post(reply);
        }
    }
  } catch (e) {
    post({ type: "error", message: (e as Error).message });
  }
};

/** Laço principal: calcula quantos ticks faltam para acompanhar o relógio real. */
setInterval(() => {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  if (!game) return;
  if (speed > 0) {
    backlog += dt * ticksPerSecond1x * speed;
    const budgetMs = 12;
    const t0 = performance.now();
    let steps = 0;
    while (backlog >= 1 && performance.now() - t0 < budgetMs) {
      game.sim.step(1);
      backlog -= 1;
      steps++;
    }
    // Mais de 1 segundo atrasado: joga o atraso fora e avisa (a cidade fica mais lenta, a tela não trava).
    behind = backlog > ticksPerSecond1x * speed;
    if (behind) backlog = 0;
    void steps;
  }
  if (now - lastFrame > 50) {
    lastFrame = now;
    sendFrame();
  }
}, 8);

function sendFrame() {
  if (!game) return;
  const { sim } = game;
  const map = sim.world.mapVersion !== sentMapVersion ? mapView(sim.world) : undefined;
  if (map) sentMapVersion = sim.world.mapVersion;
  const buildings =
    sim.buildings.structureVersion !== sentStructureVersion ? buildingsView(sim.buildings) : undefined;
  if (buildings) sentStructureVersion = sim.buildings.structureVersion;
  const vehicles = vehiclesIn(view);
  post(
    {
      type: "frame",
      stats: statsView(game, behind),
      ...(map ? { map } : {}),
      ...(buildings ? { buildings } : {}),
      vehicles,
      commandResults: sim.drainResults(),
    },
    [vehicles.data.buffer, ...(map ? [map.roads.buffer, map.zones.buffer, map.trees.buffer] : [])],
  );
}

function vehiclesIn(rect: ViewRect) {
  if (!game || rect.x1 <= rect.x0) return { data: new Float32Array(0), count: 0 };
  // Fração do tick (para o carro andar suave entre um tick e outro).
  const sub = Math.min(0.99, Math.max(0, backlog));
  const data = game.traffic.positions(rect, sub);
  return { data, count: data.length / 4 };
}
