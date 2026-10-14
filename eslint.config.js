import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// Lints the server and its tests. Astro files would need their own plugin; the
// build type-checks them.
export default defineConfig([
  { ignores: ["node_modules", "dist", ".astro", "public", "src", "forms", ".claude", "tests/fixtures"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Express recognises an error handler by its four parameters, so `_next` must stay.
    rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
]);
