import { defineConfig } from "vitest/config";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// Stealth signing tests exercise real WASM (`stealthDhSecret`, `schnorrSign`,
// `hashUnsignedTransaction`). Inline `@tari-project/ootle-wasm` and load the
// `.wasm` through Vite's transform pipeline; without this Node's native ESM
// loader throws `Unknown file extension ".wasm"`.
export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    server: {
      deps: {
        inline: ["@tari-project/ootle-wasm"],
      },
    },
  },
});
