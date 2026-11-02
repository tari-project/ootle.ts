import dts from "unplugin-dts/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

/** @type {import('vite').UserConfig} */
export default {
  plugins: [
    dts({
      outDirs: "dist",
      entryRoot: "src",
      bundleTypes: true,
    }),
    wasm(),
    topLevelAwait(),
  ],
  build: {
    lib: {
      name: "@tari-project/ootle",
      entry: "src/index.ts",
      fileName: "index",
      formats: ["es"],
    },
    rolldownOptions: {
      external: ["@tari-project/ootle-ts-bindings", "@tari-project/ootle-wasm", "@tari-project/ootle-wasm-bor"],
      output: {
        globals: {
          "@tari-project/ootle-ts-bindings": "ootle-ts-bindings",
          "@tari-project/ootle-wasm": "ootle-wasm",
          "@tari-project/ootle-wasm-bor": "ootle-wasm-bor",
        },
      },
    },
  },
};
