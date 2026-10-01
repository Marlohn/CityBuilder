/** Teste de aceitação da issue #103 (papel QA): topbar mostra demanda + água/luz. Deve FALHAR antes do Dev. */
import { expect, test } from "@playwright/test";
import { openGame } from "./helpers";

/** Mesmo formato de inteiro da tela (packages/ui/src/format.ts). */
function int(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

async function closePanel(page: import("@playwright/test").Page) {
  await page.locator(".side-close").click();
  await expect(page.locator(".side"), "painel lateral deveria sumir depois de fechar").toBeHidden();
}

function waterValue(page: import("@playwright/test").Page) {
  return page.locator(".topbar").locator(".stat", { hasText: "Água" }).locator(".value");
}

function powerValue(page: import("@playwright/test").Page) {
  return page.locator(".topbar").locator(".stat", { hasText: "Luz" }).locator(".value");
}

type UtilityLevel = { used: number; capacity: number | null };

async function lockStats(
  page: import("@playwright/test").Page,
  patch: { stats: { utilities?: Record<string, UtilityLevel> } & Record<string, unknown> },
) {
  await page.evaluate((p) => {
    // biome-ignore lint/suspicious/noExplicitAny: acesso de teste ao store da página
    const store = (window as any).__city.store;
    // biome-ignore lint/suspicious/noExplicitAny: patch genérico do teste
    const incoming = (p as any).stats ?? {};
    if (!store.__qaLock) {
      const orig = store.set.bind(store);
      let frozen = store.get().stats;
      store.__qaLock = true;
      // biome-ignore lint/suspicious/noExplicitAny: patch genérico do store
      store.set = (patch: any) => {
        if (patch && "stats" in patch && patch.stats) {
          frozen = patch.stats as typeof frozen;
          const locked = store.__qaUtilities;
          if (locked) {
            frozen = {
              ...frozen,
              utilities: { ...(frozen as { utilities: object }).utilities, ...locked },
            };
          }
          const lockedC = store.__qaConstruction;
          if (lockedC) frozen = { ...frozen, construction: lockedC };
        }
        orig({ ...patch, stats: frozen });
      };
      (window as unknown as Record<string, unknown>).__qaFrozen = () => frozen;
    }
    const cur = store.get().stats;
    if (incoming.utilities) {
      store.__qaUtilities = { ...cur.utilities, ...incoming.utilities };
    }
    if (incoming.construction) {
      store.__qaConstruction = incoming.construction;
    }
    store.set({
      stats: {
        ...cur,
        ...incoming,
        utilities: { ...cur.utilities, ...(incoming.utilities ?? {}) },
      },
    });
  }, patch);
}

async function injectUtilities(
  page: import("@playwright/test").Page,
  levels: { water: UtilityLevel; power: UtilityLevel },
) {
  await lockStats(page, {
    stats: { utilities: { water: levels.water, power: levels.power } },
  });
}

/** Dica do número (.value) ou do .stat que o contém (mesma dica para quem passa o mouse sobre o número). */
async function statTitle(
  page: import("@playwright/test").Page,
  value: import("@playwright/test").Locator,
  label: string,
): Promise<string | null> {
  const direct = await value.getAttribute("title");
  if (direct) return direct;
  const parent = page.locator(".topbar").locator(".stat", { hasText: label });
  return parent.getAttribute("title");
}

/** Dica da barra (.dbar) ou da .demand que a contém. */
async function demandBarTitle(bar: import("@playwright/test").Locator): Promise<string | null> {
  const direct = await bar.getAttribute("title");
  if (direct) return direct;
  const parent = bar.locator("xpath=ancestor::*[contains(@class,'demand')][1]");
  return parent.getAttribute("title");
}

async function utilityTitleLower(
  page: import("@playwright/test").Page,
  label: "Água" | "Luz",
): Promise<string> {
  const value = label === "Água" ? waterValue(page) : powerValue(page);
  const title = await statTitle(page, value, label);
  return (title ?? "").toLowerCase();
}

function parseRgb(css: string): { r: number; g: number; b: number } {
  const m = css.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return { r: Number(m?.[1] ?? 0), g: Number(m?.[2] ?? 0), b: Number(m?.[3] ?? 0) };
}

/** Classifica com folga: verde = g maior que r e que b; amarelo = r e g altos e b baixo; vermelho = r alto e g baixo. */
function colorClass(c: { r: number; g: number; b: number }): string {
  if (c.r >= 150 && c.g >= 150 && c.b <= 120) return "amarela";
  if (c.r >= 150 && c.g <= 120) return "vermelha";
  if (c.g > c.r && c.g > c.b) return "verde";
  return "outra";
}

async function waterColorClass(page: import("@playwright/test").Page): Promise<string> {
  const css: string = await waterValue(page).evaluate((el) => getComputedStyle(el).color);
  return colorClass(parseRgb(css));
}

test("barra principal mostra a demanda e a água e a luz com o painel fechado", async ({ page }) => {
  await openGame(page, "topbar");
  await closePanel(page);
  const topbar = page.locator(".topbar");
  await expect(topbar, "barra principal deveria continuar visível com o painel fechado").toBeVisible();
  for (const label of ["Residencial", "Comercial", "Industrial", "Água", "Luz"]) {
    await expect(
      topbar.getByText(label, { exact: false }),
      `rótulo ${label} deveria aparecer na barra principal`,
    ).toBeVisible();
  }
  await expect(
    topbar.locator(".dbar"),
    "deveria existir 3 barras de demanda dentro da barra principal",
  ).toHaveCount(3);
  await expect(waterValue(page), "valor da água deveria mostrar usado / capacidade").toContainText("/");
  await expect(powerValue(page), "valor da luz deveria mostrar usado / capacidade").toContainText("/");
});

test("os números batem com o store", async ({ page }) => {
  await openGame(page, "topbar");
  await closePanel(page);
  const utils = await page.evaluate(() => window.__city.store.get().stats.utilities);
  const waterUsed: string = int(utils.water.used);
  const powerUsed: string = int(utils.power.used);
  await expect
    .poll(async () => waterValue(page).textContent(), {
      message: "texto da água deveria acompanhar o número do store",
    })
    .toContain(waterUsed);
  await expect
    .poll(async () => powerValue(page).textContent(), {
      message: "texto da luz deveria acompanhar o número do store",
    })
    .toContain(powerUsed);
  const waterCap = utils.water.capacity as number | null;
  const powerCap = utils.power.capacity as number | null;
  const waterHasCap = typeof waterCap === "number";
  expect(waterHasCap, "cidade de teste deveria ter capacidade de água numérica").toBe(true);
  const powerHasCap = typeof powerCap === "number";
  expect(powerHasCap, "cidade de teste deveria ter capacidade de luz numérica").toBe(true);
  if (waterHasCap) {
    await expect
      .poll(async () => waterValue(page).textContent(), {
        message: "texto da água deveria conter a capacidade do store",
      })
      .toContain(int(waterCap as number));
  }
  if (powerHasCap) {
    await expect
      .poll(async () => powerValue(page).textContent(), {
        message: "texto da luz deveria conter a capacidade do store",
      })
      .toContain(int(powerCap as number));
  }
});

test("cor conforme a fração usada/capacidade", async ({ page }) => {
  await openGame(page, "topbar");
  await closePanel(page);
  await injectUtilities(page, { water: { used: 10, capacity: 100 }, power: { used: 10, capacity: 100 } });
  await expect
    .poll(() => waterColorClass(page), {
      message: "água em 10% deveria ficar verde",
    })
    .toBe("verde");
  await injectUtilities(page, { water: { used: 10, capacity: 100 }, power: { used: 10, capacity: 100 } });
  await expect
    .poll(() => waterColorClass(page), {
      message: "repetir 10% deveria continuar verde",
    })
    .toBe("verde");
  await injectUtilities(page, { water: { used: 90, capacity: 100 }, power: { used: 10, capacity: 100 } });
  await expect
    .poll(() => waterColorClass(page), {
      message: "água em 90% deveria ficar amarela",
    })
    .toBe("amarela");
  await injectUtilities(page, { water: { used: 90, capacity: 100 }, power: { used: 10, capacity: 100 } });
  await expect
    .poll(() => waterColorClass(page), {
      message: "repetir 90% deveria continuar amarela",
    })
    .toBe("amarela");
  await injectUtilities(page, { water: { used: 99, capacity: 100 }, power: { used: 10, capacity: 100 } });
  await expect
    .poll(() => waterColorClass(page), {
      message: "água em 99% deveria ficar vermelha",
    })
    .toBe("vermelha");
  await injectUtilities(page, { water: { used: 99, capacity: 100 }, power: { used: 10, capacity: 100 } });
  await expect
    .poll(() => waterColorClass(page), {
      message: "repetir 99% deveria continuar vermelha",
    })
    .toBe("vermelha");
});

test("dica em português", async ({ page }) => {
  await openGame(page, "topbar");
  await closePanel(page);
  const topbar = page.locator(".topbar");
  const bars = topbar.locator(".dbar");
  await expect(bars, "deveria existir 3 barras de demanda na barra principal").toHaveCount(3);
  const total = await bars.count();
  expect(total, "deveria existir 3 barras de demanda para conferir a dica").toBe(3);
  for (let i = 0; i < total; i += 1) {
    const title = await demandBarTitle(bars.nth(i));
    expect(!!title, `dica da barra de demanda ${i} deveria existir`).toBe(true);
    expect(
      (title ?? "").length > 10,
      `dica da barra de demanda ${i} deveria explicar com mais de 10 letras`,
    ).toBe(true);
    expect(
      ["Residencial", "Comercial", "Industrial"].includes((title ?? "").trim()),
      `dica da barra de demanda ${i} não deveria repetir o rótulo`,
    ).toBe(false);
  }
  for (const [name, locator] of [
    ["Água", waterValue(page)],
    ["Luz", powerValue(page)],
  ] as const) {
    const title = await statTitle(page, locator, name);
    expect(!!title, `dica de ${name} deveria existir`).toBe(true);
    expect((title ?? "").length > 10, `dica de ${name} deveria explicar com mais de 10 letras`).toBe(true);
    expect((title ?? "").trim() !== name, `dica de ${name} não deveria repetir o rótulo`).toBe(true);
  }
});

test("utilidades desligadas", async ({ page }) => {
  await openGame(page, "topbar");
  await closePanel(page);
  const before = await page.evaluate(() => window.__city.store.get().stats.utilities);
  await injectUtilities(page, {
    water: { used: before.water.used as number, capacity: null },
    power: { used: before.power.used as number, capacity: null },
  });
  await expect
    .poll(async () => waterValue(page).textContent(), {
      message: "água sem capacidade deveria mostrar traço no lugar do total",
    })
    .toContain("—");
  await expect
    .poll(async () => powerValue(page).textContent(), {
      message: "luz sem capacidade deveria mostrar traço no lugar do total",
    })
    .toContain("—");
  await expect
    .poll(async () => utilityTitleLower(page, "Água"), {
      message: "dica da água deveria falar de sem limite",
    })
    .toContain("sem limite");
  await expect
    .poll(async () => utilityTitleLower(page, "Luz"), {
      message: "dica da luz deveria falar de sem limite",
    })
    .toContain("sem limite");
});

function blockedWarning(page: import("@playwright/test").Page) {
  return page.locator(".topbar .blocked");
}

async function runGame(page: import("@playwright/test").Page) {
  await page.locator('.topbar .speeds button[title="Velocidade 1x (1 dia = 2 min)"]').click();
}

async function pauseGame(page: import("@playwright/test").Page) {
  await page.locator('.topbar .speeds button[title="Pausar"]').click();
}

async function injectBlocked(
  page: import("@playwright/test").Page,
  blockedByWater: number,
  blockedByPower: number,
) {
  await lockStats(page, {
    stats: { construction: { blockedByWater, blockedByPower } },
  });
}

test("shows blocked-construction warning when water network is full", async ({ page }) => {
  await openGame(page, "topbar");
  await closePanel(page);
  await runGame(page);
  await injectBlocked(page, 3, 0);
  await expect(
    blockedWarning(page),
    "aviso de obras paradas deveria aparecer com a rede de água estourada",
  ).toBeVisible();
});

test("blocked warning names the missing utility", async ({ page }) => {
  await openGame(page, "topbar");
  await closePanel(page);
  await runGame(page);
  await injectBlocked(page, 2, 0);
  await expect(
    blockedWarning(page),
    "aviso de obras paradas por falta de água deveria aparecer",
  ).toBeVisible();
  await expect(blockedWarning(page), "aviso deveria mencionar água quando blockedByWater > 0").toContainText(
    "água",
    { ignoreCase: true },
  );
  await injectBlocked(page, 0, 4);
  await expect(
    blockedWarning(page),
    "aviso de obras paradas por falta de luz deveria aparecer",
  ).toBeVisible();
  await expect(blockedWarning(page), "aviso deveria mencionar luz quando blockedByPower > 0").toContainText(
    "luz",
    { ignoreCase: true },
  );
  await injectBlocked(page, 1, 2);
  await expect(blockedWarning(page), "aviso deveria continuar visível com água e luz faltando").toBeVisible();
  await expect(blockedWarning(page), "aviso deveria mencionar água quando os dois faltam").toContainText(
    "água",
    { ignoreCase: true },
  );
  await expect(blockedWarning(page), "aviso deveria mencionar luz quando os dois faltam").toContainText(
    "luz",
    { ignoreCase: true },
  );
});

test("hides blocked-construction warning when network has room", async ({ page }) => {
  await openGame(page, "topbar");
  await closePanel(page);
  await runGame(page);
  await injectBlocked(page, 0, 0);
  await expect(
    blockedWarning(page),
    "aviso de obras paradas não deveria aparecer com a rede folgada",
  ).toHaveCount(0);
});

test("pausing hides the blocked warning and resuming shows it again", async ({ page }) => {
  await openGame(page, "topbar");
  await closePanel(page);
  await runGame(page);
  await injectBlocked(page, 3, 0);
  await expect(blockedWarning(page), "aviso deveria estar visível antes de pausar").toBeVisible();
  await pauseGame(page);
  await expect(blockedWarning(page), "aviso deveria sumir com o jogo pausado").toHaveCount(0);
  await runGame(page);
  await expect(
    blockedWarning(page),
    "aviso deveria voltar ao rodar com a rede ainda estourada",
  ).toBeVisible();
});
