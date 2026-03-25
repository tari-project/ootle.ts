import { IndexerProvider } from "@tari-project/ootle-indexer";
import type { TemplateMetadata, TemplateDef } from "@tari-project/ootle-indexer";
import { useCallback, useEffect, useRef, useState } from "react";

export function useTemplates({ provider }: { provider: IndexerProvider | null }) {
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [definition, setDefinition] = useState<TemplateDef | null>(null);
  const [definitionLoading, setDefinitionLoading] = useState(false);
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [templateList, setTemplateList] = useState<TemplateMetadata[]>([]);

  const hasFetched = useRef(false);

  const fetchTemplates = useCallback(async () => {
    const client = provider?.getClient();

    if (client) {
      try {
        const res = await client
          .getTransport()
          .sendGet<{ templates?: TemplateMetadata[] }>("templates/cached", { limit: 50 });

        if (res?.templates) {
          setTemplateList(res.templates);
        }
      } catch (e) {
        console.error(e);
      }
    }
  }, [provider]);

  const selectTemplate = useCallback(
    async (address: string) => {
      setSelectedAddress(address);
      setDefinition(null);
      setDefinitionError(null);
      setDefinitionLoading(true);
      try {
        const client = provider?.getClient();
        const def = (await client?.templatesGet(address)) as unknown as { definition: TemplateDef };

        setDefinition(def?.definition ?? null);
      } catch (err) {
        setDefinitionError(err instanceof Error ? err.message : "Failed to fetch template definition");
      } finally {
        setDefinitionLoading(false);
      }
    },
    [provider],
  );

  useEffect(() => {
    if (hasFetched.current && templateList?.length > 0) return;
    fetchTemplates().then(() => {
      hasFetched.current = true;
    });
  }, [fetchTemplates, templateList?.length]);

  return {
    templateList,
    fetchTemplates,
    selectTemplate,
    selectedAddress,
    definition,
    definitionLoading,
    definitionError,
  };
}
