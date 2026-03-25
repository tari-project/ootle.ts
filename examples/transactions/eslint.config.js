// @ts-check

import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import sharedConfig from "../../eslint.config.mjs";

export default defineConfig([
  reactHooks.configs.flat.recommended,
  sharedConfig,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
  },
]);
