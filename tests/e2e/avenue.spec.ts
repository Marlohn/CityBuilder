/** Avenida diferente da rua na tela (issue #14). */
import { expect, test } from "@playwright/test";
import { openGame, screenOf } from "./helpers";

test("avenida tem canteiro central verde; rua não", async ({ page }) => {
  await openGame(page, "avenida");
  await page.evaluate(() => {
    const c = window.__city.client;
    c.command({ type: "buildRoad", kind: "street", x0: 60, y0: 110, x1: 80, y1: 110 });
    c.command({ type: "buildRoad", kind: "avenue", x0: 60, y0: 116, x1: 80, y1: 116 });
    window.__city.renderer.lookAt(70, 113);
    window.__city.renderer.zoomBy(0.2);
  });
  await page.waitForFunction(() => {
    const m = window.__city.map();
    return m && m.roads[116 * m.width + 70] === 2 && m.roads[110 * m.width + 70] === 1;
  });
  await page.waitForTimeout(1500);
  // Cor bem no meio da via: verde (canteiro) na avenida, asfalto na rua.
  const a = await screenOf(page, 70.5, 0.03, 116.5);
  const r = await screenOf(page, 70.5, 0.03, 110.5);
  const px = await page.evaluate(
    ([ax, ay, rx, ry]) => {
      const canvas = document.getElementById("city") as HTMLCanvasElement;
      const off = document.createElement("canvas");
      off.width = canvas.width;
      off.height = canvas.height;
      const ctx = off.getContext("2d") as CanvasRenderingContext2D;
      ctx.drawImage(canvas, 0, 0);
      const rect = canvas.getBoundingClientRect();
      const at = (x: number, y: number) =>
        Array.from(
          ctx.getImageData(
            Math.round(((x - rect.left) * canvas.width) / rect.width),
            Math.round(((y - rect.top) * canvas.height) / rect.height),
            1,
            1,
          ).data,
        );
      return { ave: at(ax, ay), rua: at(rx, ry) };
    },
    [a.x, a.y, r.x, r.y] as const,
  );
  const isGreen = (c: number[]) => (c[1] ?? 0) > (c[0] ?? 0) + 15 && (c[1] ?? 0) > (c[2] ?? 0) + 15;
  expect(isGreen(px.ave), `meio da avenida: ${px.ave}`).toBe(true);
  expect(isGreen(px.rua), `meio da rua: ${px.rua}`).toBe(false);
});
