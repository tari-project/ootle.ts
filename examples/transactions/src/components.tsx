import "./App.css";
import type { TemplateMetadata, TemplateDef, FunctionDef } from "@tari-project/ootle-indexer";
import { useEffect, useState } from "react";

function DotLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#9d4edd" opacity="0.15" />
      <circle cx="20" cy="20" r="12" fill="#9d4edd" opacity="0.3" />
      <circle cx="20" cy="20" r="5" fill="#9d4edd" />
    </svg>
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

interface DefinitionViewProps {
  definition: TemplateDef;
  onSelected: (fnDef: FunctionDef) => void;
}
/**
 * Renders the template definition. The exact shape of GetTemplateDefinitionResponse
 * is determined by the on-chain data. We try to render known fields (functions list)
 * nicely, and fall back to a formatted JSON dump.
 */
function DefinitionView({ definition, onSelected }: DefinitionViewProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | undefined>(undefined);
  function handleSelected(fnDef: FunctionDef, idx: number) {
    setSelectedIdx(idx);
    onSelected(fnDef);
  }
  // Try to extract a functions array from known response shapes
  const functions = extractFunctions(definition);
  if (functions.length > 0) {
    return (
      <div className="abi-view">
        {functions.map((fn, i) => (
          <FunctionCard
            key={i}
            fn={fn}
            fnIndex={i}
            selectedIdx={selectedIdx}
            onSelected={(fnDef) => handleSelected(fnDef, i)}
          />
        ))}
      </div>
    );
  }

  // Fallback: raw JSON
  return <pre className="json-view">{JSON.stringify(definition, null, 2)}</pre>;
}

type V1 = TemplateDef["V1"];
type TemplateFns = V1["functions"];

type FuncType = FunctionDef["output"];

function FunctionCard({
  fn,
  fnIndex,
  selectedIdx,
  onSelected,
}: {
  fn: FunctionDef;
  fnIndex: number;
  onSelected: (fnDef: FunctionDef) => void;
  selectedIdx?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(fnIndex === selectedIdx);
  }, [fnIndex, selectedIdx]);

  function handleClick() {
    onSelected(fn);
    setExpanded(true);
  }

  return (
    <div className={`fn-card ${!fn.is_mut ? "constructor" : ""}`}>
      <button className="fn-header" onClick={handleClick}>
        <div className="fn-sig">
          {fn.is_mut && <span className="fn-badge constructor">mut</span>}
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
                    <span className="arg-type mono">{getTypeAsString(arg.arg_type)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fn.output !== undefined && fn.output !== null && (
            <div className="fn-section">
              <p className="fn-section-label">Returns</p>
              <span className="arg-type mono">{getTypeAsString(fn.output)}</span>
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

function extractFunctions(def: TemplateDef): TemplateFns {
  if (typeof def !== "object" || def === null) return [];
  const v1 = def.V1;
  const fns = v1.functions;
  if (Array.isArray(fns)) return fns as TemplateFns;
  return [];
}

function getTypeAsString(funcType: FuncType): string {
  if (typeof funcType === "string") {
    return funcType;
  }

  const funcTypeKeys = Object.keys(funcType);
  if (funcTypeKeys.length > 0) {
    switch (funcTypeKeys[0]) {
      case "Vec": {
        return getTypeAsString(funcType["Vec" as keyof typeof funcType]);
      }
      case "Tuple": {
        return JSON.stringify(funcType["Tuple" as keyof typeof funcType]);
      }
      case "Other": {
        const other = funcType["Other" as keyof typeof funcType] as { name: string };
        return other.name;
      }
    }
  }

  return "Unknown";
}

const numTypes = ["I8", "I16", "I32", "I64", "I128", "U8", "U16", "U32", "U64", "U128", "Amount"];

function getInputType(strType: string): string {
  if (numTypes.includes(strType)) {
    return "number";
  }
  if (strType === "Bool") {
    return "boolean";
  }
  return "text";
}

export {
  DotLogo,
  TemplateRow,
  DefinitionView,
  FunctionCard,
  Spinner,
  ChevronIcon,
  truncate,
  extractFunctions,
  getTypeAsString,
  getInputType,
};
