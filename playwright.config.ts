import { defineConfig } from "@playwright/test";

// Navegador: usa o Chromium do sistema se CHROMIUM_PATH estiver definido (ambiente sem download).
const executablePath = process.env.CHROMIUM_PATH;
const factoryOnly = process.env.E2E_FACTORY_ONLY === "1";
const excludeFactory = process.env.E2E_EXCLUDE_FACTORY === "1";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: factoryOnly ? /factory-browser\.spec\.ts/ : undefined,
  testIgnore: excludeFactory ? /factory-browser\.spec\.ts/ : undefined,
  timeout: 180_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command:
      "npm run build && npx vite preview --config packages/web/vite.config.ts --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    timeout: 240_000,
    reuseExistingServer: true,
  },
});
