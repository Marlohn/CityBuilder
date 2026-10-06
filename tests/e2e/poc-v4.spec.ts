import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openGame } from "./helpers";

test("POC v4 usa os novos GLBs no renderer e mantém a cidade real funcional", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?seed=poc-v4-live&poc=v4&cinema=1");
  await page.waitForFunction(
    () => {
      const state = window.__city?.store.get();
      return state?.ready || Boolean(state?.error);
    },
    null,
    { timeout: 120_000 },
  );
  const bootError = await page.evaluate(() => window.__city.store.get().error);
  expect(bootError).toBeNull();
  await page.waitForFunction(() => window.__city.renderer.pocV4State().ready, null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__city.buildings().length >= 12, null, { timeout: 120_000 });
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => {
    const renderer = window.__city.renderer;
    const used = renderer.scene.meshes
      .filter(
        (m: { name: string; thinInstanceCount: number }) =>
          m.name.startsWith("poc-v4/") && m.thinInstanceCount > 0,
      )
      .map((m: { name: string; thinInstanceCount: number }) => ({
        name: m.name,
        count: m.thinInstanceCount,
      }));
    return {
      poc: renderer.pocV4State(),
      used,
      buildings: window.__city.buildings().length,
      uiChildren: document.getElementById("ui")?.childElementCount ?? 0,
      badge: document.getElementById("poc-v4-badge")?.textContent ?? "",
    };
  });

  expect(state.poc.enabled).toBe(true);
  expect(state.poc.camera).toBe("perspective");
  expect(state.poc.fovDegrees).toBeCloseTo(27, 3);
  expect(state.poc.environment?.toneMapping).toBe("ACES");
  expect(state.poc.environment?.bloom).toBe(true);
  expect(state.poc.environment?.ssao).toEqual(expect.any(Boolean));
  expect(state.buildings).toBeGreaterThanOrEqual(12);
  expect(state.uiChildren).toBe(0);
  expect(state.badge).toContain("POC v4");

  const names: string[] = state.used.map((x: { name: string }) => x.name);
  expect(names.some((name: string) => name.startsWith("poc-v4/rua_"))).toBe(true);
  expect(names.some((name: string) => name.startsWith("poc-v4/lote_"))).toBe(true);
  expect(names.some((name: string) => name.startsWith("poc-v4/arvore_"))).toBe(true);
  expect(
    names.some((name: string) => name.startsWith("poc-v4/carro_") || name.startsWith("poc-v4/pessoa_")),
  ).toBe(true);

  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/poc-v4-performance.json",
    JSON.stringify(
      {
        note: "Amostra curta no Chromium headless/SwiftShader; serve para detectar regressão grosseira, não como meta de FPS.",
        ...state.poc,
        usedAssets: state.used,
        buildings: state.buildings,
      },
      null,
      2,
    ),
  );
  await page.locator("#city").screenshot({ path: "test-results/poc-v4-city.png" });
  expect(errors).toEqual([]);
});

test("renderer padrão continua fora da POC v4", async ({ page }) => {
  const errors = await openGame(page, "poc-v4-default");
  const state = await page.evaluate(() => ({
    poc: window.__city.renderer.pocV4State(),
    badge: document.getElementById("poc-v4-badge"),
  }));

  expect(state.poc.enabled).toBe(false);
  expect(state.poc.camera).toBe("orthographic");
  expect(state.poc.environment).toBeNull();
  expect(state.badge).toBeNull();
  expect(errors).toEqual([]);
});
