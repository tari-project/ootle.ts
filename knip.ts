import type { KnipConfig } from "knip";

const config: KnipConfig = {
  rules: {
    files: "error",
    dependencies: "error",
    unlisted: "error",
    // Public-API barrels re-export types from sibling packages that don't
    // themselves consume them — promoting to `error` would force suppression
    // on every re-export.
    exports: "warn",
    types: "warn",
    duplicates: "error",
  },
  // pnpm scripts that knip's binary scanner misreads as missing CLIs.
  ignoreBinaries: ["commitlint", "info", "build"],
  // Invoked via `pnpm exec` and editor integrations, never imported.
  ignoreDependencies: ["prettier"],
  ignoreExportsUsedInFile: true,
  workspaces: {
    // Reusable test fixtures pre-staged for future tests — flagged as unused today.
    "packages/ootle": { ignore: ["src/test/**"] },
    "packages/ootle-indexer": {},
    "packages/ootle-secret-key-wallet": {},
    "packages/ootle-wallet-daemon-signer": {},
    "examples/_common": {},
    "examples/connect-button": {},
    "examples/indexer-explorer": {},
    "examples/stealth-wallet": {},
    "examples/template-inspector": {},
    "examples/node": {
      // Every src/ file is a CLI entry invoked by a pnpm script.
      entry: ["src/**/*.ts"],
    },
    docs: {
      // Loaded by Astro at build via image.service config, never imported.
      ignoreDependencies: ["sharp"],
    },
  },
};

export default config;
