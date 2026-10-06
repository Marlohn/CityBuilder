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
          m.name.startsWith("poc-v4-chunk/") && m.thinInstanceCount > 0,
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
  expect(names.some((name: string) => name.includes("/poc-v4/rua_"))).toBe(true);
  expect(names.some((name: string) => name.includes("/poc-v4/lote_"))).toBe(true);
  expect(names.some((name: string) => name.includes("/poc-v4/arvore_"))).toBe(true);
  expect(
    names.some((name: string) => name.includes("/poc-v4/carro_") || name.includes("/poc-v4/pessoa_")),
  ).toBe(true);
  expect(state.poc.chunks.active).toBeGreaterThan(0);

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

test("POC v4 perf particiona cidade grande e expõe métricas do gate", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?poc=v4&cinema=1&perf=1&stress=large");
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
  await page.waitForFunction(() => window.__city.buildings().length >= 5000, null, { timeout: 120_000 });
  await page.waitForTimeout(1800);

  const state = await page.evaluate(() => ({
    perf: window.__city.performance(),
    stress: window.__city.stress,
    buildings: window.__city.buildings().length,
    map: { width: window.__city.map()?.width, height: window.__city.map()?.height },
    hud: document.getElementById("poc-v4-perf")?.textContent ?? "",
  }));

  expect(state.stress).toBe("large");
  expect(state.map).toEqual({ width: 256, height: 256 });
  expect(state.buildings).toBeGreaterThanOrEqual(5000);
  expect(state.perf.graphics.profile).toBe("perf");
  expect(state.perf.graphics.shadowMapSize).toBe(2048);
  expect(state.perf.graphics.resolutionScale).toBeCloseTo(0.85, 2);
  expect(state.perf.environment?.msaaSamples).toBe(1);
  expect(state.perf.environment?.ssao).toBe(false);
  expect(state.perf.chunks.active).toBeGreaterThan(20);
  expect(state.perf.chunks.visible).toBeGreaterThan(0);
  expect(state.perf.chunks.visible).toBeLessThan(state.perf.chunks.active);
  expect(state.perf.chunks.instances).toBeGreaterThan(5000);
  expect(state.perf.chunks.visibleInstances).toBeLessThan(state.perf.chunks.instances);
  expect(state.hud).toContain("v4 perf · large");
  expect(errors).toEqual([]);

  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/poc-v4-scale-gate.json",
    JSON.stringify(
      {
        note: "Métricas de CI headless validam arquitetura/culling, não o gate final de FPS em GPU real.",
        ...state,
      },
      null,
      2,
    ),
  );
  await page.locator("#city").screenshot({ path: "test-results/poc-v4-large.png" });
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
