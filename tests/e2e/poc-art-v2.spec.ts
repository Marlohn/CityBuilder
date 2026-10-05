/**
 * POC #296 v2: a direção artística precisa ser avaliada como um pequeno diorama isométrico,
 * não como uma cidade inteira vista de longe.
 */
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    // biome-ignore lint/suspicious/noExplicitAny: ponte de depuração do jogo
    __city: any;
  }
}

test("POC v2 abre como vitrine isométrica densa e sem erros de página", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/?seed=poc-art-v2&modo=livre&poc=art-v2&cinema=1");
  await page.waitForFunction(() => window.__city?.store.get().ready, null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__city.buildings().length >= 12, null, { timeout: 120_000 });
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => {
    const map = window.__city.map();
    const road = (x: number, y: number) => !!map?.roads[y * map.width + x];
    return {
      camera: window.__city.renderer.cameraState(),
      cinema: document.body.classList.contains("poc-cinema"),
      // A vitrine usa quadras curtas; estes eixos internos não existiam na POC anterior.
      denseGrid: [road(72, 118), road(84, 118), road(70, 120), road(70, 136)].every(Boolean),
    };
  });

  expect(state.cinema).toBe(true);
  expect(state.denseGrid).toBe(true);
  expect(state.camera.zoom).toBeLessThanOrEqual(7);
  expect(Math.abs(state.camera.alpha + Math.PI / 4)).toBeLessThan(0.02);

  const shot = await page.screenshot({ path: "test-results/poc-art-v2.png" });
  expect(shot.length).toBeGreaterThan(80_000);
  expect(errors).toEqual([]);
});
