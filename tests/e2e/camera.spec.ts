/** Câmera como no Cities: Skylines II (issue #9). */
import { expect, test } from "@playwright/test";
import { groundAt, openGame, screenOf } from "./helpers";

test("botão direito arrastando agarra o mapa (o chão acompanha o mouse)", async ({ page }) => {
  await openGame(page, "camera");
  const start = await groundAt(page, 600, 400);
  await page.mouse.move(600, 400);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(680, 440, { steps: 8 });
  await page.mouse.up({ button: "right" });
  const after = await groundAt(page, 680, 440);
  expect(Math.abs(after.x - start.x), "o ponto agarrado saiu de baixo do mouse").toBeLessThan(0.3);
  expect(Math.abs(after.z - start.z), "o ponto agarrado saiu de baixo do mouse").toBeLessThan(0.3);
});

test("W move a vista para cima e D para a direita", async ({ page }) => {
  await openGame(page, "camera");
  const center = await groundAt(page, 640, 400);
  const before = await screenOf(page, center.x, 0, center.z);
  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  const afterW = await screenOf(page, center.x, 0, center.z);
  // A câmera subiu: o que estava no centro desce na tela.
  expect(afterW.y - before.y).toBeGreaterThan(20);
  expect(Math.abs(afterW.x - before.x)).toBeLessThan(10);
  await page.keyboard.down("d");
  await page.waitForTimeout(400);
  await page.keyboard.up("d");
  const afterD = await screenOf(page, center.x, 0, center.z);
  // A câmera foi para a direita: o ponto vai para a esquerda na tela.
  expect(afterD.x - afterW.x).toBeLessThan(-20);
  expect(Math.abs(afterD.y - afterW.y)).toBeLessThan(10);
});

test("Q/E giram suave enquanto apertados (não pulam 90°)", async ({ page }) => {
  await openGame(page, "camera");
  const a0 = (await page.evaluate(() => window.__city.renderer.cameraState())).alpha;
  await page.keyboard.down("q");
  await page.waitForTimeout(250);
  await page.keyboard.up("q");
  const a1 = (await page.evaluate(() => window.__city.renderer.cameraState())).alpha;
  expect(Math.abs(a1 - a0)).toBeGreaterThan(0.05);
  expect(Math.abs(a1 - a0)).toBeLessThan(Math.PI / 2 - 0.2);
  await page.keyboard.down("e");
  await page.waitForTimeout(250);
  await page.keyboard.up("e");
  const a2 = (await page.evaluate(() => window.__city.renderer.cameraState())).alpha;
  expect(a2 - a1, "E gira para o lado contrário de Q").toBeLessThan(0);
});
