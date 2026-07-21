import { resolve } from "node:path";
import { defineConfig } from "vite";

// MV3 build: content script and service worker are separate entry points, each emitted
// as a single self-contained file (no code-splitting — extensions can't load chunks freely).
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        content: resolve(__dirname, "src/content/index.ts"),
        background: resolve(__dirname, "src/background/index.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
        format: "es",
        inlineDynamicImports: false,
      },
    },
  },
});
