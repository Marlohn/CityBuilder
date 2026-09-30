/**
 * Trânsito para a tela (só visual; a simulação não lê nada daqui, então a cidade continua reproduzível).
 *
 * Por que existe: 1 dia do jogo dura 2 minutos na velocidade 1x, então 1 minuto do jogo dura 0,08 s.
 * Uma viagem real de 2 minutos ficaria 0,2 s na tela e o carro "piscaria". Aqui cada viagem que começa
 * na simulação (carro com a rota de verdade, ou pessoa a pé) é desenhada percorrendo o caminho real
 * numa velocidade que dá para ver. Nada é inventado: só aparece quem de fato saiu.
 */
import type { Game } from "../game";
import { OUTSIDE_JOB } from "../people/population";
import { Pathfinder, tileCostDs } from "../routing/pathfinder";
import type { TripStart } from "../traffic/trafficSystem";
import { VSTATE } from "../traffic/vehicles";

/** Tipo usado na tela para pessoas a pé (carros usam 0..N). */
export const PEDESTRIAN_TYPE = 100;

/**
 * Folga da folga de ponto flutuante ao fechar uma viagem na tela. Nao e regra de jogo: e o erro de
 * arredondamento de somar 1/12 s de relogio visual por quadro.
 */
const SLACK = 1e-9;

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
    // Fim inclusivo (<=) com folga de ponto flutuante: a viagem que termina neste quadro ainda e
    // desenhada nele (positions() trava o carro no ultimo quadradinho). Sem isso o carro com
    // emprego fora, cuja duracao e o tempo real ate o motor chegar, sumiria no proprio quadro da
    // chegada: a soma do relogio visual (1/12 s por quadro) passa do duration por ~1e-17.
    this.active = this.active.filter((t) => now - t.start <= t.duration * (1 + SLACK));
    this.carsOnScreen.clear();
    for (const t of this.active) if (t.kind === "car") this.carsOnScreen.add(t.id);
    // O log de viagens do motor é aparado (splice) e pode perder o começo da viagem.
    // A tela reconcilia os parados para nunca deixar carro andando invisível.
    const vehs = this.game.traffic.vehicles;
    for (let i = 0; i < vehs.moving.size; i++) {
      const v = vehs.moving.at(i)!;
      if (this.carsOnScreen.has(v)) continue;
      const route = vehs.routes[v];
      if (!route || route.length < 1) continue;
      const outside = this.outsideVisualDuration(v);
      if (outside !== null) {
        // Carro para fora sem viagem na tela (log aparado): desenha a rota real ate a saida,
        // com a duracao ate o arriveTick, para nao sumir no meio do caminho.
        let tiles: Int32Array = route;
        if (tiles.length === 1) tiles = Int32Array.from([tiles[0]!, tiles[0]!]);
        this.active.push({
          kind: "car",
          id: v,
          model: vehs.model[v]!,
          tiles,
          start: this.clock,
          duration: outside,
        });
        this.carsOnScreen.add(v);
        continue;
      }
      const last = route[route.length - 1]!;
      this.active.push({
        kind: "car",
        id: v,
        model: vehs.model[v]!,
        tiles: Int32Array.of(last, last),
        start: this.clock,
        duration: this.opts.maxSeconds,
      });
      this.carsOnScreen.add(v);
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
      // Viagem cortada vira viagem parada no último quadradinho com a duração restante, porque o corte não pode tirar o carro de cena.
      const cut = this.active.splice(0, this.active.length - this.opts.maxActive);
      const now = this.clock;
      const states = this.game.traffic.vehicles.state;
      for (const old of cut) {
        if (old.kind !== "car") continue;
        if (old.id < 0 || old.id >= states.length) continue;
        if (states[old.id] !== VSTATE.moving) continue;
        const left = old.duration - (now - old.start);
        if (left <= 0) continue;
        const last = old.tiles[old.tiles.length - 1]!;
        this.active.push({
          kind: "car",
          id: old.id,
          model: old.model,
          tiles: Int32Array.from([last, last]),
          start: now,
          duration: left,
        });
      }
    }
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
    let duration = Math.min(this.opts.maxSeconds, tiles.length / speed);
    if (t.kind === "car") {
      // Carro com emprego fora: a viagem do motor dura 1-2 ticks e a tela em 6 s faria o carro
      // sumir no meio do caminho. A duracao passa a ser o tempo real ate o arriveTick, sem o
      // teto de maxSeconds. Se ja passou do arriveTick, mantem o comportamento atual.
      const outside = this.outsideVisualDuration(t.id);
      if (outside !== null) duration = outside;
    }
    if (t.kind === "car") this.active = this.active.filter((a) => !(a.kind === "car" && a.id === t.id));
    this.active.push({ kind: t.kind, id: t.id, model: t.model, tiles, start: this.clock, duration });
  }

  /**
   * Duracao visual para carro com emprego fora (segundos de tela) ou null para manter o atual.
   * E o tempo real ate o motor estacionar, sem o teto de maxSeconds: os ticks que faltam ate a
   * chegada observada, convertidos para segundos de tela pelo relogio
   * (ticksPorDia / segundosReaisPorDia), sem literal fixo e sem numero de regra novo.
   * O +1 e necessario porque o relogio incrementa depois dos sistemas (sim.ts stepOnce): o
   * departTick e gravado antes do incremento, entao entre o tickAtual (pos-step) e a chegada
   * observada (pos-step do arriveTick) ha arriveTick - tickAtual + 1 quadros. Sem ele, viagem de
   * 1 tick teria duracao 0 e a de 2 ticks expiraria um quadro antes da chegada (avance 0).
   * Se o arriveTick ja passou (carro deveria ter chegado), devolve null.
   */
  private outsideVisualDuration(v: number): number | null {
    const vehs = this.game.traffic.vehicles;
    if (v < 0 || v >= vehs.count) return null;
    if (vehs.destBuilding[v] !== OUTSIDE_JOB) return null;
    const left = vehs.arriveTick[v]! - this.game.sim.clock.tick;
    if (left < 0) return null;
    const ticksPerSecond = this.game.sim.clock.ticksPerDay / this.game.sim.config.time.realSecondsPerDayAt1x;
    if (!(ticksPerSecond > 0)) return null;
    return (left + 1) / ticksPerSecond;
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
