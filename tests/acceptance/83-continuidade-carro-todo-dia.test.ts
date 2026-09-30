/**
 * Issue #83 — todo carro continua desenhado em cada dia da simulação.
 *
 * Todo carro que existe no motor e está na cidade tem que aparecer na tela:
 * ou nas posições do motor ou nas posições da viagem visual. Só quem saiu
 * com a família (gone) pode sumir. Quem trabalha fora (outside) fica na
 * estrada de saída, não invisível.
 *
 * Um `it` por critério, sempre com a mesma semente fixa.
 */
import { DEFAULT_TRAFFIC_VISUALS, PEDESTRIAN_TYPE, TrafficVisuals } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

// Estados do carro em packages/sim/src/traffic/vehicles.ts (VSTATE não é
// exportado por @city/sim, por isso os números ficam copiados aqui).
const PARKED = 0;
const MOVING = 1;
const OUTSIDE = 2;
const GONE = 3;

const SEED = "mede83";
// A tela antiga cortava acima de 4000 viagens ativas (issue #48).
const OLD_SCREEN_LIMIT = 4000;

type Game = ReturnType<typeof createTestGame>;
type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Retângulo da tela: o mapa inteiro. */
function fullRect(game: Game): Rect {
  return { x0: 0, y0: 0, x1: game.sim.world.width, y1: game.sim.world.height };
}

/** Quantos carros (sem gente a pé) há nas posições da viagem visual. */
function countVisualCars(visual: Float32Array): number {
  let n = 0;
  for (let i = 3; i < visual.length; i += 4) {
    if (visual[i]! < PEDESTRIAN_TYPE) n++;
  }
  return n;
}

interface Frame {
  /** Carros exigidos na tela que não estão em nenhum dos dois desenhos. */
  ghosts: number;
  parked: number;
  moving: number;
  outside: number;
  gone: number;
  motorDrawn: number;
  visualCars: number;
}

/**
 * Conta os fantasmas de um quadro: carro que existe no motor, não é gone,
 * não está fora da cidade e não aparece nem nas posições do motor (só
 * estacionados/fora, sem contar duas vezes quem a tela já desenha) nem nas
 * posições da viagem visual.
 */
function frameGhosts(game: Game, vis: TrafficVisuals, rect: Rect): Frame {
  const veh = game.traffic.vehicles;
  let parked = 0;
  let moving = 0;
  let outside = 0;
  let gone = 0;
  let outsideHidden = 0;
  for (let v = 0; v < veh.count; v++) {
    const st = veh.state[v]!;
    if (st === PARKED) parked++;
    else if (st === MOVING) moving++;
    else if (st === OUTSIDE) {
      outside++;
      if (vis.isCarOnScreen(v)) outsideHidden++;
    } else if (st === GONE) gone++;
  }
  // Só estacionados/fora; hidden pula quem a tela já desenha na viagem visual.
  const hidden = (v: number) => vis.isCarOnScreen(v);
  const motor = game.traffic.positions(rect, 0, hidden, false);
  const motorDrawn = motor.length / 4;
  const visualCars = countVisualCars(vis.positions(rect));
  // O motor desenha os fora da cidade junto; eles não são exigidos, então saem
  // da conta do desenho antes de comparar com o exigido (parked + moving).
  const outsideInMotor = outside - outsideHidden;
  const drawnForRequired = motorDrawn - outsideInMotor + visualCars;
  const required = parked + moving;
  return {
    ghosts: Math.max(0, required - drawnForRequired),
    parked,
    moving,
    outside,
    gone,
    motorDrawn,
    visualCars,
  };
}

describe("continuidade do carro todo dia", () => {
  it("nenhum carro fantasma na cidade do bairro", () => {
    // Cidade pronta: bairro com prefeito automático por 60 dias.
    const game = createTestGame({
      seed: SEED,
      scenario: "bairro-basico",
      days: 60,
      bot: true,
    });
    const s = game.sim;
    const tpd = s.clock.ticksPerDay;
    const rect = fullRect(game);
    const vis = new TrafficVisuals(game);
    let ghosts = 0;
    let movingFrames = 0;
    let parkedFrames = 0;
    // 2 dias tick a tick com a tela ligada.
    for (let t = 0; t < 2 * tpd; t++) {
      s.step(1);
      vis.advance(1 / 12, 1);
      const f = frameGhosts(game, vis, rect);
      ghosts += f.ghosts;
      movingFrames += f.moving;
      parkedFrames += f.parked;
    }
    // Guardas: a cidade realmente teve carro andando e carro estacionado.
    expect(movingFrames, "a cidade não teve carro andando, o teste não prova nada").toBeGreaterThan(0);
    expect(parkedFrames, "a cidade não teve carro estacionado, o teste não prova nada").toBeGreaterThan(0);
    expect(ghosts, `carro fantasma na cidade do bairro: ${ghosts} quadros-carro sem desenho`).toBe(0);
  }, 1_800_000);

  it("nenhum carro fantasma com o limite de tela no máximo", () => {
    // Cidade de estresse pronta, duas vezes iguais (mesma semente = mesma cidade).
    const normal = createTestGame({
      seed: SEED,
      scenario: "estresse",
      days: 60,
      bot: true,
    });
    const cut = createTestGame({
      seed: SEED,
      scenario: "estresse",
      days: 60,
      bot: true,
    });
    const vis = new TrafficVisuals(normal);
    // Cópia com o limite de tela quase zerado: força o corte a cada quadro.
    const visCut = new TrafficVisuals(cut, {
      ...DEFAULT_TRAFFIC_VISUALS,
      maxActive: 5,
    });
    const tpd = normal.sim.clock.ticksPerDay;
    const rectNormal = fullRect(normal);
    const rectCut = fullRect(cut);
    let ghostsNormal = 0;
    let ghostsCut = 0;
    let movingFrames = 0;
    let peakActive = 0;
    // 1 dia com a tela ligada nos dois jogos juntos.
    for (let t = 0; t < tpd; t++) {
      normal.sim.step(1);
      vis.advance(1 / 12, 1);
      cut.sim.step(1);
      visCut.advance(1 / 12, 1);
      const fNormal = frameGhosts(normal, vis, rectNormal);
      ghostsNormal += fNormal.ghosts;
      const fCut = frameGhosts(cut, visCut, rectCut);
      ghostsCut += fCut.ghosts;
      movingFrames += fNormal.moving;
      const active = (vis as unknown as { active: unknown[] }).active.length;
      if (active > peakActive) peakActive = active;
    }
    // Guardas: passou do limite antigo de tela e teve carro andando.
    expect(
      peakActive,
      `não passou do limite antigo, o teste não prova nada: pico=${peakActive}`,
    ).toBeGreaterThan(OLD_SCREEN_LIMIT);
    expect(movingFrames, "a cidade não teve carro andando, o teste não prova nada").toBeGreaterThan(0);
    expect(ghostsNormal, `fantasma no jogo normal: ${ghostsNormal} quadros-carro`).toBe(0);
    expect(ghostsCut, `fantasma com o limite no máximo: ${ghostsCut} quadros-carro`).toBe(0);
  }, 1_800_000);

  it("carro com emprego fora está fora da cidade, não invisível", () => {
    // Cidade nova (6 dias de bot): aqui ainda há carros fora da cidade.
    const game = createTestGame({
      seed: SEED,
      scenario: "bairro-basico",
      days: 6,
      bot: true,
    });
    const s = game.sim;
    const tpd = s.clock.ticksPerDay;
    const rect = fullRect(game);
    const vis = new TrafficVisuals(game);
    let ghosts = 0;
    let outsideFrames = 0;
    let outsideWithoutExit = 0;
    // 2 dias tick a tick com a tela ligada.
    for (let t = 0; t < 2 * tpd; t++) {
      s.step(1);
      vis.advance(1 / 12, 1);
      const f = frameGhosts(game, vis, rect);
      ghosts += f.ghosts;
      outsideFrames += f.outside;
      // Todo outside tem via de saída ou já está desenhado na viagem visual.
      const veh = game.traffic.vehicles;
      for (let v = 0; v < veh.count; v++) {
        if (veh.state[v] !== OUTSIDE) continue;
        if (veh.streetTile[v]! >= 0) continue;
        if (vis.isCarOnScreen(v)) continue;
        outsideWithoutExit++;
      }
    }
    // Guarda: realmente houve carro fora da cidade.
    expect(outsideFrames, "não houve carro fora da cidade, o teste não prova nada").toBeGreaterThan(0);
    expect(outsideWithoutExit, `carro fora sem via de saída e sem desenho: ${outsideWithoutExit}`).toBe(0);
    expect(ghosts, `carro fantasma junto com os de fora: ${ghosts} quadros-carro`).toBe(0);
  }, 1_800_000);

  it("quem já embora pode sumir", () => {
    // Mesmo jogo do critério anterior: bairro com 6 dias de bot.
    const game = createTestGame({
      seed: SEED,
      scenario: "bairro-basico",
      days: 6,
      bot: true,
    });
    const s = game.sim;
    const tpd = s.clock.ticksPerDay;
    const rect = fullRect(game);
    const vis = new TrafficVisuals(game);
    let ghosts = 0;
    let goneFrames = 0;
    let goneCars = 0;
    let drawnBelowTotal = 0;
    // 2 dias tick a tick com a tela ligada.
    for (let t = 0; t < 2 * tpd; t++) {
      s.step(1);
      vis.advance(1 / 12, 1);
      const f = frameGhosts(game, vis, rect);
      // A conta do fantasma ignora o gone: ele nunca é cobrado.
      ghosts += f.ghosts;
      goneFrames += f.gone;
      if (f.gone > 0) goneCars = f.gone;
      // O desenho (motor + visual) fica abaixo do total de carros porque o
      // gone não é exigido na tela: prova que nenhum gone foi cobrado.
      const drawn = f.motorDrawn + f.visualCars;
      if (drawn < game.traffic.vehicles.count) drawnBelowTotal++;
    }
    // Guarda: existe pelo menos um carro que foi embora.
    expect(goneFrames, "a cidade não teve carro gone, o teste não prova nada").toBeGreaterThan(0);
    expect(ghosts, `gone foi cobrado como fantasma: ${ghosts} quadros-carro`).toBe(0);
    expect(
      drawnBelowTotal,
      `o desenho cobriu todos os ${goneCars} carros gone: eles deviam poder sumir`,
    ).toBeGreaterThan(0);
  }, 1_800_000);
});
