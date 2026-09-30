/**
 * Trânsito para a tela (só visual; a simulação não lê nada daqui, então a cidade continua reproduzível).
 *
 * Por que existe: 1 dia do jogo dura 2 minutos na velocidade 1x, então 1 minuto do jogo dura 0,08 s.
 * Uma viagem real de 2 minutos ficaria 0,2 s na tela e o carro "piscaria". Aqui cada viagem que começa
 * na simulação (carro com a rota de verdade, ou pessoa a pé) é desenhada percorrendo o caminho real
 * numa velocidade que dá para ver. Nada é inventado: só aparece quem de fato saiu.
 */
import type { Game } from "../game";
import { Pathfinder, tileCostDs } from "../routing/pathfinder";
import type { TripStart } from "../traffic/trafficSystem";
import { VSTATE } from "../traffic/vehicles";

/** Tipo usado na tela para pessoas a pé (carros usam 0..N). */
export const PEDESTRIAN_TYPE = 100;

export interface TrafficVisualOptions {
  /** Velocidade na tela (quadradinhos por segundo real). */
  carTilesPerSecond: number;
  walkTilesPerSecond: number;
  /** Tempo máximo na tela: viagens longas andam mais rápido para caber nele. */
  maxSeconds: number;
  /** Limite de viagens desenhadas ao mesmo tempo (as mais antigas saem primeiro). */
  maxActive: number;
}

export const DEFAULT_TRAFFIC_VISUALS: TrafficVisualOptions = {
  carTilesPerSecond: 5,
  walkTilesPerSecond: 1.2,
  maxSeconds: 6,
  // Limite técnico de tela, não é regra de jogo e não vai para a config.
  // Medição da issue 48 numa cidade de 9327 pessoas já bateu 4000 viagens ativas.
  maxActive: 8000,
};

interface VisualTrip {
  kind: "car" | "walk";
  id: number;
  model: number;
  tiles: Int32Array;
  start: number;
  duration: number;
}

export class TrafficVisuals {
  private active: VisualTrip[] = [];
  private seenSeq = 0;
  /** Relógio visual (segundos): para quando o jogo está pausado. */
  private clock = 0;
  private walkPaths = new Map<number, Int32Array | null>();
  private pathfinder: Pathfinder | null = null;
  private carsOnScreen = new Set<number>();
  /** Segundos visuais por tick do motor (estimado a cada advance). */
  private secondsPerTick = 1 / 12;
  private prevVisClock: number | null = null;
  private prevSimTick: number | null = null;

  constructor(
    private game: Game,
    private opts: TrafficVisualOptions = DEFAULT_TRAFFIC_VISUALS,
  ) {
    this.seenSeq = game.traffic.tripSeq;
  }

  /**
   * Avança o relógio visual. `speed` = velocidade do jogo (0 = pausado, 1 = 1x, 4 = 4x): na velocidade
   * 4x as viagens também andam 4x mais rápido na tela, para não ficarem na rua horas depois.
   */
  advance(realSeconds: number, speed: number) {
    if (speed > 0) this.clock += realSeconds * speed;
    // Estima quanto vale 1 tick em segundos visuais (para a viagem durar até o motor estacionar).
    const simTick = this.game.sim.clock.tick;
    if (speed > 0 && this.prevVisClock !== null && this.prevSimTick !== null) {
      const dClock = this.clock - this.prevVisClock;
      const dTick = simTick - this.prevSimTick;
      if (dClock > 0 && dTick > 0) this.secondsPerTick = dClock / dTick;
    }
    this.prevVisClock = this.clock;
    this.prevSimTick = simTick;
    this.consume();
    const now = this.clock;
    this.active = this.active.filter((t) => now - t.start < t.duration);
    this.carsOnScreen.clear();
    for (const t of this.active) if (t.kind === "car") this.carsOnScreen.add(t.id);
    // O log de viagens do motor é aparado (splice) e pode perder o começo da viagem.
    // A tela reconcilia com a rota real para nunca deixar carro andando invisível.
    const vehs = this.game.traffic.vehicles;
    const missing: VisualTrip[] = [];
    const missingIds = new Set<number>();
    for (let i = 0; i < vehs.moving.size; i++) {
      const v = vehs.moving.at(i)!;
      if (this.carsOnScreen.has(v)) continue;
      const trip = this.reconciledCarTrip(v);
      if (!trip) continue;
      missing.push(trip);
      missingIds.add(v);
    }
    if (missing.length > 0) {
      // Troca a viagem antiga do mesmo carro (igual ao start).
      this.active = this.active.filter((a) => !(a.kind === "car" && missingIds.has(a.id)));
      for (const trip of missing) {
        this.active.push(trip);
        this.carsOnScreen.add(trip.id);
      }
    }
  }

  /** Carros que estão sendo desenhados andando (a tela não desenha eles estacionados). */
  isCarOnScreen = (v: number) => this.carsOnScreen.has(v);

  get carsMoving(): number {
    return this.carsOnScreen.size;
  }

  get peopleWalking(): number {
    let n = 0;
    for (const t of this.active) if (t.kind === "walk") n++;
    return n;
  }

  private consume() {
    const traffic = this.game.traffic;
    const newCount = traffic.tripSeq - this.seenSeq;
    this.seenSeq = traffic.tripSeq;
    if (newCount <= 0) return;
    const log = traffic.tripLog;
    const first = Math.max(0, log.length - newCount);
    for (let i = first; i < log.length; i++) this.start(log[i]!);
    if (this.active.length > this.opts.maxActive) {
      // Corte não pode tirar o carro de cena: redesenha com a rota real até estacionar.
      const cut = this.active.splice(0, this.active.length - this.opts.maxActive);
      const states = this.game.traffic.vehicles.state;
      for (const old of cut) {
        if (old.kind !== "car") continue;
        if (old.id < 0 || old.id >= states.length) continue;
        if (states[old.id] !== VSTATE.moving) continue;
        const trip = this.reconciledCarTrip(old.id);
        if (!trip) continue;
        // Troca a viagem antiga do mesmo carro (igual ao start).
        this.active = this.active.filter((a) => !(a.kind === "car" && a.id === old.id));
        this.active.push(trip);
      }
    }
  }

  /**
   * Viagem visual refeita da rota real (para carro sem viagem na tela).
   * Começa no ponto do motor para não pular para o fim antes da hora.
   */
  private reconciledCarTrip(v: number): VisualTrip | null {
    const vehs = this.game.traffic.vehicles;
    const route = vehs.routes[v];
    if (!route || route.length < 1) return null;
    const tickNow = this.game.sim.clock.tick;
    const depart = vehs.departTick[v]!;
    const arrive = vehs.arriveTick[v]!;
    const model = vehs.model[v]!;
    // Já passou da hora de chegar: estaciona no fim para não esperar para sempre.
    if (tickNow >= arrive) {
      const tiles =
        route.length >= 2
          ? Int32Array.of(route[route.length - 2]!, route[route.length - 1]!)
          : Int32Array.of(route[0]!, route[0]!);
      return { kind: "car", id: v, model, tiles, start: this.clock, duration: this.opts.maxSeconds };
    }
    let tiles: Int32Array = route;
    if (tiles.length < 2) {
      // Rota curta: repete o quadradinho.
      tiles = Int32Array.from([tiles[0]!, tiles[0]!]);
    }
    const span = Math.max(1, arrive - depart);
    let f0 = (tickNow - depart) / span;
    if (f0 < 0) f0 = 0;
    if (f0 > 1) f0 = 1;
    // Margem para a tela nunca acabar antes do motor (ficar para trás pode).
    const SAFETY = 1.25;
    const raw = (arrive - tickNow) * this.secondsPerTick * SAFETY;
    const duration = raw > 0 ? raw : this.opts.maxSeconds;
    // Começa de trás para cair no ponto onde o motor já está.
    let start = this.clock - f0 * duration;
    if (start > this.clock) start = this.clock;
    return { kind: "car", id: v, model, tiles, start, duration };
  }

  private start(t: TripStart) {
    let tiles = t.kind === "car" ? (t.tiles ?? null) : this.walkPath(t.from ?? -1, t.to ?? -1);
    if (!tiles) return;
    if (t.kind === "car" && tiles.length === 1) {
      // Rota curta: repete o quadradinho.
      tiles = Int32Array.from([tiles[0]!, tiles[0]!]);
    }
    if (tiles.length < 2) return;
    const speed = t.kind === "car" ? this.opts.carTilesPerSecond : this.opts.walkTilesPerSecond;
    const duration = Math.min(this.opts.maxSeconds, tiles.length / speed);
    if (t.kind === "car") this.active = this.active.filter((a) => !(a.kind === "car" && a.id === t.id));
    this.active.push({ kind: t.kind, id: t.id, model: t.model, tiles, start: this.clock, duration });
  }

  /** Caminho a pé pelas vias (calçada), guardado para as próximas viagens iguais. */
  private walkPath(from: number, to: number): Int32Array | null {
    if (from < 0 || to < 0) return null;
    const world = this.game.sim.world;
    const key = from * world.size + to;
    const cached = this.walkPaths.get(key);
    if (cached !== undefined) return cached;
    if (!this.pathfinder) {
      const tm = world.tileMeters;
      // A pé a velocidade é a mesma em rua e avenida.
      const walk = tileCostDs(tm, this.game.sim.config.traffic.walking.speedKmh);
      this.pathfinder = new Pathfinder(world, { tileCost: [0, walk, walk] });
    }
    const path = this.pathfinder.find(from, to);
    if (this.walkPaths.size > 20000) this.walkPaths.clear();
    this.walkPaths.set(key, path);
    return path;
  }

  /** [x, y, ângulo, tipo] por objeto dentro do retângulo (mesmo formato de TrafficSystem.positions). */
  positions(rect: { x0: number; y0: number; x1: number; y1: number }): Float32Array {
    const world = this.game.sim.world;
    const out: number[] = [];
    const now = this.clock;
    for (const t of this.active) {
      const f = Math.min(1, Math.max(0, (now - t.start) / t.duration));
      const pos = f * (t.tiles.length - 1);
      const i = Math.min(t.tiles.length - 2, Math.floor(pos));
      const u = pos - i;
      const a = t.tiles[i]!;
      const b = t.tiles[i + 1]!;
      const ax = world.xOf(a) + 0.5;
      const ay = world.yOf(a) + 0.5;
      const dx = world.xOf(b) + 0.5 - ax;
      const dy = world.yOf(b) + 0.5 - ay;
      // Carro na mão direita; pedestre na calçada (mais para a borda da via).
      const side = t.kind === "car" ? 0.18 : 0.4;
      const x = ax + dx * u - dy * side;
      const y = ay + dy * u + dx * side;
      if (x < rect.x0 || y < rect.y0 || x > rect.x1 || y > rect.y1) continue;
      const angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dx, dy);
      out.push(x, y, angle, t.kind === "car" ? t.model : PEDESTRIAN_TYPE + t.model);
    }
    return Float32Array.from(out);
  }
}
