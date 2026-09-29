/** Clicar no corpo de um prédio acerta o prédio, não o chão atrás dele (issue #10). */
import { expect, test } from "@playwright/test";
import { openGame, screenOf } from "./helpers";

test("demolir uma casa em obra clicando no corpo dela", async ({ page }) => {
  await openGame(page, "pick");
  await page.evaluate(() => {
    const c = window.__city.client;
    c.command({ type: "buildRoad", kind: "street", x0: 30, y0: 110, x1: 30, y1: 128 });
    c.command({ type: "zone", zone: "residential_low", x0: 31, y0: 110, x1: 32, y1: 127 });
    window.__city.renderer.lookAt(31, 119);
  });
  // Espera uma casa começar a ser construída.
  await page.waitForFunction(
    () => window.__city.buildings().some((b: { state: number }) => b.state === 0),
    null,
    {
      timeout: 60_000,
    },
  );
  await page.evaluate(() => window.__city.client.setSpeed(0.25));
  const b = await page.evaluate(() =>
    window.__city.buildings().find((x: { state: number }) => x.state === 0),
  );
  // Ponto alto na frente da caixa da obra: antes, este clique caía no chão atrás do prédio.
  const p = await screenOf(page, b.x + 0.5, 0.45, b.y + b.h);
  const tile = await page.evaluate(
    ([px, py]) => {
      const canvas = document.getElementById("city") as HTMLCanvasElement;
      const r = canvas.getBoundingClientRect();
      return window.__city.renderer.screenToTile(
        ((px - r.left) * canvas.width) / r.width,
        ((py - r.top) * canvas.height) / r.height,
      );
    },
    [p.x, p.y] as const,
  );
  expect(tile, "o clique não acertou o prédio").toEqual({ x: b.x, y: b.y });
  // Com a ferramenta Demolir, um clique ali tira a obra.
  await page.evaluate(() => window.__city.store.set({ tool: "bulldoze" }));
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(
    (id) => !window.__city.buildings().some((x: { id: number }) => x.id === id),
    b.id,
    { timeout: 10_000 },
  );
});
