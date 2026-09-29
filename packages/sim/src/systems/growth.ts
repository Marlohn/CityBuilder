/**
 * Crescimento das zonas: quando falta casa ou emprego, construtoras começam obras nos lotes zoneados.
 * Demanda (docs/PLANO.md 5.5):
 *  - Casas: vagas de emprego (aqui e fora) que ainda não têm quem more perto + famílias esperando casa.
 *  - Comércio/indústria: moradores sem emprego ou trabalhando fora (preferem emprego perto de casa).
 */
import { ZONE_ID } from "@city/contract";
import type { City } from "../city";
import type { BuildingType } from "../config/schema";
import { IndexedSet } from "../core/indexedSet";
import { type Census, takeCensus } from "../people/census";
import type { System } from "../sim";
import { BSTATE } from "../world/buildings";

const EVERY = 10;

export interface Demand {
  homes: number;
  commercialJobs: number;
  industrialJobs: number;
}

export class GrowthSystem implements System {
  readonly name = "growth";
  /** Lotes livres por zona (índice = id da zona). Validados na hora de usar. */
  private lots: IndexedSet[] = [];
  private lotsVersion = -1;
  private startsBudget = 0;
  demand: Demand = { homes: 0, commercialJobs: 0, industrialJobs: 0 };
  census: Census | null = null;
  private byZone: Map<number, { type: BuildingType; idx: number }[]> = new Map();

  constructor(private city: City) {
    const cat = city.sim.buildings.catalog;
    cat.forEach((t, idx) => {
      if (!t.zone) return;
      const z = ZONE_ID[t.zone];
      const list = this.byZone.get(z) ?? [];
      list.push({ type: t, idx });
      this.byZone.set(z, list);
    });
  }

  tick() {
    const { sim } = this.city;
    if (sim.clock.tick % EVERY !== 0) return;
    this.census = takeCensus(this.city);
    this.demand = this.computeDemand(this.census);
    const cfg = sim.config.growth;
    this.startsBudget += (cfg.maxConstructionStartsPerDay * EVERY) / sim.clock.ticksPerDay;
    if (this.startsBudget < 1) return;
    this.refreshLots();
    let guard = 0;
    while (this.startsBudget >= 1 && guard++ < 64) {
      const started = this.startOne();
      if (!started) break;
      this.startsBudget -= 1;
    }
    // Sem lote ou sem demanda: o orçamento de obras não acumula para sempre.
    this.startsBudget = Math.min(this.startsBudget, 4);
  }

  private computeDemand(c: Census): Demand {
    const city = this.city;
    const { markets, sim } = city;
    const cfg = sim.config;
    const g = cfg.growth;
    const vacantHomes = markets.housing.vacancies();
    const vacantJobs = markets.jobs.vacancies();
    const pending = this.pendingCapacity();
    const jobs = this.jobsByZone();
    const workers = c.employedLocal + c.employedOutside;
    const workersPerHousehold = c.households > 20 ? Math.max(0.6, workers / c.households) : 1.2;
    // Casas: para quem vai ocupar as vagas de emprego (aqui e na cidade vizinha) + famílias esperando casa.
    const oj = cfg.population.outsideJobs;
    const outsideCapacity = oj.enabled
      ? Math.max(oj.minWorkers, oj.share * workers) - city.outsideWorkers
      : 0;
    const jobsWaiting = Math.max(0, vacantJobs + Math.max(0, outsideCapacity) - c.byRole[3]!);
    let homes = jobsWaiting / workersPerHousehold - vacantHomes - pending.homes + c.householdsWaitingHome;
    if (c.population === 0) homes = Math.max(homes, g.initialResidentialDemand - pending.homes);
    // Indústria (básico): cresce enquanto consegue contratar.
    const indVacancy = jobs.industrialCapacity > 0 ? jobs.industrialVacant / jobs.industrialCapacity : 0;
    const industrial =
      indVacancy < g.industryMaxVacancy
        ? Math.max(
            g.industryMinStep,
            g.industryGrowthPerYear * city.sim.modifiers.industryGrowth * jobs.industrialCapacity,
          ) - pending.industrialJobs
        : 0;
    // Comércio e serviços (não básico): multiplicador sobre os empregos básicos.
    const basic = jobs.industrialFilled + city.outsideWorkers;
    const commercial =
      (g.employmentMultiplier - 1) * basic - jobs.commercialCapacity - pending.commercialJobs;
    return {
      homes: Math.max(0, homes),
      commercialJobs: Math.max(0, commercial),
      industrialJobs: Math.max(0, industrial),
    };
  }

  private jobsByZone() {
    const b = this.city.sim.buildings;
    const out = { industrialCapacity: 0, industrialFilled: 0, industrialVacant: 0, commercialCapacity: 0 };
    for (let id = 0; id < b.count; id++) {
      if (!b.isActive(id)) continue;
      const t = b.typeOf(id);
      if (t.zone === "industrial") {
        out.industrialCapacity += t.jobs;
        out.industrialFilled += b.jobsFilled[id]!;
      } else if (t.zone === "commercial") out.commercialCapacity += t.jobs;
    }
    out.industrialVacant = out.industrialCapacity - out.industrialFilled;
    return out;
  }

  /** Capacidade que já está em obra (para não construir demais). */
  private pendingCapacity(): Demand {
    const b = this.city.sim.buildings;
    const out: Demand = { homes: 0, commercialJobs: 0, industrialJobs: 0 };
    for (let id = 0; id < b.count; id++) {
      if (b.state[id] !== BSTATE.constructing) continue;
      const t = b.typeOf(id);
      out.homes += t.homes;
      if (t.zone === "commercial") out.commercialJobs += t.jobs;
      if (t.zone === "industrial") out.industrialJobs += t.jobs;
    }
    return out;
  }

  /** Recria a lista de lotes quando zonas ou vias mudam. */
  private refreshLots() {
    const { world } = this.city.sim;
    if (this.lotsVersion === world.zoneVersion) return;
    this.lotsVersion = world.zoneVersion;
    this.lots = [0, 1, 2, 3, 4].map(() => new IndexedSet());
    for (let i = 0; i < world.size; i++) {
      const z = world.zones[i]!;
      if (z === 0 || world.buildingAt[i]! >= 0 || world.roads[i] !== 0) continue;
      if (this.touchesRoad(i)) this.lots[z]!.add(i);
    }
  }

  private touchesRoad(i: number): boolean {
    const w = this.city.sim.world;
    for (let d = 0; d < 4; d++) {
      const n = w.neighbor(i, d);
      if (n >= 0 && w.roads[n] !== 0) return true;
    }
    return false;
  }

  /** Escolhe a zona com mais demanda e tenta começar uma obra. */
  private startOne(): boolean {
    const d = this.demand;
    const options: [number, number][] = [];
    if (d.homes >= 1) {
      options.push([ZONE_ID.residential_low, d.homes]);
      options.push([ZONE_ID.residential_high, d.homes]);
    }
    if (d.commercialJobs >= 1) options.push([ZONE_ID.commercial, d.commercialJobs]);
    if (d.industrialJobs >= 1) options.push([ZONE_ID.industrial, d.industrialJobs]);
    options.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    for (const [zone] of options) {
      if (this.lots[zone]!.size === 0) continue;
      if (this.tryBuild(zone)) return true;
    }
    return false;
  }

  private tryBuild(zone: number): boolean {
    const city = this.city;
    const { world, buildings, network, clock } = city.sim;
    const rng = city.rng.growth;
    const lots = this.lots[zone]!;
    const types = this.byZone.get(zone) ?? [];
    // Sorteia alguns lotes e prefere os que têm mais vizinhos construídos (a cidade cresce em volta do que já existe).
    let best = -1;
    let bestScore = -1;
    for (let k = 0; k < 8 && lots.size > 0; k++) {
      const i = lots.random(rng);
      if (world.zones[i] !== zone || world.buildingAt[i]! >= 0) {
        lots.delete(i);
        continue;
      }
      const score = this.builtAround(i) + rng.float() * 0.5;
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best < 0) return false;
    const x = world.xOf(best);
    const y = world.yOf(best);
    // Tipos maiores primeiro (quando cabem), depois os menores.
    const ordered = [...types].sort((a, b) => b.type.w * b.type.h - a.type.w * a.type.h);
    for (const { type, idx } of ordered) {
      if (type.w * type.h > 1 && rng.float() < 0.5 && ordered.length > 1) continue;
      for (const [ox, oy] of anchorsFor(type.w, type.h)) {
        const ax = x - ox;
        const ay = y - oy;
        if (!this.fits(ax, ay, type.w, type.h, zone)) continue;
        const [access, facing] = network.findAccess(ax, ay, type.w, type.h);
        if (access < 0) continue;
        if (city.sim.config.growth.requiresOutsideConnection && network.exitFor(access) < 0) continue;
        // Sem água e luz sobrando nesta malha de ruas, a construtora não constrói (ninguém compraria).
        const u = city.utilities;
        if (u && !u.canSupply(access, u.demandOf(type.homes, type.jobs), true)) continue;
        const ready = clock.tick + Math.round((type.constructionMonths / 12) * clock.ticksPerDay);
        const variant = rng.int(65536);
        const id = buildings.add(idx, ax, ay, access, facing, ready, variant);
        for (let dy = 0; dy < type.h; dy++) {
          for (let dx = 0; dx < type.w; dx++) {
            const t = world.idx(ax + dx, ay + dy);
            world.buildingAt[t] = id;
            world.trees[t] = 0;
            lots.delete(t);
          }
        }
        world.mapVersion++;
        city.sim.log.debug("growth", "construction-start", {
          entity: `building:${id}`,
          data: { type: type.id, x: ax, y: ay },
        });
        return true;
      }
    }
    return false;
  }

  private fits(x: number, y: number, w: number, h: number, zone: number): boolean {
    const world = this.city.sim.world;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (!world.inBounds(x + dx, y + dy)) return false;
        const i = world.idx(x + dx, y + dy);
        if (world.zones[i] !== zone || world.buildingAt[i]! >= 0 || world.roads[i] !== 0) return false;
      }
    }
    return true;
  }

  private builtAround(i: number): number {
    const world = this.city.sim.world;
    const x = world.xOf(i);
    const y = world.yOf(i);
    let n = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (world.inBounds(x + dx, y + dy) && world.buildingAt[world.idx(x + dx, y + dy)]! >= 0) n++;
      }
    }
    return n;
  }
}

/** Posições do lote sorteado dentro do prédio (para prédios maiores que 1x1). */
function anchorsFor(w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let oy = 0; oy < h; oy++) for (let ox = 0; ox < w; ox++) out.push([ox, oy]);
  return out;
}
