import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "tests/unit/**/*.test.ts"],
    testTimeout: 60_000,
    reporters: ["default"],
  },
});
