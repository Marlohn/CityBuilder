/**
 * Issue #48 — nenhum carro some no meio do caminho (rota curta e limite de tela).
 *
 * Dois jeitos de o carro sumir do mapa: rota real do carro com um quadradinho so, que o
 * TrafficVisuals descarta; e corte da viagem visual pelo limite de tela, que tira o carro de
 * cena antes de ele chegar.
 *
 * Regra que este teste trava: um carro dentro do mapa esta SEMPRE desenhado, na viagem
 * visual ou como estacionado. Nunca andando e invisivel.
 */
import { statsView, TrafficVisuals } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** VSTATE.moving de packages/sim/src/traffic/vehicles.ts. */
const MOVING = 1;

interface Medida {
  /** Quadros (carro, tick) em que o carro andava no motor. */
  movTot: number;
  /** Quadros em que o carro andava no motor e nao estava desenhado na tela. */
  invis: number;
  /** Maior numero de invisiveis em um unico quadro. */
  invisPeak: number;
  /** Viagens visuais ativas: o limite de tela corta acima do maxActive. */
  peakAtivas: number;
  /** Invisiveis no quadro em que o pico de viagens ativas aconteceu. */
  invisNoPico: number;
}

// A casa fica colada na via do emprego, por isso a rota do carro sai com 1 quadradinho.
function cidadePequena(): ReturnType<typeof createTestGame> {
  const game = createTestGame({
    seed: "mede48",
    overrides: { world: { width: 128, height: 128 }, economy: { mode: "sandbox" } },
  });
  const s = game.sim;
  const mid = 64;
  s.enqueue({ type: "buildRoad", kind: "street", x0: 30, y0: mid - 20, x1: 30, y1: mid + 20 });
  s.enqueue({ type: "buildRoad", kind: "street", x0: 30, y0: mid - 20, x1: 60, y1: mid - 20 });
  s.enqueue({ type: "zone", zone: "residential_low", x0: 31, y0: mid - 19, x1: 32, y1: mid - 1 });
  s.enqueue({ type: "zone", zone: "commercial", x0: 28, y0: mid - 19, x1: 29, y1: mid + 19 });
  s.enqueue({ type: "zone", zone: "industrial", x0: 31, y0: mid - 22, x1: 60, y1: mid - 21 });
  s.step(6 * s.clock.ticksPerDay);
  return game;
}

// Cidade grande pronta: bairro com prefeito automático por 60 dias.
function cidadeGrande(): ReturnType<typeof createTestGame> {
  return createTestGame({ seed: "mede21", scenario: "bairro-basico", days: 60, bot: true });
}

function medir(game: ReturnType<typeof createTestGame>, dias: number): Medida {
  const s = game.sim;
  const tpd = s.clock.ticksPerDay;
  const vis = new TrafficVisuals(game);
  const m: Medida = { movTot: 0, invis: 0, invisPeak: 0, peakAtivas: 0, invisNoPico: 0 };
  for (let t = 0; t < dias * tpd; t++) {
    s.step(1);
    vis.advance(1 / 12, 1);
    const mv = game.traffic.vehicles.moving;
    let invis = 0;
    for (let i = 0; i < mv.size; i++) {
      const v = mv.at(i)!;
      m.movTot++;
      if (!vis.isCarOnScreen(v)) invis++;
    }
    m.invis += invis;
    if (invis > m.invisPeak) m.invisPeak = invis;
    const a = (vis as unknown as { active: unknown[] }).active.length;
    if (a > m.peakAtivas) {
      m.peakAtivas = a;
      m.invisNoPico = invis;
    }
  }
  return m;
}

describe("nenhum carro some no meio do caminho", () => {
  it("carro com rota de um quadradinho continua desenhado", () => {
    // Cidade pequena onde a casa encosta no emprego: a rota sai com 1 quadradinho.
    const game = cidadePequena();
    // Mede com a tela ligada: todo carro andando tem de estar desenhado.
    const m = medir(game, 5);
    // A cidade é reproduzível (mesma semente), então dá para conferir o caso numa cópia.
    const prova = cidadePequena();
    const sim = prova.sim;
    const totalTicks = 5 * sim.clock.ticksPerDay;
    // Conta em quantos quadros houve carro andando com rota de 1 quadradinho.
    let shortFrames = 0;
    for (let t = 0; t < totalTicks; t++) {
      sim.step(1);
      const moving = prova.traffic.vehicles.moving;
      for (let i = 0; i < moving.size; i++) {
        const v = moving.at(i)!;
        const route = prova.traffic.vehicles.routes[v];
        if (route && route.length === 1 && prova.traffic.vehicles.state[v] === MOVING) {
          shortFrames++;
          break;
        }
      }
    }
    expect(
      shortFrames,
      "a cidade pequena não produziu nenhum carro com rota de 1 quadradinho, então o teste não prova nada",
    ).toBeGreaterThan(0);
    expect(
      m.invis,
      `carro andando e invisível: movTot=${m.movTot} invis=${m.invis} pico=${m.invisPeak}`,
    ).toBe(0);
  }, 300000);

  it("nenhum carro some na cidade grande", () => {
    // Cidade grande cheia de carros andando em 3 dias de tela ligada.
    const game = cidadeGrande();
    const m = medir(game, 3);
    const population = statsView(game).population;
    expect(population, `a cidade grande tinha de ter gente: população=${population}`).toBeGreaterThan(9000);
    expect(
      m.movTot,
      "a cidade grande não teve nenhum carro andando, então o teste não prova nada",
    ).toBeGreaterThan(0);
    expect(
      m.invis,
      `carro andando e invisível na cidade grande: movTot=${m.movTot} invis=${m.invis} pico=${m.invisPeak}`,
    ).toBe(0);
  }, 1800000);

  it("o limite de tela não corta viagem de carro andando", () => {
    // Número técnico: a tela antiga cortava acima de 4000 viagens ativas.
    const LIMITE_ANTIGO = 4000;
    // Cidade grande com trânsito pesado e a tela ligada por 3 dias.
    const game = cidadeGrande();
    const m = medir(game, 3);
    expect(
      m.peakAtivas,
      `a cidade não passou do limite antigo, então o teste não prova nada: pico=${m.peakAtivas}`,
    ).toBeGreaterThan(LIMITE_ANTIGO);
    expect(m.invisNoPico, "a tela cortou viagem no pico e o carro sumiu").toBe(0);
  }, 1800000);

  it("a correção é só de tela: o motor dá o mesmo resultado", () => {
    // Primeiro jogo com a tela ligada por 1 dia: anota o resultado do motor.
    const gameWithScreen = cidadeGrande();
    medir(gameWithScreen, 1);
    const expectedPopulation = statsView(gameWithScreen).population;
    const expectedCount = gameWithScreen.traffic.vehicles.count;
    // Segundo jogo igual, mas sem nunca criar a tela: só o motor anda os mesmos quadros.
    const gameWithoutScreen = cidadeGrande();
    const simOnly = gameWithoutScreen.sim;
    const totalTicks = 1 * simOnly.clock.ticksPerDay;
    for (let t = 0; t < totalTicks; t++) {
      simOnly.step(1);
    }
    expect(statsView(gameWithoutScreen).population, "a tela não pode mudar a população do motor").toBe(
      expectedPopulation,
    );
    expect(
      gameWithoutScreen.traffic.vehicles.count,
      "a tela não pode mudar a quantidade de carros do motor",
    ).toBe(expectedCount);
  }, 1800000);
});
