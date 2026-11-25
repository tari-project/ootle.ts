// @ts-check

import { defineConfig } from "eslint/config";
import sharedConfig from "../../eslint.config.mjs";

export default defineConfig([
  sharedConfig,
  {
    files: ["**/*.{js,ts}"],
  },
]);
