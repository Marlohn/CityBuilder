/**
 * Issue #82 - carro com emprego fora: sair pela estrada visivelmente ate a borda.
 *
 * O motor manda o carro que trabalha fora ate a saida da cidade (exitFor) e o deixa parado la
 * (VSTATE.outside). O problema e a TELHA: a viagem visual do carro dura DEFAULT_TRAFFIC_VISUALS.maxSeconds
 * (6 s de tela), enquanto o motor ja o estacionou na estrada de saida depois de 1 ou 2 ticks. O
 * resultado na tela e o carro sumir no meio do caminho e voltar a aparecer parado na borda.
 *
 * Regra que este teste trava: quando o motor chega na estrada de saida, o carro ja andou
 * praticamente a viagem inteira na tela - ele some so depois de passar a borda. E a tela nunca
 * tira de cena um carro que o motor ainda diz que esta andando.
 */
import { TrafficVisuals, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** OUTSIDE_JOB de packages/sim/src/people/population.ts: emprego no municipio vizinho. */
const TRABALHA_FORA = -2;
interface Chegada {
  pessoa: number;
  carro: number;
  /** Quanto da viagem visual ja tinha sido desenhada quando o motor estacionou o carro. 0..1 */
  avance: number;
}

/**
 * Bairro no fim da linha: a rua encosta na borda do mapa e nao ha comercio nem industria,
 * entao os trabalhadores vao trabalhar no municipio vizinho (pela estrada de saida).
 */
function cidade(seed = "carro-sai82") {
  const game = createTestGame({
    seed,
    overrides: {
      world: { width: 128, height: 128 },
      economy: { mode: "sandbox" },
    },
  });
  const s = game.sim;
  s.enqueue({
    type: "buildRoad",
    kind: "street",
    x0: 0,
    y0: 64,
    x1: 30,
    y1: 64,
  });
  s.enqueue({
    type: "buildRoad",
    kind: "street",
    x0: 30,
    y0: 40,
    x1: 30,
    y1: 90,
  });
  s.enqueue({
    type: "zone",
    zone: "residential_low",
    x0: 31,
    y0: 41,
    x1: 50,
    y1: 60,
  });
  s.enqueue({
    type: "zone",
    zone: "residential_low",
    x0: 31,
    y0: 68,
    x1: 50,
    y1: 89,
  });
  s.step(20 * s.clock.ticksPerDay);
  return game;
}

/**
 * Roda a tela ligada por `dias` e devolve as chegadas de carro com emprego fora: no quadro em que o
 * motor larga o carro na estrada de saida, o quanto da viagem visual ja estava desenhado.
 */
function chegadasNaBorda(
  game: ReturnType<typeof createTestGame>,
  dias: number,
): Chegada[] {
  const vis = new TrafficVisuals(game);
  const veh = game.traffic.vehicles;
  const s = game.sim;
  // Carro que o motor estava mandando para fora no quadro anterior.
  const indoParaFora = new Set<number>();
  const out: Chegada[] = [];
  for (let t = 0; t < dias * s.clock.ticksPerDay; t++) {
    s.step(1);
    vis.advance(1 / 12, 1);
    // Chegada e o quadro em que o carro que ia para fora deixou de andar. Nao olhamos o estado
    // interno: o teste vale tanto se o dev deixar o carro parado na saida como se criar um estado novo.
    const andando = new Set<number>();
    const agora = veh.moving;
    for (let i = 0; i < agora.size; i++) andando.add(agora.at(i)!);
    for (const v of indoParaFora) {
      if (veh.destBuilding[v] !== TRABALHA_FORA) continue;
      if (andando.has(v)) continue;
      const active = (
        vis as unknown as {
          active: Array<{
            kind: string;
            id: number;
            start: number;
            duration: number;
          }>;
        }
      ).active;
      const trip = active.find((x) => x.kind === "car" && x.id === v);
      const clock = (vis as unknown as { clock: number }).clock;
      out.push({
        pessoa: veh.driver[v]!,
        carro: v,
        avance: trip ? Math.min(1, (clock - trip.start) / trip.duration) : 0,
      });
    }
    indoParaFora.clear();
    for (const v of andando) {
      if (veh.destBuilding[v] === TRABALHA_FORA) indoParaFora.add(v);
    }
  }
  return out;
}

describe("carro com emprego fora sai pela estrada ate a borda", () => {
  it("quando o motor chega na saida, o carro ja andou a viagem quase toda na tela", () => {
    const jogo = cidade();
    // Guarda: a cidade tem de produzir trabalhador fora, senao o teste nao prova nada.
    expect(
      trabalhadoresFora(jogo),
      "a cidade nao produziu trabalhador fora, o teste nao prova nada",
    ).toBeGreaterThan(0);

    const chegadas = chegadasNaBorda(jogo, 3);
    expect(
      chegadas.length,
      "nenhum carro com emprego fora chegou na estrada de saida em 3 dias, o teste nao prova nada",
    ).toBeGreaterThan(0);
    const atrasados = chegadas.filter((c) => c.avance < 0.9);
    const resumo = chegadas
      .map(
        (c) =>
          `carro ${c.carro} (motorista ${c.pessoa}) ${(c.avance * 100).toFixed(1)}%`,
      )
      .join(", ");
    expect(
      atrasados.length,
      "carro some da tela antes de passar a borda: " +
        atrasados.length +
        " de " +
        chegadas.length +
        " carros chegaram na saida sem ter andado a viagem (avance < 90%). Avances: " +
        resumo,
    ).toBe(0);
  }, 600000);

  it("a tela nunca tira de cena um carro que o motor ainda diz que esta andando", () => {
    // Guarda contra a correção "cortar a viagem visual": o carro tem de continuar desenhado.
    const jogo = cidade();
    const vis = new TrafficVisuals(jogo);
    const veh = jogo.traffic.vehicles;
    const s = jogo.sim;
    let invisiveis = 0;
    let andando = 0;
    for (let t = 0; t < s.clock.ticksPerDay; t++) {
      s.step(1);
      vis.advance(1 / 12, 1);
      const mv = veh.moving;
      for (let i = 0; i < mv.size; i++) {
        const v = mv.at(i)!;
        if (veh.destBuilding[v] !== TRABALHA_FORA) continue;
        andando++;
        if (!vis.isCarOnScreen(v)) invisiveis++;
      }
    }
    expect(
      andando,
      "a cidade nao produziu carro andando para fora, o teste nao prova nada",
    ).toBeGreaterThan(0);
    expect(
      invisiveis,
      "carro com emprego fora andando no motor e invisivel na tela: " +
        invisiveis +
        " de " +
        andando +
        " quadros",
    ).toBe(0);
  }, 600000);

  it("a correcao da tela nao muda a cidade do motor", () => {
    const comTela = cidade();
    chegadasNaBorda(comTela, 2);
    const esperado = statsView(comTela).population;
    const semTela = cidade();
    semTela.sim.step(2 * semTela.sim.clock.ticksPerDay);
    expect(
      statsView(semTela).population,
      "a tela nao pode mudar a populacao do motor",
    ).toBe(esperado);
  }, 600000);
});

/** Quantos moradores trabalham fora da cidade (trabalho no municipio vizinho). */
function trabalhadoresFora(game: ReturnType<typeof createTestGame>): number {
  const pop = game.city.pop;
  let n = 0;
  for (let p = 0; p < pop.aliveCount; p++)
    if (pop.job[p] === TRABALHA_FORA) n++;
  return n;
}
