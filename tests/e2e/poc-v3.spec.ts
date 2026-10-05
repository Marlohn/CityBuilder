import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openGame } from "./helpers";

async function waitForPoc(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => window.__city?.renderer.pocV3State().ready, null, { timeout: 120_000 });
  await page.waitForTimeout(500);
}

test("benchmark Kenney no Babylon usa a mesma referência e pipeline controlada", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?poc=v3&scene=kenney&camera=perspective");
  await waitForPoc(page);
  await page.waitForFunction(() => {
    const image = document.getElementById("poc-v3-reference") as HTMLImageElement | null;
    return !!image?.complete && image.naturalWidth > 0;
  });

  const state = await page.evaluate(() => ({
    poc: window.__city.renderer.pocV3State(),
    camera: window.__city.renderer.cameraState(),
  }));
  expect(state.poc.scene).toBe("kenney");
  expect(state.poc.environment?.toneMapping).toBe("ACES");
  expect(state.camera.mode).toBe("perspective");
  expect(state.camera.fovDegrees).toBeCloseTo(20, 3);

  await page.locator("#poc-v3-reference").screenshot({ path: "test-results/kenney-reference.png" });
  await page.locator("#city").screenshot({ path: "test-results/kenney-babylon.png" });
  expect(errors).toEqual([]);
});

test("hero block produz comparação ortográfica e perspectiva estreita", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/?poc=v3&scene=hero&camera=orthographic");
  await waitForPoc(page);
  const ortho = await page.evaluate(() => window.__city.renderer.pocV3State());
  expect(ortho.camera).toBe("orthographic");
  expect(ortho.environment?.ssao).toEqual(expect.any(Boolean));
  await page.locator("#city").screenshot({ path: "test-results/hero-orthographic.png" });

  await page.goto("/?poc=v3&scene=hero&camera=perspective");
  await waitForPoc(page);
  const perspective = await page.evaluate(() => ({
    poc: window.__city.renderer.pocV3State(),
    camera: window.__city.renderer.cameraState(),
  }));
  expect(perspective.poc.camera).toBe("perspective");
  expect(perspective.camera.fovDegrees).toBeCloseTo(20, 3);
  await page.locator("#city").screenshot({ path: "test-results/hero-perspective.png" });

  expect(errors).toEqual([]);
});

test("live city continua funcional e registra observação curta de performance", async ({ page }) => {
  const errors = await openGame(page, "poc-v3-live", "&modo=livre&poc=v3&scene=live&camera=perspective");
  await page.waitForFunction(() => window.__city.buildings().length >= 12, null, { timeout: 120_000 });
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => window.__city.renderer.pocV3State());
  expect(state.scene).toBe("live");
  expect(state.camera).toBe("perspective");
  expect(state.environment?.toneMapping).toBe("ACES");
  expect(state.meshes).toBeGreaterThan(10);
  expect(state.activeMeshes).toBeGreaterThan(0);
  expect(state.fps).toBeGreaterThan(0);

  const tile = await page.evaluate(() => {
    const b = window.__city.buildings()[0];
    const renderer = window.__city.renderer;
    const p = renderer.worldToScreen(b.x + b.w / 2, 0.15, b.y + b.h / 2);
    return renderer.screenToTile(p.x, p.y);
  });
  expect(tile).not.toBeNull();

  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/poc-v3-performance.json",
    JSON.stringify(
      {
        note: "Amostra curta no Chromium headless; serve apenas para detectar regressão grosseira da POC.",
        ...state,
      },
      null,
      2,
    ),
  );
  await page.locator("#city").screenshot({ path: "test-results/live-city.png" });
  expect(errors).toEqual([]);
});
