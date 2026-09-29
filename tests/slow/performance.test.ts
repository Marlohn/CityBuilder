/**
 * Teste de performance (lento): gera uma cidade de 50 mil pessoas com o prefeito automático e
 * confere que o trabalho por tick fica dentro do orçamento (contadores determinísticos) e que a
 * simulação acompanha a velocidade máxima com folga. Tempo em ms só entra com limite bem folgado.
 */
import { loadConfigAndData, loadScenario, runGame } from "@city/cli";
import { describe, expect, it } from "vitest";

describe("cidade de estresse (50 mil pessoas)", () => {
  it("fica dentro do orçamento de trabalho por tick", () => {
    const scenario = loadScenario("estresse");
    const { config, data } = loadConfigAndData(scenario.overrides);
    let reached = -1;
    let lastMs = 0;
    let t = Date.now();
    const game = runGame({
      config,
      data,
      seed: scenario.seed,
      days: 150,
      bot: true,
      scenario,
      onDay: (g, d) => {
        const now = Date.now();
        lastMs = now - t;
        t = now;
        if (reached < 0 && g.city.pop.aliveCount >= 50_000) reached = d;
      },
      stopWhen: (g) => reached >= 0 && g.sim.clock.day >= reached + 2,
    });
    const peak = game.sim.perf.peak;
    const budgets = config.performance.budgets;
    const cmd = "npm run sim -- bench --target=50000";
    expect(reached, `a cidade não chegou a 50 mil pessoas. Reproduzir: ${cmd}`).toBeGreaterThan(0);
    expect(peak.nodesExpanded ?? 0, `busca de rotas passou do orçamento. ${cmd}`).toBeLessThan(
      budgets.nodesExpandedPerTick,
    );
    expect(peak.personsUpdated ?? 0, `atualizações de pessoas passaram do orçamento. ${cmd}`).toBeLessThan(
      budgets.personsUpdatedPerTick,
    );
    // Na velocidade 4x um dia dura 30 s reais: exigimos pelo menos 2x de folga (limite folgado, só alerta grave).
    const dayBudgetMs = (config.time.realSecondsPerDayAt1x * 1000) / 4 / 2;
    expect(lastMs, `um dia do jogo levou ${lastMs} ms (limite ${dayBudgetMs}). ${cmd}`).toBeLessThan(
      dayBudgetMs,
    );
  }, 600_000);
});
