/**
 * Teste de aceitação da issue #104 (papel QA).
 *
 * Hoje `GrowthSystem.tryBuild` (packages/sim/src/systems/growth.ts) só pula o lote quando
 * `canSupply` falha: a cidade para de crescer por falta de água ou luz e nada diz isso.
 * A visão (`StatsView`) precisa trazer `construction: { blockedByWater, blockedByPower }`,
 * contando uma vez por tentativa de lote barrada, e zerando a cada tick do growth.
 *
 * Este teste deve falhar na `main` porque o campo `construction` não existe no contrato.
 */
import { type Game, reportText, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** Campo novo esperado na visão (ainda não existe no contrato). */
interface ConstructionField {
  blockedByWater: number;
  blockedByPower: number;
}

function construction(game: Game): ConstructionField {
  return (statsView(game) as unknown as { construction: ConstructionField }).construction;
}

const BASE = { economy: { mode: "sandbox" } } as const;

describe("issue #104: o motor conta por que a construtora está parada", () => {
  it("com a rede regional de água pequena, conta as obras barradas por água e nenhuma por luz", () => {
    const game = createTestGame({
      seed: "obra-barrada-agua",
      scenario: "bairro-basico",
      days: 20,
      overrides: { ...BASE, utilities: { regionalWater: 60, regionalPower: 1000000 } },
    });
    const antes = game.sim.buildings.count;
    game.sim.step(20 * game.sim.clock.ticksPerDay);

    const c = construction(game);
    expect(typeof c.blockedByWater, "faltava o contador de obras barradas por água").toBe("number");
    expect(c.blockedByWater, "com a água acabando, a construtora devia estar barrada").toBeGreaterThan(0);
    expect(c.blockedByPower, "a luz estava folgada: nenhuma obra devia estar barrada por luz").toBe(0);
    expect(game.sim.buildings.count, "sem água sobrando, a cidade não devia continuar crescendo").toBe(antes);
  });

  it("colocando um poço, o contador de água volta a zero no tick seguinte", () => {
    const game = createTestGame({
      seed: "obra-barrada-agua",
      scenario: "bairro-basico",
      days: 20,
      overrides: { ...BASE, utilities: { regionalWater: 60, regionalPower: 1000000 } },
    });
    const antes = construction(game).blockedByWater;
    expect(antes, "a cidade tinha que começar barrada por água").toBeGreaterThan(0);

    game.sim.drainResults();
    game.sim.enqueue({ type: "placeService", service: "poco", x: 80, y: 141 });
    game.sim.step(1);
    for (const r of game.sim.drainResults()) expect(r.ok, r.reason).toBe(true);

    // Mais que um tick do growth (10 ticks) para o contador zerar de novo.
    game.sim.step(2 * game.sim.clock.ticksPerDay);
    const c = construction(game);
    expect(c.blockedByWater, "com o poço a obra volta: o contador tem que zerar").toBe(0);
    expect(c.blockedByPower, "a luz nunca foi o problema").toBe(0);
    expect(game.sim.buildings.count, "com o poço a cidade volta a crescer").toBeGreaterThan(0);
  });

  it("com a rede regional folgada, os dois contadores ficam em zero mesmo com a cidade crescendo", () => {
    const game = createTestGame({
      seed: "obra-barrada-agua",
      scenario: "bairro-basico",
      days: 40,
      overrides: BASE,
    });
    const c = construction(game);
    expect(c.blockedByWater, "com água de sobra nenhuma obra devia estar barrada").toBe(0);
    expect(c.blockedByPower, "com luz de sobra nenhuma obra devia estar barrada").toBe(0);
    expect(statsView(game).population, "a cidade tem que estar crescendo para o teste valer").toBeGreaterThan(
      0,
    );
  });

  it("os contadores zeram a cada tick do growth: 40 dias com a rede cheia não somam 40", () => {
    const game = createTestGame({
      seed: "obra-barrada-agua",
      scenario: "bairro-basico",
      days: 60,
      overrides: { ...BASE, utilities: { regionalWater: 60, regionalPower: 1000000 } },
    });
    const c = construction(game);
    expect(c.blockedByWater, "no fim da simulação ainda tem que estar barrada por água").toBeGreaterThan(0);
    // Conta uma vez por tentativa de lote barrada, e o laço de obras para na primeira falha.
    expect(c.blockedByWater, "o contador é do tick, não acumulado desde o começo").toBeLessThanOrEqual(1);
  });

  it("o relatório em texto continua imprimindo sem undefined", () => {
    const game = createTestGame({
      seed: "obra-barrada-agua",
      scenario: "bairro-basico",
      days: 20,
      overrides: { ...BASE, utilities: { regionalWater: 60, regionalPower: 1000000 } },
    });
    const texto = reportText(game);
    expect(texto.length).toBeGreaterThan(0);
    expect(texto, "o relatório não pode imprimir undefined").not.toContain("undefined");
  });
});
