import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createBrowserBridge } from "../../tools/factory-browser";

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
