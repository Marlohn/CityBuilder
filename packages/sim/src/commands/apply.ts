/**
 * Aplica comandos no mundo. Cada regra aqui tenta fazer sentido na vida real:
 * via reta, via não atravessa prédio, prédio de serviço precisa de acesso por via, obra custa dinheiro.
 */
import { type Command, type CommandResult, ROAD_ID, ZONE_ID } from "@city/contract";
import type { GameConfig } from "../config/schema";
import type { Logger } from "../core/log";
import type { Treasury } from "../economy/treasury";
import { BSTATE, type Buildings } from "../world/buildings";
import type { RoadNetwork } from "../world/roadNetwork";
import type { World } from "../world/world";

export interface CommandContext {
  world: World;
  buildings: Buildings;
  network: RoadNetwork;
  treasury: Treasury;
  config: GameConfig;
  log: Logger;
  tick: number;
  ticksPerDay: number;
  /** Chamado quando um prédio é demolido (para tirar moradores, trabalhadores e alunos). */
  onBuildingRemoved: (id: number, reason: string) => void;
  /** Chamado quando uma via some (prédios podem perder acesso). */
  onRoadsRemoved: () => void;
  variantFor: (x: number, y: number) => number;
}

export function applyCommand(ctx: CommandContext, command: Command): CommandResult {
  const base = { tick: ctx.tick, command };
  try {
    const r = dispatch(ctx, command);
    ctx.log.info("commands", r.ok ? "applied" : "rejected", {
      reason: r.reason,
      data: { command, cost: r.cost },
    });
    return { ...base, ...r };
  } catch (e) {
    const reason = `erro interno: ${(e as Error).message}`;
    ctx.log.error("commands", "exception", { reason, data: { command } });
    return { ...base, ok: false, reason };
  }
}

type Partial = { ok: boolean; reason?: string; cost?: number };

function dispatch(ctx: CommandContext, c: Command): Partial {
  switch (c.type) {
    case "buildRoad":
      return buildRoad(ctx, c.kind, c.x0, c.y0, c.x1, c.y1);
    case "zone":
      return zone(ctx, ZONE_ID[c.zone], c.x0, c.y0, c.x1, c.y1);
    case "bulldoze":
      return bulldoze(ctx, c.x0, c.y0, c.x1, c.y1);
    case "placeService":
      return placeService(ctx, c.service, c.x, c.y);
  }
}

function clampRect(world: World, x0: number, y0: number, x1: number, y1: number) {
  return {
    ax: Math.max(0, Math.min(x0, x1)),
    ay: Math.max(0, Math.min(y0, y1)),
    bx: Math.min(world.width - 1, Math.max(x0, x1)),
    by: Math.min(world.height - 1, Math.max(y0, y1)),
  };
}

function buildRoad(
  ctx: CommandContext,
  kind: "street" | "avenue",
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Partial {
  const { world } = ctx;
  if (x0 !== x1 && y0 !== y1) return { ok: false, reason: "a via precisa ser reta (horizontal ou vertical)" };
  if (!world.inBounds(x0, y0) || !world.inBounds(x1, y1)) return { ok: false, reason: "fora do mapa" };
  const id = ROAD_ID[kind];
  const costPerTile = ctx.config.roads[kind].costPerTile;
  const tiles: number[] = [];
  const { ax, ay, bx, by } = clampRect(world, x0, y0, x1, y1);
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      const i = world.idx(x, y);
      if (world.buildingAt[i]! >= 0) return { ok: false, reason: `tem um prédio no caminho em (${x}, ${y})` };
      if (world.roads[i] !== id) tiles.push(i);
    }
  }
  if (tiles.length === 0) return { ok: true, cost: 0, reason: "a via já existe" };
  const cost = tiles.length * costPerTile;
  if (!ctx.treasury.trySpend(cost, "obras_vias")) {
    return { ok: false, reason: `dinheiro insuficiente (custa R$ ${fmt(cost)})` };
  }
  for (const i of tiles) {
    world.roads[i] = id;
    world.zones[i] = 0;
    world.trees[i] = 0;
  }
  world.roadVersion++;
  world.zoneVersion++;
  world.mapVersion++;
  return { ok: true, cost };
}

function zone(ctx: CommandContext, zoneId: number, x0: number, y0: number, x1: number, y1: number): Partial {
  const { world } = ctx;
  const { ax, ay, bx, by } = clampRect(world, x0, y0, x1, y1);
  let changed = 0;
  let skippedBuilt = 0;
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      const i = world.idx(x, y);
      if (world.roads[i] !== 0) continue;
      if (world.buildingAt[i]! >= 0) {
        skippedBuilt++;
        continue;
      }
      if (world.zones[i] !== zoneId) {
        world.zones[i] = zoneId;
        changed++;
      }
    }
  }
  if (changed > 0) {
    world.mapVersion++;
    world.zoneVersion++;
  }
  const note =
    skippedBuilt > 0
      ? `${skippedBuilt} quadradinhos com prédio ficaram como estavam (demola antes)`
      : undefined;
  return { ok: true, cost: 0, ...(note ? { reason: note } : {}) };
}

function bulldoze(ctx: CommandContext, x0: number, y0: number, x1: number, y1: number): Partial {
  const { world, buildings } = ctx;
  const { ax, ay, bx, by } = clampRect(world, x0, y0, x1, y1);
  let roadsRemoved = 0;
  const toRemove = new Set<number>();
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      const i = world.idx(x, y);
      if (world.roads[i] !== 0) {
        world.roads[i] = 0;
        roadsRemoved++;
      }
      const b = world.buildingAt[i]!;
      if (b >= 0) toRemove.add(b);
    }
  }
  for (const b of [...toRemove].sort((p, q) => p - q)) removeBuilding(ctx, b, "demolido pelo prefeito");
  if (roadsRemoved > 0) {
    world.roadVersion++;
    world.zoneVersion++;
    world.mapVersion++;
    ctx.onRoadsRemoved();
  }
  if (roadsRemoved === 0 && toRemove.size === 0) return { ok: true, cost: 0, reason: "nada para demolir" };
  void buildings;
  return { ok: true, cost: 0 };
}

export function removeBuilding(
  ctx: Pick<CommandContext, "world" | "buildings" | "onBuildingRemoved">,
  id: number,
  reason: string,
) {
  const { world, buildings } = ctx;
  if (buildings.state[id] === BSTATE.demolished) return;
  ctx.onBuildingRemoved(id, reason);
  const x = buildings.x[id]!;
  const y = buildings.y[id]!;
  for (let dy = 0; dy < buildings.h[id]!; dy++) {
    for (let dx = 0; dx < buildings.w[id]!; dx++) {
      const i = world.idx(x + dx, y + dy);
      if (world.buildingAt[i] === id) world.buildingAt[i] = -1;
    }
  }
  buildings.setState(id, BSTATE.demolished);
  world.mapVersion++;
  world.zoneVersion++;
}

function placeService(ctx: CommandContext, service: string, x: number, y: number): Partial {
  const { world, buildings, network } = ctx;
  const typeIdx = buildings.catalog.findIndex((b) => b.id === service && b.service);
  if (typeIdx < 0) return { ok: false, reason: `serviço desconhecido: ${service}` };
  const t = buildings.catalog[typeIdx]!;
  for (let dy = 0; dy < t.h; dy++) {
    for (let dx = 0; dx < t.w; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!world.inBounds(tx, ty)) return { ok: false, reason: "não cabe no mapa" };
      const i = world.idx(tx, ty);
      if (world.roads[i] !== 0) return { ok: false, reason: `tem uma via em (${tx}, ${ty})` };
      if (world.buildingAt[i]! >= 0) return { ok: false, reason: `tem um prédio em (${tx}, ${ty})` };
    }
  }
  const [access, facing] = network.findAccess(x, y, t.w, t.h);
  if (access < 0) return { ok: false, reason: `${t.label} precisa encostar numa via` };
  if (!ctx.treasury.trySpend(t.cost, "obras_servicos")) {
    return { ok: false, reason: `dinheiro insuficiente (custa R$ ${fmt(t.cost)})` };
  }
  const ready = ctx.tick + Math.round((t.constructionMonths / 12) * ctx.ticksPerDay);
  const id = buildings.add(typeIdx, x, y, access, facing, ready, ctx.variantFor(x, y));
  for (let dy = 0; dy < t.h; dy++) {
    for (let dx = 0; dx < t.w; dx++) {
      const i = world.idx(x + dx, y + dy);
      world.buildingAt[i] = id;
      world.zones[i] = 0;
      world.trees[i] = 0;
    }
  }
  world.mapVersion++;
  return { ok: true, cost: t.cost };
}

export function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
