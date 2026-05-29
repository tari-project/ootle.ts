import { IndexerProvider } from "@tari-project/ootle-indexer";
import { NETWORK, indexerUrl } from "./_common/index.js";

const provider = await IndexerProvider.connect({ url: indexerUrl(), network: NETWORK });
const templateId = process.env.T;
if (!templateId) {
  throw new Error("Set the T environment variable to a template address");
}
const def = await provider.getTemplateDefinition(templateId);
console.log(JSON.stringify(def, null, 2));
