import { defineConfig } from "vitest/config";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// Tests use real WASM crypto. The plugins compile/instantiate the `.wasm`,
// and `inline` keeps Vitest from externalising the WASM package — Node's
// native ESM loader can't handle `.wasm` imports.
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
