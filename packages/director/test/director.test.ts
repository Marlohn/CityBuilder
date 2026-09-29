/** Diretora (IA opcional): testada só com respostas gravadas, sem internet. */
import { loadConfigAndData, runGame, runGameDirected } from "@city/cli";
import { createGame, makeReplay, parseReplay, replayInto, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { type LlmClient, promptKey, RecordedClient, RecordingClient } from "../src/client";
import { buildPrompt, decide, parseDecision } from "../src/director";

const overrides = { world: { width: 160, height: 256 }, director: { enabled: true, everyDays: 2 } };

const recession = JSON.stringify({
  headline: "Fábrica da região fecha e indústria desacelera",
  actions: [{ param: "industryGrowth", factor: 0.25, reason: "recessão regional" }],
});

describe("diretora", () => {
  it("lê o JSON mesmo com texto em volta e recusa o que está fora da lista ou do limite", async () => {
    expect(parseDecision(`Claro!\n\`\`\`json\n${recession}\n\`\`\``).actions[0]!.factor).toBe(0.25);
    const { config, data } = loadConfigAndData(overrides);
    const game = createGame({ config, data, seed: "d" });
    const out = await decide(
      game,
      new RecordedClient(
        {},
        JSON.stringify({
          headline: "x",
          actions: [
            { param: "immigration", factor: 5, reason: "exagero" },
            { param: "industryGrowth", factor: 1.5, reason: "ok" },
          ],
        }),
      ),
    );
    expect(out.commands).toHaveLength(1);
    expect(out.rejected[0]).toMatch(/fora do limite/);
    const bad = await decide(
      game,
      new RecordedClient({}, '{"headline": "x", "actions": [{"param": "impostos"}]}'),
    );
    expect(bad.commands).toHaveLength(0);
    expect(bad.rejected[0]).toMatch(/resposta inválida/);
    const failing: LlmClient = { complete: async () => Promise.reject(new Error("sem rede")) };
    expect((await decide(game, failing)).rejected[0]).toMatch(/sem rede/);
  });

  it("o pedido mostra os limites e o relatório", () => {
    const { config, data } = loadConfigAndData(overrides);
    const p = buildPrompt(createGame({ config, data, seed: "d" }));
    expect(p).toMatch(/industryGrowth: .* de 0.25 a 2/);
    expect(p).toMatch(/# Relatório da cidade/);
  });

  it("o ajuste vira comando: muda a cidade e o replay repete sem LLM", async () => {
    const { config, data } = loadConfigAndData(overrides);
    const opts = { config, data, seed: "diretora", days: 8, bot: true };
    const client = new RecordingClient(new RecordedClient({}, recession));
    const directed = await runGameDirected({ ...opts, client });
    expect(directed.sim.modifiers.industryGrowth).toBe(0.25);
    expect(Object.keys(client.recorded).length).toBeGreaterThan(0);
    expect(Object.keys(client.recorded)[0]).toMatch(/^[0-9a-f]{8}$/);
    // Replay: abre sem nenhum LLM e chega na mesma cidade.
    const replay = parseReplay(JSON.stringify(makeReplay(directed, overrides)));
    const again = createGame({ config, data, seed: replay.seed });
    replayInto(again, replay);
    expect(statsView(again).population).toBe(statsView(directed).population);
    expect(again.sim.modifiers.industryGrowth).toBe(0.25);
    // Sem diretora a cidade é outra (o ajuste teve efeito de verdade).
    const plain = runGame(opts);
    expect(plain.sim.modifiers.industryGrowth).toBe(1);
  });

  it("chave da resposta gravada é estável", () => {
    expect(promptKey("abc")).toBe(promptKey("abc"));
    expect(promptKey("abc")).not.toBe(promptKey("abd"));
  });
});
