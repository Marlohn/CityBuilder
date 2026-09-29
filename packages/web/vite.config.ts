import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root,
  // Caminhos relativos para funcionar no GitHub Pages (https://<user>.github.io/CityBuilder/).
  base: "./",
  plugins: [react()],
  server: { fs: { allow: [repoRoot] }, port: 5173 },
  worker: { format: "es" },
  build: {
    outDir: fileURLToPath(new URL("../../dist", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
  },
});
