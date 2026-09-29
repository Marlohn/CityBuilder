/** Ferramenta Mover na tela (issue #13): clica na escola e depois no lugar novo. */
import { test } from "@playwright/test";
import { openGame, screenOf } from "./helpers";

test("mover uma escola com dois cliques", async ({ page }) => {
  await openGame(page, "mover", "&modo=livre");
  await page.evaluate(() => {
    const c = window.__city.client;
    c.command({ type: "buildRoad", kind: "street", x0: 60, y0: 100, x1: 60, y1: 128 });
    c.command({ type: "placeService", service: "escola", x: 61, y: 110 });
    window.__city.renderer.lookAt(64, 112);
  });
  await page.waitForFunction(() =>
    window.__city.buildings().some((b: { type: string }) => b.type === "escola"),
  );
  const school = await page.evaluate(() =>
    window.__city.buildings().find((b: { type: string }) => b.type === "escola"),
  );
  await page.evaluate(() => window.__city.store.set({ tool: "move" }));
  const from = await screenOf(page, school.x + 2.5, 0.05, school.y + 3);
  await page.mouse.click(from.x, from.y);
  // Lugar novo: do outro lado da rua (x = 55..59), mais para cima.
  const to = await screenOf(page, 55.5, 0, 101.5);
  await page.mouse.click(to.x, to.y);
  await page.waitForFunction(
    (id) => {
      const b = window.__city.buildings().find((x: { id: number }) => x.id === id);
      return b && b.x === 55 && b.y === 101;
    },
    school.id,
    { timeout: 15_000 },
  );
});
