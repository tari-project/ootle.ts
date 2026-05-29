import { defineConfig } from "vitest/config";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// Tests stub `IndexerClient` and exercise no WASM directly, but importing
// `@tari-project/ootle` transitively pulls `@tari-project/ootle-wasm`. Inline
// that package and load the `.wasm` through Vite's transform pipeline;
// without this Node's native ESM loader throws `Unknown file extension ".wasm"`.
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
