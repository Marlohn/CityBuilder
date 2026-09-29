/** Ajudantes dos testes de tela: abrir o jogo e falar com ele pelo mesmo cliente da interface. */
import type { Page } from "@playwright/test";

declare global {
  interface Window {
    // biome-ignore lint/suspicious/noExplicitAny: acesso de teste
    __city: any;
  }
}

export async function openGame(page: Page, seed: string, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?seed=${seed}${query}`);
  await page.waitForFunction(() => window.__city?.store.get().ready, null, { timeout: 120_000 });
  return errors;
}

/** Posição na página (CSS px) de um ponto do mundo. */
export async function screenOf(page: Page, x: number, y: number, z: number) {
  return page.evaluate(
    ([x, y, z]) => {
      const c = window.__city.renderer;
      const p = c.worldToScreen(x, y, z);
      const canvas = document.getElementById("city") as HTMLCanvasElement;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (p.x * r.width) / canvas.width, y: r.top + (p.y * r.height) / canvas.height };
    },
    [x, y, z] as const,
  );
}

/** Ponto do chão embaixo de uma posição da página (CSS px). */
export async function groundAt(page: Page, px: number, py: number) {
  return page.evaluate(
    ([px, py]) => {
      const canvas = document.getElementById("city") as HTMLCanvasElement;
      const r = canvas.getBoundingClientRect();
      return window.__city.renderer.screenToGround(
        ((px - r.left) * canvas.width) / r.width,
        ((py - r.top) * canvas.height) / r.height,
      );
    },
    [px, py] as const,
  );
}
