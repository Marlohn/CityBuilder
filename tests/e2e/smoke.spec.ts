/**
 * Teste de tela: abre o jogo, constrói por script e confere que a cidade foi desenhada.
 * Os comandos são enviados pelo mesmo cliente que a interface usa.
 */
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    // biome-ignore lint/suspicious/noExplicitAny: acesso de teste
    __city: any;
  }
}

test("o jogo abre, aceita comandos e desenha a cidade", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?seed=e2e");
  await page.waitForFunction(() => window.__city?.store.get().ready, null, { timeout: 120_000 });

  await page.evaluate(() => {
    const c = window.__city.client;
    c.command({ type: "buildRoad", kind: "avenue", x0: 100, y0: 128, x1: 150, y1: 128 });
    c.command({ type: "buildRoad", kind: "street", x0: 120, y0: 110, x1: 120, y1: 146 });
    c.command({ type: "zone", zone: "residential_low", x0: 121, y0: 119, x1: 135, y1: 127 });
    c.command({ type: "placeService", service: "escola", x: 121, y: 129 });
    window.__city.renderer.lookAt(125, 128);
  });
  await page.waitForFunction(() => {
    const m = window.__city.map();
    if (!m) return false;
    let roads = 0;
    for (const v of m.roads) if (v) roads++;
    return roads >= 51 + 36;
  });
  await page.waitForFunction(() => window.__city.buildings().length >= 1);
  await page.waitForTimeout(1500);

  const shot = await page.screenshot({ path: "test-results/smoke.png" });
  expect(shot.length).toBeGreaterThan(50_000);
  expect(errors).toEqual([]);
});
