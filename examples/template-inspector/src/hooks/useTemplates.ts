import { useCallback, useEffect, useState } from "react";
import type { TemplateMetadata } from "@tari-project/ootle-indexer";
import { IndexerClient } from "@tari-project/ootle-indexer";
import { defaultIndexerUrl, Network } from "@tari-project/ootle";

const ESME_INDEXER = defaultIndexerUrl(Network.Esmeralda);

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export interface UseTemplates {
  indexerUrl: string;
  setIndexerUrl: (url: string) => void;
  loadStatus: LoadStatus;
  templates: TemplateMetadata[];
  loadError: string | null;
  reload: () => Promise<void>;

  selectedAddress: string | null;
  selectTemplate: (address: string) => Promise<void>;
  definition: unknown;
  definitionLoading: boolean;
  definitionError: string | null;
}

/**
 * Loads the list of templates cached by the indexer and fetches individual
 * template definitions (ABIs) on demand.
 *
 * Uses `IndexerClient` directly rather than `IndexerProvider` because the
 * Provider interface doesn't expose the template list endpoint.
 */
export function useTemplates(): UseTemplates {
  const [indexerUrl, setIndexerUrl] = useState(ESME_INDEXER);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [templates, setTemplates] = useState<TemplateMetadata[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [definition, setDefinition] = useState<unknown>(null);
  const [definitionLoading, setDefinitionLoading] = useState(false);
  const [definitionError, setDefinitionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoadStatus("loading");
    setLoadError(null);
    try {
      const client = IndexerClient.usingFetchTransport(indexerUrl);
      await client.identityGet();
      const raw = await client
        .getTransport()
        .sendGet<{ templates?: TemplateMetadata[] }>("templates/cached", { limit: "50" });

      setTemplates(raw.templates ?? []);
      setLoadStatus("ready");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load templates");
      setLoadStatus("error");
    }
  }, [indexerUrl]);

  // Auto-load on mount and when the URL changes
  useEffect(() => {
    void reload();
  }, [reload]);

  const selectTemplate = useCallback(
    async (address: string) => {
      setSelectedAddress(address);
      setDefinition(null);
      setDefinitionError(null);
      setDefinitionLoading(true);
      try {
        const client = IndexerClient.usingFetchTransport(indexerUrl);
        const def = await client.templatesGet(address);
        setDefinition(def);
      } catch (err) {
        setDefinitionError(err instanceof Error ? err.message : "Failed to fetch template definition");
      } finally {
        setDefinitionLoading(false);
      }
    },
    [indexerUrl],
  );

  return {
    indexerUrl,
    setIndexerUrl,
    loadStatus,
    templates,
    loadError,
    reload,
    selectedAddress,
    selectTemplate,
    definition,
    definitionLoading,
    definitionError,
  };
}
