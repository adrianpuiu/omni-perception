import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  // Don't use banner for shebang in ESM — it causes SyntaxError.
  // Instead, the user runs with: node dist/index.js
  // Or adds a bin wrapper script.
});
