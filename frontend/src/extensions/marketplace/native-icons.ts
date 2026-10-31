/**
 * Official 0.78.1's native marketplace icons, ported verbatim.
 *
 * The two native catalogue entries (1Password, 邮箱) carry no `iconUrl` by design: official
 * resolves them from the entry NAME through its own brand registry (`DD`/`PYe` —
 * `onepassword` -> the 1Password brand SVG on #303136, `email` -> the envelope glyph on the
 * magenta token), never the first-letter monogram that upstream's icon builders fall back to.
 *
 * Every byte below is a live capture from the running official 0.78.1 app (CDP 9333,
 * 2026-10-31, probe-103/probe-107/probe-107b; pinned in
 * tests/fixtures/official-0781-native-icons.json):
 *
 *   rows    40x40 box, border-radius 11px, svg 22x22, envelope `--icon-size: 22px`
 *   detail  56x56 box, border-radius 16px, svg 31x31, envelope `--icon-size: 31px`
 *
 * The envelope paints through upstream 0.18's own icon font: `ui-1qt6sjn` is
 * `font-family: cursor-icons`, `ui-1yj7g93` is `:before{content:var(--cursor-icon-content)}`,
 * and the glyph itself is U+EB1C. 20 of the 22 classes in official's `ui-*` recipe already
 * exist in 0.18's stylesheet; the two that do not (`ui-jb5y04`, `ui-1bxnb1t`) carry no
 * glyph-bearing rule, so their absence changes nothing.
 */

/** Official's `Zo` — the two native markers. */
export type NativeIconMarker = "onepassword" | "email";

export const NATIVE_ICON_CLASSES = "sand-tool-icon sand-9f619 sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-b3r6kr sand-6dg3xy sand-1y0btm7 sand-5fd6op";

export const ONEPASSWORD_SVG_PATH = "M12 0c6.627 0 12 5.373 12 12c0 6.628-5.373 12-12 12S0 18.628 0 12C0 5.373 5.373 0 12 0m-.893 4.86c-.485 0-.727.001-.913.095a.87.87 0 0 0-.378.379c-.094.185-.095.428-.095.912v2.747c0 .12 0 .182.016.238q.02.075.065.138a1 1 0 0 0 .175.162l.695.564c.113.092.17.139.19.194a.22.22 0 0 1 0 .15c-.02.056-.077.102-.19.194l-.695.564a1 1 0 0 0-.175.162a.4.4 0 0 0-.065.138a1 1 0 0 0-.016.238v6.019c0 .485 0 .728.095.913a.87.87 0 0 0 .378.378c.186.094.428.094.913.094h1.786c.485 0 .727 0 .913-.094a.87.87 0 0 0 .378-.378c.095-.185.095-.428.095-.913v-2.747c0-.12 0-.182-.016-.238a.4.4 0 0 0-.065-.138a1 1 0 0 0-.175-.162l-.695-.564c-.113-.092-.17-.138-.191-.193a.22.22 0 0 1 0-.152c.02-.055.078-.1.19-.193l.696-.564a1 1 0 0 0 .175-.162a.4.4 0 0 0 .065-.138a1 1 0 0 0 .016-.238V6.246c0-.484 0-.727-.095-.912a.87.87 0 0 0-.378-.379c-.186-.094-.428-.094-.913-.094Z";

export const ROW_SVG_ATTRS = " fill=\"#ffffff\" height=\"22\" role=\"img\" viewBox=\"0 0 24 24\" width=\"22\"";

export const DETAIL_SVG_ATTRS = " fill=\"#ffffff\" height=\"31\" role=\"img\" viewBox=\"0 0 24 24\" width=\"31\"";

export const EMAIL_ICON_CLASSES = "ui-icon ui-1j61x8r ui-etm3q0 ui-1tachi3 ui-1qt6sjn ui-o5v014 ui-3nfvp2 ui-6s0dn4 ui-l56j7k ui-1heor9g ui-1oai4fc ui-higkf7 ui-xymvpz ui-krqix3 ui-1403hyl ui-2b8uid ui-6mezaz ui-vmahel ui-lh3980 ui-87ps6o ui-1winvzj ui-1u4itkb ui-1q5xvfy ui-jb5y04 ui-1bxnb1t ui-1ehclkv ui-1yj7g93 cursor-icon sand-14ju556";

/** The envelope glyph official's icon font paints at U+EB1C, as `--cursor-icon-content`. */
const ENVELOPE_GLYPH = "\ueb1c";

/** `--icon-size` follows the box: 22px on rows, 31px on the detail header. */
function envelopeStyle(svgSize: number): string {
  return `--cursor-icon-content: "${ENVELOPE_GLYPH}"; --icon-size: ${svgSize}px;`;
}

/**
 * Official's resolution: `mo(n)` probes `pluginName`, then `name`, lower-cased with `en-US`;
 * the `native` marker takes precedence when the entry carries one. The browse page hands rows
 * the raw catalogue view, the dialog's model keeps it as `row.entry`, and the vendor probe
 * never reads `displayName` — but the 1Password displayName localizes to the same key, so
 * probing it keeps the brand when a caller passes a display-shaped object.
 */
export function nativeIconMarkerOf(source: unknown): NativeIconMarker | null {
  const row = (source ?? {}) as {
    entry?: unknown; native?: unknown; pluginName?: unknown; name?: unknown; displayName?: unknown;
  };
  const entry = (row.entry ?? row) as { native?: unknown; pluginName?: unknown; name?: unknown; displayName?: unknown };
  const native = entry.native ?? row.native;
  if (typeof native === "string") return native === "onepassword" || native === "email" ? native : null;
  for (const candidate of [entry.pluginName, entry.name, entry.displayName, row.pluginName, row.name, row.displayName]) {
    const key = (candidate ?? "").toString().trim().toLocaleLowerCase("en-US");
    if (key === "onepassword" || key === "1password") return "onepassword";
    if (key === "email") return "email";
  }
  return null;
}

/**
 * Official's native icon frame. `size` is the box edge: 40 for rows, 56 for the detail header
 * (official derives the inner glyph sizes from the same value — svg 22/31, radius 11/16).
 */
export function buildNativeToolIcon(marker: NativeIconMarker, size: 40 | 56): HTMLSpanElement {
  const box = document.createElement("span");
  box.className = NATIVE_ICON_CLASSES;
  box.setAttribute("aria-hidden", "true");
  box.style.width = `${size}px`;
  box.style.height = `${size}px`;
  box.style.borderRadius = size >= 56 ? "16px" : "11px";
  box.style.backgroundColor = marker === "onepassword" ? "rgb(48, 49, 54)" : "var(--sand-bg-magenta-primary)";
  box.style.color = "rgb(255, 255, 255)";
  if (marker === "onepassword") {
    const svgSize = size >= 56 ? 31 : 22;
    box.innerHTML =
      `<svg fill="#ffffff" height="${svgSize}" role="img" viewBox="0 0 24 24" width="${svgSize}"><path d="${ONEPASSWORD_SVG_PATH}"></path></svg>`;
  } else {
    const glyph = document.createElement("i");
    glyph.className = EMAIL_ICON_CLASSES;
    glyph.setAttribute("data-icon-name", "envelope");
    glyph.setAttribute("aria-hidden", "true");
    glyph.setAttribute("style", envelopeStyle(size >= 56 ? 31 : 22));
    box.append(glyph);
  }
  return box;
}
