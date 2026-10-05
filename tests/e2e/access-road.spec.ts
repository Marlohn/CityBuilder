/** Jornada da issue #260: orientação, aviso e crescimento pela interface real. */
import { expect, test } from "@playwright/test";
import { openGame, screenOf } from "./helpers";

test("a avenida orienta a partida e conectar a rua permite o crescimento", async ({ page }, info) => {
  test.setTimeout(210_000);
  const errors = await openGame(page, "acesso-visivel");
  await expect(page.locator(".tabs .active")).toHaveText("Cidade");
  await expect(page.locator(".side .panel-body")).toContainText("Avenida de acesso");
  const tip = await screenOf(page, 47.5, 0, 128.5);
  expect(tip.x).toBeGreaterThan(210);
  expect(tip.x).toBeLessThan(930);
  expect(tip.y).toBeGreaterThan(80);
  expect(tip.y).toBeLessThan(740);
  await page.screenshot({ path: info.outputPath("avenida-inicial.png") });

  const drag = async (x0: number, y0: number, x1: number, y1: number) => {
    const from = await screenOf(page, x0 + 0.5, 0, y0 + 0.5);
    const to = await screenOf(page, x1 + 0.5, 0, y1 + 0.5);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };
  await page.getByRole("button", { name: /Rua/ }).click();
  await drag(44, 124, 55, 124);
  const warning = page.locator(".toast").filter({ hasText: "Via desconectada" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("avenida de acesso");
  await page.screenshot({ path: info.outputPath("via-desconectada.png") });

  await page.getByRole("button", { name: /Casas/ }).click();
  await drag(45, 122, 55, 123);
  const population = page.locator(".side .kv tr").filter({ hasText: "Moradores" }).locator("td").nth(1);
  await expect(population).toHaveText("0");
  await page.getByRole("button", { name: /Rua/ }).click();
  await drag(44, 125, 44, 128);
  await expect(warning).toBeHidden({ timeout: 6000 });
  await page.getByRole("button", { name: "▶▶▶", exact: true }).click();
  await expect
    .poll(async () => Number((await population.textContent())?.replace(/\D/g, "")), { timeout: 120_000 })
    .toBeGreaterThan(0);
  try {
    await page.screenshot({
      path: info.outputPath("via-conectada-crescimento.png"),
      timeout: 10_000,
    });
  } catch (error) {
    console.warn("Screenshot final dispensada após o comportamento já ter sido comprovado:", error);
  }
  expect(errors).toEqual([]);
});
