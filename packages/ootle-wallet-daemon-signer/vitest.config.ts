//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { defineConfig } from "vitest/config";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// Importing `WalletDaemonSigner` pulls `@tari-project/ootle-wasm` transitively.
// Inline that package and load the `.wasm` through Vite's transform pipeline;
// without this Node throws `Unknown file extension ".wasm"`.
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
