import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Testes lentos (tests/slow) só rodam com SLOW=1 (npm run test:slow) e no CI.
    include: process.env.SLOW
      ? ["tests/slow/**/*.test.ts"]
      : [
          "packages/*/src/**/*.test.ts",
          "packages/*/test/**/*.test.ts",
          "tests/unit/**/*.test.ts",
          "tests/acceptance/**/*.test.ts",
        ],
    testTimeout: 60_000,
    reporters: ["default"],
  },
});
