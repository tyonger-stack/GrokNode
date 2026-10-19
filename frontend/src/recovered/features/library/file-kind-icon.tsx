/**
 * Port of official 0.71.2 library / attachment file-kind tile (`Xg` + `KF` /
 * platform `tF` in rea-grokbot-0712).
 *
 * Evidence:
 *   index-wlkGG389.js — `function Xg` / `function XF` / `sNe` stripe map
 *   index.eager-platform-DKZJbDqM.js — `$P` / `OP` / `tF` extension → kind
 *   index-DkV65EBE.css — stripe colors (`sand-1o4ikt4` blue, `sand-ptgcna` red, …)
 *
 * Library rows use this 24×24 tile instead of SandIcon glyphs so docx/pdf/xlsx
 * show the official page-lines + colored bottom bar.
 */
import type { ReactNode } from "react";

export type FileKindVariant =
  | "generic"
  | "docx"
  | "ppt"
  | "keynote"
  | "json"
  | "page"
  | "pdf"
  | "spreadsheet"
  | "zip"
  | "audio"
  | "font"
  | "unknown";

const EXTENSION_KIND: Readonly<Record<string, FileKindVariant>> = {
  pdf: "pdf",
  doc: "docx",
  docx: "docx",
  odt: "docx",
  pages: "docx",
  rtf: "docx",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  ods: "spreadsheet",
  numbers: "spreadsheet",
  ppt: "ppt",
  pptx: "ppt",
  odp: "ppt",
  key: "keynote",
  zip: "zip",
  tar: "zip",
  gz: "zip",
  tgz: "zip",
  bz2: "zip",
  xz: "zip",
  "7z": "zip",
  rar: "zip",
  ttf: "font",
  otf: "font",
  woff: "font",
  woff2: "font",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  aac: "audio",
  flac: "audio",
  ogg: "audio",
  opus: "audio",
  json: "json",
  jsonc: "json",
  json5: "json",
  ndjson: "json",
};

/** Platform `OP` — text-like extensions render as the generic lined tile. */
const GENERIC_EXTENSIONS = new Set([
  "md", "markdown", "mdx", "txt", "text", "log", "html", "htm", "xml",
  "yaml", "yml", "toml", "ini", "cfg", "env", "sh", "bash", "zsh",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "rb", "go", "rs",
  "java", "kt", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "php",
  "sql", "css", "scss", "tex",
]);

const STRIPE: Partial<Record<FileKindVariant, "blue" | "red" | "green" | "orange" | "neutral">> = {
  docx: "blue",
  keynote: "blue",
  page: "neutral",
  pdf: "red",
  ppt: "orange",
  spreadsheet: "green",
};

function extensionOf(nameOrPath: string): string | null {
  let path = nameOrPath.trim();
  if (path.length === 0) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = decodeURIComponent(new URL(path).pathname);
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      path = new URL(path).pathname;
    }
  }
  path = path.replace(/^file:\/\//iu, "").replace(/[?#].*$/u, "");
  const base = (path.split(/[/\\]/).pop() ?? path).toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1);
}

/** Official `tF` / `KF` — extension → library file-kind variant. */
export function resolveFileKindVariant(nameOrPath: string): FileKindVariant {
  const ext = extensionOf(nameOrPath);
  if (ext == null) return "unknown";
  const mapped = EXTENSION_KIND[ext];
  if (mapped != null) return mapped;
  if (GENERIC_EXTENSIONS.has(ext)) return "generic";
  return "unknown";
}

function Line({ half = false }: { readonly half?: boolean }): ReactNode {
  return <span aria-hidden="true" className={half ? "sand-library-fk-line sand-library-fk-line--half" : "sand-library-fk-line"} />;
}

function KindArt({ variant }: { readonly variant: FileKindVariant }): ReactNode {
  switch (variant) {
    case "generic":
      return <span className="sand-library-fk-art">{Line({ half: true })}<Line /><Line /><Line half /></span>;
    case "docx":
      return <span className="sand-library-fk-art"><Line /><Line /><Line half /></span>;
    case "ppt":
    case "keynote":
      return <span className="sand-library-fk-art"><Line /><Line half /></span>;
    case "json":
      return <span className="sand-library-fk-art">
        <span className="sand-library-fk-dot" /><span className="sand-library-fk-brace-pair" /><span className="sand-library-fk-brace-pair" /><span className="sand-library-fk-dot" />
      </span>;
    case "page":
    case "pdf":
      return <span className="sand-library-fk-art">
        <Line />
        <span className="sand-library-fk-pdf-row">
          <span className="sand-library-fk-pdf-col"><Line /><Line /></span>
          <span className="sand-library-fk-pdf-block" />
        </span>
      </span>;
    case "spreadsheet":
      return <span className="sand-library-fk-grid" aria-hidden="true">
        {Array.from({ length: 15 }, (_, index) => <span className="sand-library-fk-cell" key={index} />)}
      </span>;
    case "zip":
      return <span className="sand-library-fk-art sand-library-fk-art--zip">
        <span className="sand-library-fk-zip-tooth sand-library-fk-zip-tooth--end" />
        <span className="sand-library-fk-zip-tooth sand-library-fk-zip-tooth--start" />
        <span className="sand-library-fk-zip-tooth sand-library-fk-zip-tooth--end" />
        <span className="sand-library-fk-zip-tooth sand-library-fk-zip-tooth--start" />
        <span className="sand-library-fk-zip-tooth sand-library-fk-zip-tooth--end" />
        <span className="sand-library-fk-zip-tooth sand-library-fk-zip-tooth--start" />
      </span>;
    case "audio":
      return <span className="sand-library-fk-art sand-library-fk-art--audio">
        <span className="sand-library-fk-audio-bar sand-library-fk-audio-bar--short" />
        <span className="sand-library-fk-audio-bar" />
        <span className="sand-library-fk-audio-bar sand-library-fk-audio-bar--short" />
      </span>;
    case "font":
    case "unknown":
      return <span className="sand-library-fk-art sand-library-fk-art--glyph">{variant === "font" ? "Aa" : "?"}</span>;
    default: {
      const _exhaustive: never = variant;
      return _exhaustive;
    }
  }
}

export function FileKindIcon(props: { readonly name: string }): ReactNode {
  const variant = resolveFileKindVariant(props.name);
  const stripe = STRIPE[variant];
  const wide = variant === "ppt" || variant === "keynote";
  return (
    <span aria-hidden="true" className="sand-library-fk" data-file-kind={variant}>
      <span className={wide ? "sand-library-fk-face sand-library-fk-face--wide" : "sand-library-fk-face"}>
        <KindArt variant={variant} />
        {stripe == null ? null : <span className={`sand-library-fk-stripe sand-library-fk-stripe--${stripe}`} />}
      </span>
    </span>
  );
}
