/** Painel lateral recolhível (issue #12). */
import { expect, test } from "@playwright/test";
import { openGame } from "./helpers";

test("painel abre e fecha pelo botão e pela tecla I, e lembra a escolha", async ({ page }) => {
  await openGame(page, "painel");
  const side = page.locator(".side");
  await expect(side).toBeVisible();
  await page.locator(".side-close").click();
  await expect(side).toBeHidden();
  await expect(page.locator(".side-tab")).toBeVisible();
  await page.keyboard.press("i");
  await expect(side).toBeVisible();
  await page.keyboard.press("i");
  await expect(side).toBeHidden();
  // Recarregar a página mantém o painel fechado.
  await page.reload();
  await page.waitForFunction(() => window.__city?.store.get().ready, null, { timeout: 120_000 });
  await expect(side).toBeHidden();
  await page.locator(".side-tab").click();
  await expect(side).toBeVisible();
});
