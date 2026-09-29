/**
 * Mesmo jogo no navegador (Chromium, Web Worker) e no Node: resultado idêntico.
 * O navegador joga um pouco; pegamos o save (semente + comandos com o tick) e refazemos no Node.
 */
import { loadConfigAndData } from "@city/cli";
import { createGame, parseReplay, replayInto, statsView } from "@city/sim";
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    // biome-ignore lint/suspicious/noExplicitAny: acesso de teste
    __city: any;
  }
}

test("Chromium e Node chegam exatamente na mesma cidade", async ({ page }) => {
  await page.goto("/?seed=determinismo");
  await page.waitForFunction(() => window.__city?.store.get().ready, null, { timeout: 120_000 });
  await page.evaluate(() => {
    const c = window.__city.client;
    c.setSpeed(0);
    const cmds = [
      { type: "buildRoad", kind: "avenue", x0: 47, y0: 128, x1: 100, y1: 128 },
      { type: "buildRoad", kind: "street", x0: 60, y0: 110, x1: 60, y1: 146 },
      { type: "buildRoad", kind: "street", x0: 72, y0: 110, x1: 72, y1: 146 },
      { type: "zone", zone: "residential_low", x0: 61, y0: 110, x1: 71, y1: 127 },
      { type: "zone", zone: "commercial", x0: 61, y0: 129, x1: 71, y1: 146 },
      { type: "placeService", service: "ubs", x: 73, y: 129 },
    ];
    for (const x of cmds) c.command(x);
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__city.client.send({ type: "advance", ticks: 1440 * 3 }));
  await page.waitForTimeout(1500);
  const save = await page.evaluate(() => window.__city.client.save());
  const stats = await page.evaluate(() => window.__city.store.get().stats);
  const replay = parseReplay(save);
  const { config, data } = loadConfigAndData(replay.overrides);
  const game = createGame({ config, data, seed: replay.seed });
  replayInto(game, replay);
  const node = statsView(game);
  expect(replay.commands.length).toBeGreaterThan(5);
  expect(node.tick).toBe(replay.tick);
  // O quadro mais recente do navegador pode ser de um tick anterior ao save; compara pelo save.
  const againSave = parseReplay(await page.evaluate(() => window.__city.client.save()));
  expect(againSave.tick).toBe(replay.tick);
  expect(stats.population).toBe(node.population);
  expect(stats.money).toBe(node.money);
  expect(stats.households).toBe(node.households);
});
