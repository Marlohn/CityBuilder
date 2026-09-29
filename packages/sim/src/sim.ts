/**
 * A simulação: junta mundo, prédios, pessoas e sistemas, e avança o tempo tick a tick.
 *
 * Princípio: a performance nunca muda o resultado, só a velocidade.
 * Mesma semente + mesmos comandos nos mesmos ticks = mesma cidade.
 */
import type { Command, CommandResult, DirectorParam, TimedCommand } from "@city/contract";
import { applyCommand, type CommandContext } from "./commands/apply";
import type { GameData } from "./config/load";
import type { GameConfig } from "./config/schema";
import { Logger } from "./core/log";
import { Perf } from "./core/perf";
import { hashString, Rng } from "./core/rng";
import { Clock } from "./core/time";
import { Treasury } from "./economy/treasury";
import { BSTATE, Buildings } from "./world/buildings";
import { RoadNetwork } from "./world/roadNetwork";
import { World } from "./world/world";

export interface SimOptions {
  config: GameConfig;
  data: GameData;
  seed: string;
}

/** Um sistema roda uma vez por tick, na ordem da lista. */
export interface System {
  readonly name: string;
  tick(): void;
  /** Um prédio foi demolido ou abandonado: tire as pessoas dele. */
  onBuildingRemoved?(id: number, reason: string): void;
  /** Alguma via sumiu. */
  onRoadsRemoved?(): void;
  /** Um prédio terminou a obra e começou a funcionar. */
  onBuildingReady?(id: number): void;
  /** Um serviço mudou de lugar. */
  onBuildingMoved?(id: number): void;
}

export class Simulation {
  readonly config: GameConfig;
  readonly data: GameData;
  readonly seed: string;
  readonly clock: Clock;
  readonly rng: Rng;
  readonly log: Logger;
  readonly perf: Perf;
  readonly world: World;
  readonly network: RoadNetwork;
  readonly buildings: Buildings;
  readonly treasury: Treasury;
  readonly systems: System[] = [];
  /** Todos os comandos aplicados, com o tick (para save e replay). */
  readonly commandLog: TimedCommand[] = [];
  /** Multiplicadores ajustados pela diretora (IA opcional). 1 = regra normal. */
  readonly modifiers: Record<DirectorParam, number> = { immigration: 1, industryGrowth: 1 };
  private queue: Command[] = [];
  private results: CommandResult[] = [];

  constructor(opts: SimOptions) {
    this.config = opts.config;
    this.data = opts.data;
    this.seed = opts.seed;
    this.clock = new Clock(opts.config.time);
    this.rng = new Rng(opts.seed);
    this.log = new Logger(opts.config.logging, () => this.clock.tick);
    this.perf = new Perf(opts.config.performance.timingWindow);
    const w = opts.config.world;
    this.world = new World(w.width, w.height, w.tileMeters);
    if (w.water.enabled) {
      // Fica seco: a faixa da estrada de acesso (oeste, linha do meio) com folga.
      const mid = Math.floor(w.height / 2);
      const len = w.startingRoad.enabled ? w.startingRoad.length : 0;
      this.world.generateWater(
        this.rng.stream("water"),
        w.water,
        { x0: 0, y0: mid - 6, x1: len + 6, y1: mid + 6 },
        // Lagos longe da linha do meio (onde a avenida principal costuma crescer).
        { x0: 0, y0: mid - 10, x1: w.width, y1: mid + 10 },
      );
    }
    this.world.generateTrees(this.rng.stream("terrain"), w.treeCoverage);
    this.network = new RoadNetwork(this.world);
    this.buildings = new Buildings(opts.data.buildings);
    this.treasury = new Treasury(opts.config.economy.startingMoney, opts.config.economy.mode);
  }

  get tick(): number {
    return this.clock.tick;
  }

  addSystem(s: System) {
    this.systems.push(s);
  }

  /** O comando é aplicado no começo do próximo tick. */
  enqueue(command: Command) {
    this.queue.push(command);
  }

  /** Resultados dos comandos desde a última chamada. */
  drainResults(): CommandResult[] {
    const r = this.results;
    this.results = [];
    return r;
  }

  step(n = 1) {
    for (let i = 0; i < n; i++) this.stepOnce();
  }

  /** Avança até o começo do dia `day`. */
  runUntilDay(day: number) {
    while (this.clock.day < day) this.stepOnce();
  }

  private stepOnce() {
    this.perf.beginTick();
    this.perf.time("commands", () => this.applyQueued());
    this.perf.time("construction", () => this.finishConstructions());
    for (const s of this.systems) this.perf.time(s.name, () => s.tick());
    this.clock.tick++;
  }

  private applyQueued() {
    if (this.queue.length === 0) return;
    const queued = this.queue;
    this.queue = [];
    const ctx = this.commandContext();
    for (const c of queued) {
      this.commandLog.push({ tick: this.clock.tick, command: c });
      this.results.push(applyCommand(ctx, c));
    }
  }

  commandContext(): CommandContext {
    return {
      world: this.world,
      buildings: this.buildings,
      network: this.network,
      treasury: this.treasury,
      config: this.config,
      log: this.log,
      tick: this.clock.tick,
      ticksPerDay: this.clock.ticksPerDay,
      onBuildingRemoved: (id, reason) => {
        for (const s of this.systems) s.onBuildingRemoved?.(id, reason);
      },
      onRoadsRemoved: () => {
        for (const s of this.systems) s.onRoadsRemoved?.();
      },
      onBuildingMoved: (id) => {
        for (const s of this.systems) s.onBuildingMoved?.(id);
      },
      modifiers: this.modifiers,
      variantFor: (x, y) => hashString(`${this.seed}:${x}:${y}`)[0] & 0xffff,
    };
  }

  private constructingIds: number[] = [];
  private constructingSeen = 0;

  /** Obras que ficaram prontas neste tick. */
  private finishConstructions() {
    const b = this.buildings;
    // Registra os prédios novos desde o último tick.
    for (; this.constructingSeen < b.count; this.constructingSeen++)
      this.constructingIds.push(this.constructingSeen);
    if (this.constructingIds.length === 0) return;
    const still: number[] = [];
    for (const id of this.constructingIds) {
      if (b.state[id] !== BSTATE.constructing) continue;
      if (b.readyTick[id]! <= this.clock.tick) {
        b.setState(id, BSTATE.active);
        this.log.debug("construction", "ready", {
          entity: `building:${id}`,
          data: { type: b.typeOf(id).id },
        });
        for (const s of this.systems) s.onBuildingReady?.(id);
      } else still.push(id);
    }
    this.constructingIds = still;
  }
}
