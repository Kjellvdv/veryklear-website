import { defineConfig } from "vitest/config";

// Tests cover server/ only. Astro's own Vite is a separate dependency tree.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
