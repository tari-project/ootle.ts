import "./App.css";
import { DefinitionView, DotLogo, Spinner, TemplateRow, truncate } from "./components.tsx";
import type { FunctionDef } from "@tari-project/ootle-indexer";
import { useConnect } from "./hooks/useConnect.ts";
import { useEffect, useRef, useState } from "react";
import { useTemplates } from "./hooks/useTemplates.ts";
import { Transact } from "./Transact.tsx";

export function App() {
  const connectionAttempted = useRef(false);
  const [selectedFn, setSelectedFn] = useState<FunctionDef | null>(null);
  const { status, provider, handleConnect } = useConnect();
  const { templateList, selectTemplate, selectedAddress, definition, definitionLoading, definitionError } =
    useTemplates({ provider });

  useEffect(() => {
    if (status !== "disconnected" || connectionAttempted.current) return;
    handleConnect().finally(() => (connectionAttempted.current = true));
  }, [handleConnect, status]);

  function onTemplateSelect(address: string) {
    setSelectedFn(null);
    void selectTemplate(address);
  }

  const sidebarMarkup = (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2 className="panel-title">Templates</h2>
      </div>
      {templateList.length === 0 && <p className="empty-state">{"No templates found."}</p>}
      <div className="template-list">
        {templateList.map((t) => (
          <TemplateRow
            key={t.address}
            template={t}
            selected={selectedAddress === t.address}
            onSelect={() => onTemplateSelect(t.address)}
          />
        ))}
      </div>
    </aside>
  );

  const templateDetailsMarkup = (
    <main className="detail smaller">
      {!selectedAddress && (
        <div className="detail" style={{ alignItems: "center" }}>
          <DotLogo size={48} />
          <p>
            After getting the signer pubkey/address, select a template to inspect its ABI and interact with its
            functions
          </p>
        </div>
      )}

      {selectedAddress && (
        <>
          <div className="detail-header">
            <h2 className="panel-title">
              Template: <b>{definition?.V1.template_name}</b>
            </h2>
            <span className="mono address-chip" title={selectedAddress}>
              {truncate(selectedAddress, 14, 10)}
            </span>
          </div>

          {definitionLoading && (
            <div className="loading-state">
              <Spinner dark /> Fetching definition…
            </div>
          )}

          {definitionError && (
            <div className="error-banner" role="alert">
              {definitionError}
            </div>
          )}

          {definition && !definitionLoading && <DefinitionView definition={definition} onSelected={setSelectedFn} />}
        </>
      )}
    </main>
  );

  const transactMarkup = (
    <main className="detail">
      <div className="detail-header">
        <h2 className="panel-title">Transact</h2>
      </div>
      <Transact
        provider={provider}
        key={selectedAddress}
        selectedFunction={selectedFn}
        def={definition}
        templateAddress={selectedAddress}
      />
    </main>
  );

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-left">
          <DotLogo size={28} />
          <span className="topbar-title">Transaction Example</span>
        </div>

        <div className="topbar-right">
          <span>{status}</span>
        </div>
      </header>
      <div className="body">
        {sidebarMarkup}
        {templateDetailsMarkup}
        {transactMarkup}
      </div>
    </div>
  );
}
