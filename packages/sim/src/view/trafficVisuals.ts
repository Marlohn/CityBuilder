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
  maxActive: 4000,
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
    this.consume();
    const now = this.clock;
    this.active = this.active.filter((t) => now - t.start < t.duration);
    this.carsOnScreen.clear();
    for (const t of this.active) if (t.kind === "car") this.carsOnScreen.add(t.id);
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
    if (this.active.length > this.opts.maxActive)
      this.active.splice(0, this.active.length - this.opts.maxActive);
  }

  private start(t: TripStart) {
    const tiles = t.kind === "car" ? (t.tiles ?? null) : this.walkPath(t.from ?? -1, t.to ?? -1);
    if (!tiles || tiles.length < 2) return;
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
