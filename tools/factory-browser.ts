/** Navegador persistente do ciclo de produto. Só oferece ações públicas, nunca evaluate do agente. */
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";
import { z } from "zod";

const coordinate = z.number().int().min(0).max(2000);
const actionsSchema = z
  .array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("click"),
        role: z.enum(["button", "tab", "link", "checkbox"]),
        name: z.string().min(1).max(200),
      }),
      z.object({ type: z.literal("point"), x: coordinate, y: coordinate }),
      z.object({
        type: z.literal("drag"),
        x: coordinate,
        y: coordinate,
        toX: coordinate,
        toY: coordinate,
        button: z.enum(["left", "right", "middle"]).default("left"),
      }),
      z.object({
        type: z.literal("key"),
        key: z.string().min(1).max(30),
        ms: z.number().int().min(0).max(3000).default(0),
      }),
      z.object({
        type: z.literal("wheel"),
        x: coordinate,
        y: coordinate,
        deltaY: z.number().int().min(-2000).max(2000),
      }),
      z.object({ type: z.literal("wait"), ms: z.number().int().min(0).max(3000) }),
      z.object({ type: z.literal("reset") }),
    ]),
  )
  .max(12);

export async function createBrowserBridge(page: Page, directory: string, url: string) {
  const output = resolve(directory);
  await mkdir(output, { recursive: true });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const reset = async () => {
    await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
    await page.locator("canvas").waitFor({ state: "visible" });
    await page.waitForTimeout(1500);
  };
  await reset();
  let sequence = 0;
  const observe = async (input: unknown) => {
    const actions = actionsSchema.parse(input);
    const errors: string[] = [];
    for (const action of actions) {
      try {
        switch (action.type) {
          case "click":
            await page.getByRole(action.role, { name: action.name, exact: true }).click({ timeout: 3000 });
            break;
          case "point":
            await page.mouse.click(action.x, action.y);
            break;
          case "drag":
            await page.mouse.move(action.x, action.y);
            await page.mouse.down({ button: action.button });
            try {
              await page.mouse.move(action.toX, action.toY, { steps: 12 });
            } finally {
              await page.mouse.up({ button: action.button });
            }
            break;
          case "key":
            if (action.ms === 0) await page.keyboard.press(action.key);
            else {
              await page.keyboard.down(action.key);
              try {
                await page.waitForTimeout(action.ms);
              } finally {
                await page.keyboard.up(action.key);
              }
            }
            break;
          case "wheel":
            await page.mouse.move(action.x, action.y);
            await page.mouse.wheel(0, action.deltaY);
            break;
          case "wait":
            await page.waitForTimeout(action.ms);
            break;
          case "reset":
            await reset();
            break;
        }
      } catch (error) {
        errors.push(String(error).slice(0, 600));
      }
    }
    await page.waitForTimeout(200);
    const id = String(++sequence).padStart(4, "0");
    const screenshot = resolve(output, id + ".png");
    const png = await page.screenshot({ path: screenshot, timeout: 120_000 });
    const publicState = await page.evaluate(() => ({
      text: document.body.innerText.slice(0, 18000),
      controls: Array.from(document.querySelectorAll("button,[role=tab],a,input,select")).flatMap(
        (element) => {
          const bounds = element.getBoundingClientRect();
          if (bounds.width === 0 || bounds.height === 0) return [];
          return [
            {
              role:
                element.getAttribute("role") ??
                (element.tagName === "A" ? "link" : element.tagName.toLowerCase()),
              name: (
                element.getAttribute("aria-label") ??
                (element as HTMLElement).innerText ??
                element.textContent ??
                ""
              )
                .replace(/\s+/g, " ")
                .trim(),
              title: element.getAttribute("title"),
              disabled: element.hasAttribute("disabled"),
              x: Math.round(bounds.x + bounds.width / 2),
              y: Math.round(bounds.y + bounds.height / 2),
            },
          ];
        },
      ),
    }));
    const observation = {
      id,
      at: new Date().toISOString(),
      url: page.url(),
      screenshot,
      sha256: createHash("sha256").update(png).digest("hex"),
      viewport: page.viewportSize(),
      ...publicState,
      actions,
      errors,
      browserErrors: [...browserErrors],
    };
    await writeFile(resolve(output, id + ".json"), JSON.stringify(observation, null, 2));
    await appendFile(resolve(output, "actions.jsonl"), JSON.stringify(observation) + "\n");
    return observation;
  };
  return { observe, close: () => page.close() };
}

async function main() {
  const mode = process.argv[2];
  const side = process.argv[4] ?? "baseline";
  if (mode === "act" && !["baseline", "candidate"].includes(side)) throw new Error("Versão inválida.");
  const directory = resolve(
    process.env.FACTORY_BROWSER_DIR ?? "out/factory/browser",
    mode === "act" ? side : ".",
  );
  const addressFile = resolve(directory, "address.json");
  if (mode === "act") {
    const address = JSON.parse(await readFile(addressFile, "utf8")) as { url: string; token: string };
    const response = await fetch(address.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: address.token },
      body: process.argv[3] ?? "[]",
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.text();
    process.stdout.write(body + "\n");
    if (!response.ok) process.exitCode = 1;
    return;
  }
  if (mode !== "serve") throw new Error("Use serve [URL] ou act '[ações JSON]'.");
  const url = process.argv[3] ?? "http://127.0.0.1:4173/?seed=factory";
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const bridge = await createBrowserBridge(page, directory, url);
  const token = randomUUID();
  let tail: Promise<unknown> = Promise.resolve();
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.headers.authorization !== token) {
      response.writeHead(403).end();
      return;
    }
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
      if (body.length > 32_000) request.destroy();
    });
    request.on("end", () => {
      tail = tail.then(async () => {
        try {
          const result = await bridge.observe(JSON.parse(body));
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
        } catch (error) {
          response.writeHead(400).end(JSON.stringify({ error: String(error) }));
        }
      });
    });
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Endereço do navegador ausente.");
  const initial = await bridge.observe([]);
  await writeFile(addressFile, JSON.stringify({ url: `http://127.0.0.1:${address.port}`, token }), {
    mode: 0o600,
  });
  process.stdout.write(JSON.stringify(initial) + "\n");
  const close = async () => {
    server.close();
    await browser.close();
    process.exit(0);
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(String(error) + "\n");
    process.exit(1);
  });
}
