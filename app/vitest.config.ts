import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    // Keep the test environment fast — no DOM presets needed for lib tests
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
