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
    const chunks = renderer.scene.meshes.filter((m: { name: string }) => m.name.startsWith("poc-v4-chunk/"));
    const roadSubMeshes = chunks
      .filter((m: { name: string }) => m.name.includes("/poc-v4/rua_"))
      .map((m: { subMeshes: unknown[] }) => m.subMeshes.length);
    const lotSubMeshes = chunks
      .filter((m: { name: string }) => m.name.includes("/poc-v4/lote_"))
      .map((m: { subMeshes: unknown[] }) => m.subMeshes.length);
    const subMeshFidelity = chunks.every(
      (mesh: {
        name: string;
        material: unknown;
        subMeshes: {
          materialIndex: number;
          verticesStart: number;
          verticesCount: number;
          indexStart: number;
          indexCount: number;
        }[];
      }) => {
        const model = mesh.name.split("/").slice(3).join("/");
        const source = renderer.scene.meshes.find((m: { name: string }) => m.name === model) as
          | {
              material: unknown;
              subMeshes: {
                materialIndex: number;
                verticesStart: number;
                verticesCount: number;
                indexStart: number;
                indexCount: number;
              }[];
            }
          | undefined;
        if (!source || mesh.material !== source.material || mesh.subMeshes.length !== source.subMeshes.length)
          return false;
        return mesh.subMeshes.every((sub, index) => {
          const original = source.subMeshes[index];
          return (
            original !== undefined &&
            sub.materialIndex === original.materialIndex &&
            sub.verticesStart === original.verticesStart &&
            sub.verticesCount === original.verticesCount &&
            sub.indexStart === original.indexStart &&
            sub.indexCount === original.indexCount
          );
        });
      },
    );
    return {
      poc: renderer.pocV4State(),
      used,
      roadSubMeshes,
      lotSubMeshes,
      subMeshFidelity,
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
  expect(Math.max(...state.roadSubMeshes)).toBeGreaterThan(1);
  expect(Math.max(...state.lotSubMeshes)).toBeGreaterThan(1);
  expect(state.subMeshFidelity).toBe(true);

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

test("POC v4 perf mantém o baseline pequeno comparável à hero original", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?poc=v4&cinema=1&perf=1&stress=small&engine=webgl");
  await page.waitForFunction(
    () => {
      const city = window.__city;
      return city?.store.get().ready && city.renderer.pocV4State().ready;
    },
    null,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(1800);

  const state = await page.evaluate(() => ({
    perf: window.__city.performance(),
    buildings: window.__city.buildings().length,
  }));

  expect(state.perf.engine).toBe("WebGL");
  expect(state.perf.graphics.profile).toBe("perf");
  expect(state.perf.environment?.toneMapping).toBe("ACES");
  expect(state.perf.environment?.bloom).toBe(true);
  expect(state.perf.environment?.ssao).toBe(false);
  expect(state.perf.environment?.msaaSamples).toBe(1);
  expect(state.buildings).toBe(22);
  expect(errors).toEqual([]);

  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/poc-v4-performance-tuned-small.json",
    JSON.stringify(
      {
        note: "Amostra curta no Chromium headless/SwiftShader; comparar apenas como sinal de regressão, nunca como gate de GPU real.",
        ...state.perf,
        buildings: state.buildings,
      },
      null,
      2,
    ),
  );
  await page.locator("#city").screenshot({ path: "test-results/poc-v4-tuned-small.png" });
});

test("POC v4 perf particiona cidade grande e expõe métricas do gate", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?poc=v4&cinema=1&perf=1&stress=large&shadows=0&bloom=0&scale=0.5");
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
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => {
    const before = window.__city.performance().chunks.bufferUpdates;
    const map = window.__city.map();
    if (map) window.__city.renderer.setMap(map);
    window.__city.renderer.setBuildings(window.__city.buildings());
    const after = window.__city.performance().chunks.bufferUpdates;
    const buildings = window.__city.buildings();
    return {
      perf: window.__city.performance(),
      stress: window.__city.stress,
      view: window.__city.view,
      buildings: buildings.length,
      buildingBounds: {
        minX: Math.min(...buildings.map((b) => b.x)),
        maxX: Math.max(...buildings.map((b) => b.x)),
        minY: Math.min(...buildings.map((b) => b.y)),
        maxY: Math.max(...buildings.map((b) => b.y)),
      },
      map: { width: map?.width, height: map?.height },
      hud: document.getElementById("poc-v4-perf")?.textContent ?? "",
      repeatedStaticUploads: after - before,
    };
  });

  expect(state.stress).toBe("large");
  expect(state.view).toBe("medium");
  expect(state.map).toEqual({ width: 256, height: 256 });
  expect(state.buildings).toBeGreaterThanOrEqual(5000);
  expect(state.buildingBounds.minX).toBeLessThan(16);
  expect(state.buildingBounds.maxX).toBeGreaterThan(240);
  expect(state.buildingBounds.minY).toBeLessThan(16);
  expect(state.buildingBounds.maxY).toBeGreaterThan(240);
  expect(state.perf.graphics.profile).toBe("perf");
  expect(state.perf.graphics.shadowMapSize).toBe(2048);
  expect(state.perf.graphics.resolutionScale).toBeCloseTo(0.5, 2);
  expect(state.perf.environment?.msaaSamples).toBe(1);
  expect(state.perf.environment?.ssao).toBe(false);
  expect(state.perf.environment?.bloom).toBe(false);
  expect(state.perf.graphics.shadowsEnabled).toBe(false);
  expect(state.perf.chunks.active).toBeGreaterThan(20);
  expect(state.perf.chunks.visible).toBeGreaterThan(0);
  expect(state.perf.chunks.visible).toBeLessThan(state.perf.chunks.active);
  expect(state.perf.chunks.instances).toBeGreaterThan(5000);
  expect(state.perf.chunks.visibleInstances).toBeLessThan(state.perf.chunks.instances);
  expect(state.repeatedStaticUploads).toBe(0);
  expect(state.hud).toContain("v4 perf · large/medium");
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
});

test("POC v4 integrada continua ligada ao Worker e à simulação real", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?seed=poc-v4-scale-integration&poc=v4");
  await page.waitForFunction(
    () => {
      const city = window.__city;
      return (
        city?.renderer.pocV4State().ready &&
        Boolean(city.map()) &&
        (city.store.get().ready || Boolean(city.store.get().error))
      );
    },
    null,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(800);

  const state = await page.evaluate(() => ({
    error: window.__city.store.get().error,
    map: { width: window.__city.map()?.width, height: window.__city.map()?.height },
    poc: window.__city.renderer.pocV4State(),
    uiChildren: document.getElementById("ui")?.childElementCount ?? 0,
  }));

  expect(state.error).toBeNull();
  expect(state.map).toEqual({ width: 256, height: 256 });
  expect(state.poc.enabled).toBe(true);
  expect(state.poc.ready).toBe(true);
  expect(state.uiChildren).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("POC v4 WebGPU mantém fallback WebGL seguro", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?poc=v4&cinema=1&perf=1&engine=webgpu");
  await page.waitForFunction(
    () => {
      const state = window.__city?.store.get();
      return state?.ready || Boolean(state?.error);
    },
    null,
    { timeout: 120_000 },
  );

  const state = await page.evaluate(() => ({
    error: window.__city.store.get().error,
    perf: window.__city.performance(),
  }));

  expect(state.error).toBeNull();
  expect(state.perf.engineRequested).toBe("webgpu");
  expect(["WebGPU", "WebGL"]).toContain(state.perf.engine);
  expect(state.perf.engineFallback).toBe(state.perf.engine === "WebGL");
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
