import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createBrowserBridge } from "../../tools/factory-browser";
import { groundAt, screenOf } from "./helpers";

test("ponte move a câmera com botão direito e tecla mantida, soltando os controles", async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), "city-camera-bridge-"));
  const bridge = await createBrowserBridge(page, dir, "http://127.0.0.1:4173/?seed=factory-camera");
  try {
    const start = await groundAt(page, 600, 400);
    const drag = await bridge.observe([
      { type: "drag", button: "right", x: 600, y: 400, toX: 680, toY: 440 },
    ]);
    expect(drag.errors).toEqual([]);
    const afterDrag = await groundAt(page, 680, 440);
    expect(Math.abs(afterDrag.x - start.x)).toBeLessThan(0.3);
    expect(Math.abs(afterDrag.z - start.z)).toBeLessThan(0.3);
    const center = await groundAt(page, 640, 400);
    const before = await screenOf(page, center.x, 0, center.z);
    const held = await bridge.observe([{ type: "key", key: "w", ms: 400 }]);
    expect(held.errors).toEqual([]);
    const after = await screenOf(page, center.x, 0, center.z);
    expect(after.y - before.y).toBeGreaterThan(20);
    await page.waitForTimeout(400);
    const released = await screenOf(page, center.x, 0, center.z);
    expect(Math.abs(released.y - after.y)).toBeLessThan(2);
    await expect(bridge.observe([{ type: "key", key: "w", ms: 60_000 }])).rejects.toThrow();
  } finally {
    await bridge.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("observação usa controles públicos e guarda prova mesmo quando uma ação falha", async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), "city-observation-"));
  const bridge = await createBrowserBridge(page, dir, "http://127.0.0.1:4173/?seed=factory-e2e");
  try {
    const initial = await bridge.observe([]);
    expect(initial.screenshot).toMatch(/\.png$/);
    expect(initial.text).toContain("Cidade");
    expect(initial.controls.some((c) => c.role === "button")).toBe(true);
    const failed = await bridge.observe([{ type: "click", role: "button", name: "inexistente-123" }]);
    expect(failed.errors.length).toBe(1);
    expect(failed.id).not.toBe(initial.id);
    expect((await readFile(failed.screenshot)).length).toBeGreaterThan(1000);
    const trace = await readFile(join(dir, "actions.jsonl"), "utf8");
    expect(trace).toContain("inexistente-123");
    expect(initial).not.toHaveProperty("simulation");
  } finally {
    await bridge.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ponte rejeita execução arbitrária e ações sem limite", async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), "city-observation-"));
  const bridge = await createBrowserBridge(page, dir, "http://127.0.0.1:4173/?seed=factory-e2e");
  try {
    await expect(bridge.observe([{ type: "evaluate", script: "window.__city" }])).rejects.toThrow();
    await expect(bridge.observe([{ type: "wait", ms: 60_000 }])).rejects.toThrow();
    await expect(bridge.observe([{ type: "navigate", url: "https://example.org" }])).rejects.toThrow();
  } finally {
    await bridge.close();
    await rm(dir, { recursive: true, force: true });
  }
});

import { spawn } from "node:child_process";

test("CLI só anuncia prontidão depois da imagem e atende ações autenticadas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "city-browser-cli-"));
  const server = spawn(
    process.execPath,
    ["--import", "tsx", "tools/factory-browser.ts", "serve", "http://127.0.0.1:4173/?seed=factory-cli"],
    { env: { ...process.env, FACTORY_BROWSER_DIR: dir }, stdio: "ignore" },
  );
  try {
    await expect
      .poll(
        async () => {
          try {
            return JSON.parse(await readFile(join(dir, "address.json"), "utf8"));
          } catch {
            return null;
          }
        },
        { timeout: 150_000, intervals: [1000] },
      )
      .not.toBeNull();
    const address = JSON.parse(await readFile(join(dir, "address.json"), "utf8"));
    expect((await readFile(join(dir, "0001.png"))).length).toBeGreaterThan(1000);
    const denied = await fetch(address.url, { method: "POST", body: "[]" });
    expect(denied.status).toBe(403);
    const response = await fetch(address.url, {
      method: "POST",
      headers: { authorization: address.token, "content-type": "application/json" },
      body: JSON.stringify([{ type: "key", key: "Escape" }]),
    });
    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(result.id).toBe("0002");
    expect(result.errors).toEqual([]);
  } finally {
    server.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
