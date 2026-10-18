/**
 * Port of official 0.71.2 `chunk-get-file-icon-ZAkFyGfn.js` (`m` / `M`).
 * Evidence: rea-grokbot-0712/app/dist/renderer/assets/chunk-get-file-icon-ZAkFyGfn.js
 *   md/markdown/mdx → {icon:"markdown", color:"iconSecondary"}
 *   xlsx/xls/csv → {icon:"table", color:"iconGreenPrimary"}
 *   doc/docx → {icon:"file-text", color:"iconBluePrimary"}
 *   pdf → {icon:"file-type-pdf", color:"iconRedPrimary"}
 *
 * SandIconColor uses short tokens (`secondary`, `green`, …), so official
 * `iconXPrimary` / `iconSecondary` names are mapped at this boundary.
 */
import type { SandIconColor, SandIconName } from "../../ui/sand-kit-primitives";

export type OfficialFileIconColor =
  | "iconSecondary"
  | "iconCyanPrimary"
  | "iconBluePrimary"
  | "iconRedPrimary"
  | "iconGreenPrimary"
  | "iconYellowPrimary"
  | "iconOrangePrimary"
  | "iconPurplePrimary"
  | "iconMagentaPrimary";

export interface FileIconMapping {
  readonly icon: SandIconName;
  readonly color: OfficialFileIconColor;
}

const DEFAULT_MAPPING: FileIconMapping = { icon: "file", color: "iconSecondary" };

const EXTENSION_MAP: Readonly<Record<string, FileIconMapping>> = {
  md: { icon: "markdown", color: "iconSecondary" },
  markdown: { icon: "markdown", color: "iconSecondary" },
  mdx: { icon: "markdown", color: "iconSecondary" },
  xlsx: { icon: "table", color: "iconGreenPrimary" },
  xls: { icon: "table", color: "iconGreenPrimary" },
  ods: { icon: "table", color: "iconGreenPrimary" },
  numbers: { icon: "table", color: "iconGreenPrimary" },
  csv: { icon: "table", color: "iconGreenPrimary" },
  tsv: { icon: "table", color: "iconGreenPrimary" },
  doc: { icon: "file-text", color: "iconBluePrimary" },
  docx: { icon: "file-text", color: "iconBluePrimary" },
  pdf: { icon: "file-type-pdf", color: "iconRedPrimary" },
  json: { icon: "brackets-curly", color: "iconYellowPrimary" },
  jsonc: { icon: "brackets-curly", color: "iconYellowPrimary" },
  json5: { icon: "brackets-curly", color: "iconYellowPrimary" },
  ndjson: { icon: "brackets-curly", color: "iconYellowPrimary" },
  png: { icon: "image-square", color: "iconCyanPrimary" },
  jpg: { icon: "image-square", color: "iconCyanPrimary" },
  jpeg: { icon: "image-square", color: "iconCyanPrimary" },
  gif: { icon: "image-square", color: "iconCyanPrimary" },
  bmp: { icon: "image-square", color: "iconCyanPrimary" },
  webp: { icon: "image-square", color: "iconCyanPrimary" },
  tiff: { icon: "image-square", color: "iconCyanPrimary" },
  ico: { icon: "image-square", color: "iconCyanPrimary" },
  avif: { icon: "image-square", color: "iconCyanPrimary" },
  mp4: { icon: "play-circle", color: "iconRedPrimary" },
  mov: { icon: "play-circle", color: "iconRedPrimary" },
  webm: { icon: "play-circle", color: "iconRedPrimary" },
  m4v: { icon: "play-circle", color: "iconRedPrimary" },
  avi: { icon: "play-circle", color: "iconRedPrimary" },
  mkv: { icon: "play-circle", color: "iconRedPrimary" },
  mp3: { icon: "waveform", color: "iconPurplePrimary" },
  wav: { icon: "waveform", color: "iconPurplePrimary" },
  flac: { icon: "waveform", color: "iconPurplePrimary" },
  aac: { icon: "waveform", color: "iconPurplePrimary" },
  ogg: { icon: "waveform", color: "iconPurplePrimary" },
  m4a: { icon: "waveform", color: "iconPurplePrimary" },
  opus: { icon: "waveform", color: "iconPurplePrimary" },
  zip: { icon: "package-zipper", color: "iconYellowPrimary" },
  tar: { icon: "package-zipper", color: "iconYellowPrimary" },
  gz: { icon: "package-zipper", color: "iconYellowPrimary" },
  tgz: { icon: "package-zipper", color: "iconYellowPrimary" },
  rar: { icon: "package-zipper", color: "iconYellowPrimary" },
  "7z": { icon: "package-zipper", color: "iconYellowPrimary" },
  bz2: { icon: "package-zipper", color: "iconYellowPrimary" },
  xz: { icon: "package-zipper", color: "iconYellowPrimary" },
  txz: { icon: "package-zipper", color: "iconYellowPrimary" },
  txt: { icon: "file-text", color: "iconSecondary" },
  log: { icon: "file-text", color: "iconSecondary" },
  py: { icon: "file-type-python", color: "iconBluePrimary" },
  sh: { icon: "currency-dollar", color: "iconGreenPrimary" },
  zsh: { icon: "currency-dollar", color: "iconGreenPrimary" },
  bash: { icon: "currency-dollar", color: "iconGreenPrimary" },
};

const LINE_REF_SUFFIX = /(?::\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)$/i;

export function mapOfficialIconColor(color: OfficialFileIconColor): SandIconColor {
  switch (color) {
    case "iconSecondary":
      return "secondary";
    case "iconCyanPrimary":
      return "cyan";
    case "iconBluePrimary":
      return "blue";
    case "iconRedPrimary":
      return "red";
    case "iconGreenPrimary":
      return "green";
    case "iconYellowPrimary":
      return "yellow";
    case "iconOrangePrimary":
      return "orange";
    case "iconPurplePrimary":
      return "purple";
    case "iconMagentaPrimary":
      return "magenta";
    default: {
      const _exhaustive: never = color;
      return _exhaustive;
    }
  }
}

function basenameFrom(nameOrPath: string): string {
  let path = nameOrPath.trim();
  if (path.length === 0) return "";
  if (URL.canParse(path)) {
    try {
      path = decodeURIComponent(new URL(path).pathname);
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      path = new URL(path).pathname;
    }
  }
  path = path.replace(/^file:\/\//iu, "").replace(LINE_REF_SUFFIX, "");
  const parts = path.split(/[/\\]/);
  return (parts.pop() ?? path).toLowerCase();
}

/** Official `R(o)` — longest dotted suffix that exists in the extension map. */
function matchedExtensionKey(basename: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(EXTENSION_MAP, basename)) return basename;
  if (basename.endsWith(".")) return undefined;
  const parts = basename.split(".");
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = parts.slice(index).join(".");
    if (Object.prototype.hasOwnProperty.call(EXTENSION_MAP, candidate)) return candidate;
  }
  return undefined;
}

/** Official `m(filenameOrExt)` — returns icon + color for a library / attachment row. */
export function resolveFileIcon(nameOrPath: string): FileIconMapping {
  const basename = basenameFrom(nameOrPath);
  if (basename.length === 0) return DEFAULT_MAPPING;
  const key = matchedExtensionKey(basename);
  if (key == null) return DEFAULT_MAPPING;
  return EXTENSION_MAP[key] ?? DEFAULT_MAPPING;
}
