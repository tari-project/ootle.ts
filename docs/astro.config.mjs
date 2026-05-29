import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";

export default defineConfig({
  site: "https://tari-project.github.io",
  base: "/ootle.ts",
  integrations: [
    starlight({
      title: "ootle.ts",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/tari-project/ootle.ts" },
        { icon: "discord", label: "Discord", href: "https://discord.gg/tari" },
        { icon: "x.com", label: "X", href: "https://x.com/tari" },
      ],
      editLink: {
        baseUrl: "https://github.com/tari-project/ootle.ts/edit/main/docs/",
      },
      plugins: [
        starlightTypeDoc({
          entryPoints: [
            "../packages/ootle/src/index.ts",
            "../packages/ootle-indexer/src/index.ts",
            "../packages/ootle-secret-key-wallet/src/index.ts",
            "../packages/ootle-wallet-daemon-signer/src/index.ts",
          ],
          tsconfig: "../tsconfig.typedoc.json",
          output: "api",
          sidebar: {
            label: "API Reference",
            collapsed: true,
          },
          typeDoc: {
            excludePrivate: true,
            excludeInternal: true,
            excludeExternals: true,
          },
        }),
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { slug: "getting-started/installation" },
            { slug: "getting-started/prerequisites" },
            { slug: "getting-started/provider-and-signer" },
            { slug: "getting-started/quick-start-browser" },
            { slug: "getting-started/quick-start-node" },
          ],
        },
        {
          label: "Providers",
          items: [{ slug: "providers/indexer-provider" }],
        },
        {
          label: "Signers",
          items: [{ slug: "signers/wallet-daemon" }, { slug: "signers/secret-key-wallet" }],
        },
        {
          label: "Transactions",
          items: [
            { slug: "transactions/overview" },
            { slug: "transactions/transaction-builder" },
            { slug: "transactions/call-function" },
            { slug: "transactions/call-method" },
            { slug: "transactions/fees" },
            { slug: "transactions/inputs" },
            { slug: "transactions/save-var" },
            { slug: "transactions/epoch-bounds" },
          ],
        },
        {
          label: "Stealth",
          items: [
            { slug: "stealth/overview" },
            { slug: "stealth/receiving" },
            { slug: "stealth/sending" },
            { slug: "stealth/spending" },
          ],
        },
        {
          label: "Chain State",
          items: [{ slug: "chain-state/substates" }, { slug: "chain-state/templates" }],
        },
        {
          label: "Advanced",
          items: [{ slug: "advanced/multi-signer" }, { slug: "advanced/builtin-templates" }],
        },
        typeDocSidebarGroup,
      ],
    }),
  ],
});
