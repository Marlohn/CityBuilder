/** Carros e pessoas aparecem andando nas ruas (issue #11). */
import { expect, test } from "@playwright/test";
import { openGame } from "./helpers";

test("de manhã dá para ver carros e pessoas andando", async ({ page }) => {
  const errors = await openGame(page, "transito", "&modo=livre");
  await page.evaluate(() => {
    const c = window.__city.client;
    c.command({ type: "buildRoad", kind: "street", x0: 40, y0: 100, x1: 40, y1: 128 });
    c.command({ type: "buildRoad", kind: "street", x0: 40, y0: 100, x1: 70, y1: 100 });
    c.command({ type: "zone", zone: "residential_low", x0: 41, y0: 101, x1: 42, y1: 127 });
    c.command({ type: "zone", zone: "commercial", x0: 38, y0: 101, x1: 39, y1: 127 });
    c.command({ type: "zone", zone: "industrial", x0: 41, y0: 97, x1: 70, y1: 99 });
    window.__city.renderer.lookAt(45, 112);
    c.setSpeed(4);
  });
  // Espera a cidade ter gente e um horário de ida ao trabalho com gente na rua.
  await page.waitForFunction(
    () => {
      const s = window.__city.store.get().stats;
      return s && s.population > 50 && s.vehiclesMoving + s.peopleWalking >= 3;
    },
    null,
    { timeout: 150_000 },
  );
  await page.screenshot({ path: "test-results/transito.png" });
  await page.evaluate(() => {
    window.__city.renderer.zoomBy(0.18);
    window.__city.client.setSpeed(0.25);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "test-results/transito-perto.png" });
  expect(errors).toEqual([]);
});
