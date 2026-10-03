/**
 * Aplica comandos no mundo. Cada regra aqui tenta fazer sentido na vida real:
 * via reta, via não atravessa prédio, prédio de serviço precisa de acesso por via, obra custa dinheiro.
 */
import { type Command, type CommandResult, type DirectorParam, ROAD_ID, ZONE_ID } from "@city/contract";
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
  /** Chamado quando um serviço muda de lugar (quem ficou longe procura outro). */
  onBuildingMoved: (id: number) => void;
  variantFor: (x: number, y: number) => number;
  /** Multiplicadores ajustados pela diretora (IA opcional). */
  modifiers: Record<DirectorParam, number>;
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
    case "moveService":
      return moveService(ctx, c.building, c.x, c.y);
    case "directorAdjust":
      return directorAdjust(ctx, c.param, c.factor);
  }
}

/** Ajuste da diretora: só dentro dos limites da config. Vale até o próximo ajuste do mesmo item. */
function directorAdjust(ctx: CommandContext, param: DirectorParam, factor: number): Partial {
  const [min, max] = ctx.config.director.limits[param];
  if (factor < min || factor > max)
    return { ok: false, reason: `fora do limite: ${param} aceita de ${min} a ${max}, pediu ${factor}` };
  ctx.modifiers[param] = factor;
  return { ok: true };
}

function clampRect(world: World, x0: number, y0: number, x1: number, y1: number) {
  return {
    ax: Math.max(0, Math.min(x0, x1)),
    ay: Math.max(0, Math.min(y0, y1)),
    bx: Math.min(world.width - 1, Math.max(x0, x1)),
    by: Math.min(world.height - 1, Math.max(y0, y1)),
  };
}

/**
 * Aviso de via solta: a via foi construída, mas material e gente só chegam pela estrada de acesso
 * (a malha ligada à borda do mapa). Sem ligação, nenhuma construtora começa obra ali — o mesmo
 * formato do aviso que o serviço sem via já devolve (mensagem em `reason`).
 */
const DISCONNECTED_ROAD_WARNING =
  "Via desconectada: nada será construído ao lado dela até ela se ligar à avenida de acesso do oeste.";

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
      if (world.water[i])
        return { ok: false, reason: `tem água em (${x}, ${y}) (ponte ainda não existe no jogo)` };
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
  return {
    ok: true,
    cost,
    ...(ctx.network.exitFor(tiles[0]!) < 0 ? { reason: DISCONNECTED_ROAD_WARNING } : {}),
  };
}

function zone(ctx: CommandContext, zoneId: number, x0: number, y0: number, x1: number, y1: number): Partial {
  const { world } = ctx;
  const { ax, ay, bx, by } = clampRect(world, x0, y0, x1, y1);
  let changed = 0;
  let skippedBuilt = 0;
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      const i = world.idx(x, y);
      if (world.roads[i] !== 0 || world.water[i]) continue;
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
      if (world.water[i]) return { ok: false, reason: `tem água em (${tx}, ${ty})` };
      if (world.buildingAt[i]! >= 0) return { ok: false, reason: `tem um prédio em (${tx}, ${ty})` };
    }
  }
  const [access, facing] = network.findAccess(x, y, t.w, t.h);
  if (access < 0) return { ok: false, reason: `${t.label} precisa encostar numa via` };
  if (t.nearWater > 0 && !nearWater(world, x, y, t.w, t.h, t.nearWater))
    return { ok: false, reason: `${t.label} precisa ficar a até ${t.nearWater} quadradinhos de rio ou lago` };
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

/** Muda um serviço de lugar: mesmo prédio (mesmos alunos e pacientes), outro terreno. */
function moveService(ctx: CommandContext, id: number, x: number, y: number): Partial {
  const { world, buildings, network } = ctx;
  if (id >= buildings.count || buildings.state[id] === BSTATE.demolished)
    return { ok: false, reason: "prédio não existe" };
  const t = buildings.typeOf(id);
  if (!t.service) return { ok: false, reason: `${t.label} não pode ser movido (só serviços)` };
  if (buildings.x[id] === x && buildings.y[id] === y) return { ok: true, cost: 0, reason: "já está aí" };
  for (let dy = 0; dy < t.h; dy++) {
    for (let dx = 0; dx < t.w; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!world.inBounds(tx, ty)) return { ok: false, reason: "não cabe no mapa" };
      const i = world.idx(tx, ty);
      if (world.roads[i] !== 0) return { ok: false, reason: `tem uma via em (${tx}, ${ty})` };
      if (world.water[i]) return { ok: false, reason: `tem água em (${tx}, ${ty})` };
      const other = world.buildingAt[i]!;
      if (other >= 0 && other !== id) return { ok: false, reason: `tem um prédio em (${tx}, ${ty})` };
    }
  }
  const [access, facing] = network.findAccess(x, y, t.w, t.h);
  if (access < 0) return { ok: false, reason: `${t.label} precisa encostar numa via` };
  if (t.nearWater > 0 && !nearWater(world, x, y, t.w, t.h, t.nearWater))
    return { ok: false, reason: `${t.label} precisa ficar a até ${t.nearWater} quadradinhos de rio ou lago` };
  const cost = Math.round(t.cost * ctx.config.economy.serviceMoveCostShare);
  if (!ctx.treasury.trySpend(cost, "obras_servicos")) {
    return { ok: false, reason: `dinheiro insuficiente (mudar custa R$ ${fmt(cost)})` };
  }
  const ox = buildings.x[id]!;
  const oy = buildings.y[id]!;
  for (let dy = 0; dy < t.h; dy++)
    for (let dx = 0; dx < t.w; dx++) world.buildingAt[world.idx(ox + dx, oy + dy)] = -1;
  for (let dy = 0; dy < t.h; dy++) {
    for (let dx = 0; dx < t.w; dx++) {
      const i = world.idx(x + dx, y + dy);
      world.buildingAt[i] = id;
      world.zones[i] = 0;
      world.trees[i] = 0;
    }
  }
  buildings.x[id] = x;
  buildings.y[id] = y;
  buildings.access[id] = access;
  buildings.facing[id] = facing;
  buildings.structureVersion++;
  world.mapVersion++;
  ctx.onBuildingMoved(id);
  return { ok: true, cost };
}

/** Tem água (rio ou lago) a até `d` quadradinhos do retângulo? */
function nearWater(world: World, x: number, y: number, w: number, h: number, d: number): boolean {
  for (let ty = y - d; ty < y + h + d; ty++)
    for (let tx = x - d; tx < x + w + d; tx++)
      if (world.inBounds(tx, ty) && world.water[world.idx(tx, ty)]) return true;
  return false;
}

export function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
