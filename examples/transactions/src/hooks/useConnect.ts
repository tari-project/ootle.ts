import { useCallback, useState } from "react";
import { IndexerProvider, ProviderBuilder } from "@tari-project/ootle-indexer";
import { defaultIndexerUrl, Network } from "@tari-project/ootle";

type ConnectionStatus = "disconnected" | "connecting" | "connected";
const indexerUrl = defaultIndexerUrl(Network.Esmeralda);

export function useConnect() {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [provider, setProvider] = useState<IndexerProvider | null>(null);

  const handleConnect = useCallback(async () => {
    setStatus("connecting");

    try {
      const p = await ProviderBuilder.new().withNetwork(Network.Esmeralda).withUrl(indexerUrl).connect();
      if (p) {
        setProvider(p);
        setStatus("connected");
      }
    } catch (e) {
      setStatus("disconnected");
      console.error(e);
    }
  }, []);

  return { status, handleConnect, provider };
}
