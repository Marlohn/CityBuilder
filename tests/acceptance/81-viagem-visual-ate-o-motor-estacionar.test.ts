/**
 * Issue #81 — a viagem visual tem de durar até o motor estacionar o carro.
 *
 * Contexto: a tela nunca desenha os carros que estão `moving` no motor (eles vêm só da
 * viagem visual, em `packages/sim/src/view/trafficVisuals.ts`). Quando o começo da viagem se
 * perde (a tela abre no meio do rush, o log do motor é aparado), a reconciliação no fim de
 * `TrafficVisuals.advance()` redesenha o carro PARADO no último quadradinho da rota com
 * duração `maxSeconds` — o carro pula para o fim da rota enquanto o motor ainda diz que ele
 * está no meio do caminho.
 *
 * Regra que este teste trava (dois lados do mesmo bug): enquanto o motor disser que o carro
 * está `moving` e ele ainda não chegou (`clock.tick < arriveTick`), (1) a viagem visual
 * (`VisualTrip.tiles`) tem de percorrer a ROTA REAL do motor — mesmo tamanho de
 * `veh.routes[v].length` e mesmos quadradinhos; (2) o ponto desenhado na tela (`positions()`)
 * tem de estar no mesmo quadradinho do progresso do motor (tolerância de 1 quadradinho).
 * Nota: a viagem visual é de propósito mais lenta que o motor (dá para ver o carro andando),
 * então o teste só cobra um lado da posição: a tela não pode correr NA FRENTE do motor e
 * mandar o carro para o fim da rota antes da hora. Ficar para trás é o comportamento
 * desenhado; pular para a frente é o bug. Hoje a reconciliação cria `Int32Array.of(last, last)`
 * (2 quadradinhos, o último repetido), então (1) falha na main.
 *
 * Cenário: cidade grande com prefeito automático (igual à `cidadeGrande` do teste 48) e a
 * tela criada BEM DEPOIS, no meio do rush da manhã e da tarde — igual a abrir o mapa com o
 * trânsito andando, quando o começo das viagens já se perdeu (é o caso que a reconciliação
 * do `advance()` diz cobrir). Cada janela mede 8 ticks com `vis.advance(1/12, 1)` por tick.
 */
import { statsView, TrafficVisuals } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** VSTATE.moving de packages/sim/src/traffic/vehicles.ts. */
const MOVING = 1;
/** O quadradinho desenhado pode estar no máximo 1 à frente do quadradinho do motor. */
const AHEAD_TOLERANCE = 1;
/** Horários de rush (ticks do dia): 7h19 da manhã e 14h58 da tarde. */
const RUSH_HOURS = [439, 898];
/** Quantas manhãs e tardes de rush a tela abre (cada abertura perde o começo das viagens). */
const RUSH_DAYS = 5;
/** Ticks medidos depois de cada abertura da tela (a viagem de motor dura no máximo 4 ticks). */
const WINDOW_TICKS = 8;

interface VisualTrip {
  kind: string;
  id: number;
  tiles: Int32Array;
  start: number;
  duration: number;
}

interface Worst {
  car: number;
  tick: number;
  depart: number;
  arrive: number;
  drawnIdx: number;
  drawnTile: number;
  engineIdx: number;
  engineTile: number;
  routeLen: number;
  route: string;
  visTiles: number;
  visRoute: string;
}

interface Medida {
  /** População da cidade (prova que tem gente morando e trabalhando). */
  population: number;
  /** Quadros (carro, tick) com o carro andando antes da hora de chegar. */
  movFrames: number;
  /** Carro andando sem nenhuma viagem visual (era para a reconciliação cobrir). */
  missing: number;
  /** Viagem visual que não percorre a ROTA REAL do motor (tamanho ou quadradinhos diferentes). */
  wrongRoute: number;
  /** Ponto desenhado que não bateu com nenhum ponto do positions() (não foi desenhado). */
  notDrawn: number;
  /** Quadradinho desenhado fora do caminho real do carro. */
  offPath: number;
  /** Quadradinho desenhado mais de 1 à frente do quadradinho do motor. */
  ahead: number;
  /** Desenhado no ÚLTIMO quadradinho com o motor a 2+ quadradinhos do fim (fim antes da hora). */
  earlyEnd: number;
  worstAhead: Worst | null;
  worstOff: Worst | null;
  worstRoute: Worst | null;
}

/** Progresso do motor: igual ao `positions()` do motor (`trafficSystem.ts`), que anda pela rota ponderada pelo tempo em cada quadradinho. */
function engineIndex(cum: Int32Array, tick: number, depart: number, arrive: number): number {
  const span = Math.max(1, arrive - depart);
  const f = Math.min(1, Math.max(0, (tick - depart) / span));
  const target = f * cum[cum.length - 1]!;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid]! <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Ponto (x, y) que a tela desenha: mesma conta do `positions()` da viagem visual. */
function drawnPoint(
  world: { xOf: (t: number) => number; yOf: (t: number) => number },
  tiles: Int32Array,
  start: number,
  duration: number,
  nowVis: number,
): { x: number; y: number; drawnTile: number } {
  const fv = Math.min(1, Math.max(0, (nowVis - start) / duration));
  const pos = fv * (tiles.length - 1);
  const i = Math.min(tiles.length - 2, Math.floor(pos));
  const u = pos - i;
  const a = tiles[i]!;
  const b = tiles[i + 1]!;
  const ax = world.xOf(a) + 0.5;
  const ay = world.yOf(a) + 0.5;
  const dx = world.xOf(b) + 0.5 - ax;
  const dy = world.yOf(b) + 0.5 - ay;
  // Carro na mão direita, igual ao desenho da tela.
  const x = ax + dx * u - dy * 0.18;
  const y = ay + dy * u + dx * 0.18;
  return { x, y, drawnTile: tiles[Math.round(pos)]! };
}

/** Posição do quadradinho desenhado dentro da rota real (de trás para frente, como quem procura o fim). */
function indexOnRoute(route: Int32Array, tiles: Int32Array, drawnTile: number, pos: number): number {
  if (tiles.length === route.length) {
    let same = true;
    for (let k = 0; k < route.length; k++) {
      if (tiles[k] !== route[k]) {
        same = false;
        break;
      }
    }
    // Viagem saudável: mesmos quadradinhos da rota, o índice é direto.
    if (same) return Math.round(pos);
  }
  for (let k = route.length - 1; k >= 0; k--) {
    if (route[k] === drawnTile) return k;
  }
  return -1;
}

function checkFrame(game: ReturnType<typeof createTestGame>, vis: TrafficVisuals, m: Medida): void {
  const s = game.sim;
  const world = s.world;
  const veh = game.traffic.vehicles;
  const nowVis = (vis as unknown as { clock: number }).clock;
  const active = (vis as unknown as { active: VisualTrip[] }).active;
  const byId = new Map<number, VisualTrip>();
  for (const a of active) if (a.kind === "car") byId.set(a.id, a);
  // Retângulo maior que o mapa: nenhum ponto desenhado pode ficar de fora.
  const pts = vis.positions({
    x0: -1,
    y0: -1,
    x1: world.width + 1,
    y1: world.height + 1,
  });
  const drawn = new Set<string>();
  for (let p = 0; p + 4 <= pts.length; p += 4) {
    drawn.add(Math.round(pts[p]! * 1e4) + "," + Math.round(pts[p + 1]! * 1e4));
  }
  for (let i = 0; i < veh.moving.size; i++) {
    const v = veh.moving.at(i)!;
    // Só vale antes da hora de chegar: depois disso o motor já devia ter estacionado.
    if (veh.state[v] !== MOVING) continue;
    if (!(s.clock.tick < veh.arriveTick[v]!)) continue;
    const route = veh.routes[v];
    const cum = veh.routeCum[v];
    if (!route || !cum || route.length < 2) continue;
    m.movFrames++;
    const trip = byId.get(v);
    if (!trip) {
      m.missing++;
      continue;
    }
    // A viagem visual tem de percorrer a ROTA REAL do motor: mesmo tamanho e mesmos quadradinhos.
    // Hoje a reconciliação cria Int32Array.of(last, last) (2 quadradinhos, o último repetido).
    let sameRoute = trip.tiles.length === route.length;
    if (sameRoute) {
      for (let k = 0; k < route.length; k++) {
        if (trip.tiles[k] !== route[k]) {
          sameRoute = false;
          break;
        }
      }
    }
    const lo = engineIndex(cum, s.clock.tick, veh.departTick[v]!, veh.arriveTick[v]!);
    const pt = drawnPoint(world, trip.tiles, trip.start, trip.duration, nowVis);
    const key = Math.round(pt.x * 1e4) + "," + Math.round(pt.y * 1e4);
    const routeMismatch = !sameRoute;
    if (routeMismatch) {
      m.wrongRoute++;
      if (!m.worstRoute) {
        m.worstRoute = {
          car: v,
          tick: s.clock.tick,
          depart: veh.departTick[v]!,
          arrive: veh.arriveTick[v]!,
          drawnIdx: -2,
          drawnTile: pt.drawnTile,
          engineIdx: lo,
          engineTile: route[Math.max(0, lo)]!,
          routeLen: route.length,
          route: Array.from(route).join(","),
          visTiles: trip.tiles.length,
          visRoute: Array.from(trip.tiles).join(","),
        };
      }
    }
    if (!drawn.has(key)) {
      m.notDrawn++;
      continue;
    }
    const fv = Math.min(1, Math.max(0, (nowVis - trip.start) / trip.duration));
    const pos = fv * (trip.tiles.length - 1);
    const drawnIdx = indexOnRoute(route, trip.tiles, pt.drawnTile, pos);
    const worst: Worst = {
      car: v,
      tick: s.clock.tick,
      depart: veh.departTick[v]!,
      arrive: veh.arriveTick[v]!,
      drawnIdx,
      drawnTile: pt.drawnTile,
      engineIdx: lo,
      engineTile: route[Math.max(0, lo)]!,
      routeLen: route.length,
      route: Array.from(route).join(","),
      visTiles: trip.tiles.length,
      visRoute: Array.from(trip.tiles).join(","),
    };
    if (drawnIdx < 0) {
      m.offPath++;
      if (!m.worstOff) m.worstOff = worst;
      continue;
    }
    if (drawnIdx - lo > AHEAD_TOLERANCE) {
      m.ahead++;
      if (!m.worstAhead) m.worstAhead = worst;
      // Fim antes da hora: parado no último quadradinho com o motor a 2+ do fim.
      if (drawnIdx === route.length - 1 && lo < route.length - 1 - AHEAD_TOLERANCE) m.earlyEnd++;
    }
  }
}

function medirViagem(): Medida {
  const game = createTestGame({
    seed: "viagem81",
    scenario: "bairro-basico",
    days: 60,
    bot: true,
  });
  const s = game.sim;
  const m: Medida = {
    population: statsView(game).population,
    movFrames: 0,
    missing: 0,
    wrongRoute: 0,
    notDrawn: 0,
    offPath: 0,
    ahead: 0,
    earlyEnd: 0,
    worstAhead: null,
    worstOff: null,
    worstRoute: null,
  };
  for (let d = 0; d < RUSH_DAYS; d++) {
    for (const tod of RUSH_HOURS) {
      while (s.clock.tickOfDay !== tod) s.step(1);
      // A tela abre agora, no meio do rush: o começo das viagens em andamento se perdeu,
      // igual a quando o log do motor é aparado. Resta só a reconciliação do advance().
      const vis = new TrafficVisuals(game);
      for (let k = 0; k < WINDOW_TICKS; k++) {
        s.step(1);
        vis.advance(1 / 12, 1);
        checkFrame(game, vis, m);
      }
    }
  }
  return m;
}

let cache: Medida | undefined;
function medida(): Medida {
  if (!cache) cache = medirViagem();
  return cache;
}

describe("a viagem visual dura até o motor estacionar", () => {
  it("desenha cada carro andando no caminho real dele", () => {
    const m = medida();
    const w = m.worstRoute;
    const detalhe = w
      ? ` carro=${w.car} tick=${w.tick} (saiu no tick ${w.depart}, chega no tick ${w.arrive})` +
        ` rota com ${w.routeLen} quadradinhos [${w.route}]` +
        ` viagem visual com ${w.visTiles} quadradinhos [${w.visRoute}]`
      : "";
    expect(
      m.movFrames,
      "a cidade não teve nenhum carro andando antes da hora de chegar, o teste não prova nada",
    ).toBeGreaterThan(0);
    expect(
      m.missing,
      `carro andando sem viagem visual na tela em ${m.missing} quadros de ${m.movFrames}:` +
        " a reconciliação era para desenhar todo carro andando",
    ).toBe(0);
    expect(
      m.wrongRoute,
      `viagem visual fora da rota real em ${m.wrongRoute} quadros de ${m.movFrames}:` +
        " era para o VisualTrip.tiles ter o mesmo tamanho e os mesmos quadradinhos da rota do motor." +
        detalhe,
    ).toBe(0);
  }, 600000);

  it("acompanha o motor até estacionar em vez de pular para o fim da rota", () => {
    const m = medida();
    const w = m.worstAhead;
    const detalhe = w
      ? ` carro=${w.car} tick=${w.tick} (saiu no tick ${w.depart}, chega no tick ${w.arrive})` +
        ` quadradinho desenhado=${w.drawnIdx} (tile ${w.drawnTile})` +
        ` quadradinho do motor=${w.engineIdx} (tile ${w.engineTile})` +
        ` rota com ${w.routeLen} quadradinhos [${w.route}] viagem visual com ${w.visTiles} quadradinhos`
      : "";
    expect(
      m.ahead,
      `a viagem visual acabou antes de o motor estacionar e mandou o carro para o fim da rota` +
        ` em ${m.ahead} quadros de ${m.movFrames}:` +
        " era para o quadradinho desenhado ficar no máximo 1 à frente do quadradinho do motor." +
        detalhe,
    ).toBe(0);
  }, 600000);

  it("o cenário pega carro desenhado no fim da rota antes de chegar", () => {
    const m = medida();
    expect(
      m.population,
      `a cidade tinha de ter gente para ter carro commuting: população=${m.population}`,
    ).toBeGreaterThan(9000);
    expect(
      m.movFrames,
      "a cidade não teve nenhum carro andando antes da hora de chegar, o teste não prova nada",
    ).toBeGreaterThan(0);
    expect(
      m.earlyEnd,
      `nenhum quadro com o carro desenhado no fim da rota antes de chegar em ${m.movFrames} quadros:` +
        " o cenário não exercita o caso do fim antes da hora",
    ).toBeGreaterThan(0);
  }, 600000);
});
