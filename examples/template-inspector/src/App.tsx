import type { TemplateMetadata } from "@tari-project/ootle-indexer";
import { useState } from "react";
import { useTemplates } from "./hooks/useTemplates";
import "./App.css";

export function App() {
  const {
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
  } = useTemplates();

  const [search, setSearch] = useState("");

  const filtered = templates.filter((t) => {
    const q = search.toLowerCase();
    return t.address.toLowerCase().includes(q) || (t.name ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="layout">
      {/* ── Topbar ── */}
      <header className="topbar">
        <div className="topbar-left">
          <TariLogo size={28} />
          <span className="topbar-title">Template Inspector</span>
          <div
            className={`status-badge ${loadStatus === "ready" ? "connected" : loadStatus === "error" ? "errored" : ""}`}
          >
            <span className="dot" />
            {loadStatus === "loading" && "Connecting…"}
            {loadStatus === "ready" && `${templates.length} templates · Esmeralda testnet`}
            {loadStatus === "error" && "Connection error"}
            {loadStatus === "idle" && "Idle"}
          </div>
        </div>

        <div className="topbar-right">
          <input
            className="url-input"
            type="url"
            value={indexerUrl}
            onChange={(e) => setIndexerUrl(e.target.value)}
            onBlur={() => void reload()}
            onKeyDown={(e) => e.key === "Enter" && void reload()}
            title="Indexer URL — press Enter to reconnect"
            spellCheck={false}
          />
          <button className="btn-ghost small" onClick={() => void reload()} disabled={loadStatus === "loading"}>
            {loadStatus === "loading" ? <Spinner /> : "Refresh"}
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="body">
        {/* ── Left: template list ── */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2 className="panel-title">Templates</h2>
            <input
              className="search-input"
              type="search"
              placeholder="Filter…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loadError && (
            <div className="error-banner" role="alert">
              {loadError}
            </div>
          )}

          {loadStatus === "loading" && templates.length === 0 && (
            <div className="loading-state">
              <Spinner dark /> Loading templates…
            </div>
          )}

          {loadStatus === "ready" && filtered.length === 0 && (
            <p className="empty-state">{search ? "No templates match your filter." : "No templates found."}</p>
          )}

          <div className="template-list">
            {filtered.map((t) => (
              <TemplateRow
                key={t.address}
                template={t}
                selected={selectedAddress === t.address}
                onSelect={() => void selectTemplate(t.address)}
              />
            ))}
          </div>
        </aside>

        {/* ── Right: definition viewer ── */}
        <main className="detail">
          {!selectedAddress && (
            <div className="empty-detail">
              <TariLogo size={48} />
              <p>Select a template to inspect its ABI</p>
            </div>
          )}

          {selectedAddress && (
            <>
              <div className="detail-header">
                <h2 className="panel-title">ABI</h2>
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

              {definition && !definitionLoading && <DefinitionView definition={definition} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TemplateRow({
  template,
  selected,
  onSelect,
}: {
  template: TemplateMetadata;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`template-row ${selected ? "selected" : ""}`} onClick={onSelect}>
      <span className="template-name">{template.name ?? "Unnamed"}</span>
      <span className="template-addr mono" title={template.address}>
        {truncate(template.address, 8, 6)}
      </span>
    </button>
  );
}

/**
 * Renders the template definition. The exact shape of GetTemplateDefinitionResponse
 * is determined by the on-chain data. We try to render known fields (functions list)
 * nicely, and fall back to a formatted JSON dump.
 */
function DefinitionView({ definition }: { definition: unknown }) {
  // Try to extract a functions array from known response shapes
  const functions = extractFunctions(definition);

  if (functions.length > 0) {
    return (
      <div className="abi-view">
        {functions.map((fn, i) => (
          <FunctionCard key={i} fn={fn} />
        ))}
      </div>
    );
  }

  // Fallback: raw JSON
  return <pre className="json-view">{JSON.stringify(definition, null, 2)}</pre>;
}

interface AbiFunction {
  name: string;
  arguments?: AbiArg[];
  output?: unknown;
  is_constructor?: boolean;
}

interface AbiArg {
  name?: string;
  arg_type?: unknown;
}

function FunctionCard({ fn }: { fn: AbiFunction }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`fn-card ${fn.is_constructor ? "constructor" : ""}`}>
      <button className="fn-header" onClick={() => setExpanded((x) => !x)}>
        <div className="fn-sig">
          {fn.is_constructor && <span className="fn-badge constructor">new</span>}
          <span className="fn-name mono">{fn.name}</span>
          <span className="fn-args-preview">({(fn.arguments ?? []).map((a) => a.name ?? "_").join(", ")})</span>
        </div>
        <ChevronIcon expanded={expanded} />
      </button>

      {expanded && (
        <div className="fn-body">
          {fn.arguments && fn.arguments.length > 0 && (
            <div className="fn-section">
              <p className="fn-section-label">Arguments</p>
              <div className="arg-list">
                {fn.arguments.map((arg, i) => (
                  <div key={i} className="arg-row">
                    <span className="arg-name mono">{arg.name ?? `arg${i}`}</span>
                    <span className="arg-type mono">{typeToString(arg.arg_type)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fn.output !== undefined && fn.output !== null && (
            <div className="fn-section">
              <p className="fn-section-label">Returns</p>
              <span className="arg-type mono">{typeToString(fn.output)}</span>
            </div>
          )}

          {(!fn.arguments || fn.arguments.length === 0) && (fn.output === undefined || fn.output === null) && (
            <p className="fn-empty">No arguments · no return value</p>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner({ dark = false }: { dark?: boolean }) {
  return <span className={dark ? "spinner dark" : "spinner"} aria-hidden />;
}

function TariLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#9d4edd" opacity="0.15" />
      <circle cx="20" cy="20" r="12" fill="#9d4edd" opacity="0.3" />
      <circle cx="20" cy="20" r="5" fill="#9d4edd" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(str: string, head = 10, tail = 8): string {
  if (str.length <= head + tail + 3) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

function extractFunctions(def: unknown): AbiFunction[] {
  if (typeof def !== "object" || def === null) return [];
  const d = def as Record<string, unknown>;

  // Common shapes: { template_definition: { functions: [...] } } or { functions: [...] }
  const inner = (d.template_definition as Record<string, unknown> | undefined) ?? d;
  const fns = inner.functions;
  if (Array.isArray(fns)) return fns as AbiFunction[];
  return [];
}

function typeToString(t: unknown): string {
  if (t === null || t === undefined) return "()";
  if (typeof t === "string") return t;
  if (typeof t === "object") {
    const o = t as Record<string, unknown>;
    // Handle common Tari type shapes like { Other: { name: "Foo" } }, { I64: {} }, etc.
    const key = Object.keys(o)[0];
    if (!key) return "{}";
    const val = o[key];
    if (val && typeof val === "object") {
      const inner = val as Record<string, unknown>;
      return typeToString(inner);
    }
    return key;
  }
  return Object.values(t).map(toString).join(",");
}
