import { defineConfig } from "@playwright/test";

// Navegador: usa o Chromium do sistema se CHROMIUM_PATH estiver definido (ambiente sem download).
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: "tests/e2e",
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
      "npm run build && npx vite preview --config packages/web/vite.config.ts --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    timeout: 240_000,
    reuseExistingServer: true,
  },
});
