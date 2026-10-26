/**
 * Official Grok Bot 0.75.8 scroll-fade logic for the left-rail agents (avatar) list,
 * recovered verbatim from the official renderer and kept free of DOM bootstrap so it
 * can be unit-tested headlessly.
 *
 * Source: /Applications/Grok Bot.app (com.anysphere.sand) 0.75.8 → app.asar →
 * dist/renderer/assets/index.eager-platform-CVpWlQMj.mjs (recovered tree:
 * /Users/Apple/Documents/grokbot/rea-grokbot-0758/frontend/index.eager-platform-CVpWlQMj.mjs)
 *
 * Official's `ui-scroll-area` component renders the fade entirely as INLINE styles on
 * the viewport element — the mask geometry is not in any stylesheet (verified: neither
 * app's CSS mentions `ui-scroll-area--masked` or `--scroll-fade-*`). The pieces, with
 * the official minified names they replicate:
 *
 *   nc()/applyFadeEdges() — boundary detection with a 5px threshold:
 *     isAtTop    = scrollTop <= 5
 *     isAtBottom = scrollTop + clientHeight >= scrollHeight - 5
 *     edges      = { top: !isAtTop, bottom: !isAtBottom }      // "content that way"
 *     (the controller only rewrites the mask when an edge CHANGED)
 *
 *   ac() — the inline mask writer (block case only; the agents list passes no
 *   start/end sizes):
 *     both edges false  → removeProperty for mask-image/-webkit-mask-image/mask-size/
 *                         mask-repeat/mask-composite/-webkit-mask-composite
 *     otherwise         → mask-image = -webkit-mask-image =
 *       `linear-gradient(to bottom, rgba(0,0,0,var(--scroll-fade-top-start-opacity)) 0px,
 *                        black <topSize>, black calc(100% - <bottomSize>),
 *                        rgba(0,0,0,var(--scroll-fade-bottom-start-opacity)) 100%)`
 *       with <topSize> = var(--scroll-fade-top-size) when the top edge is active
 *       else 0px (collapsed), same for <bottomSize>; mask-size: 100% 100%;
 *       mask-repeat: no-repeat.
 *
 *   oc() — the per-instance CSS variables. The agents sidebar renders its scroll area
 *   with `topFadeSize: 28, bottomFadeSize: 48` (index.eager-app-BPR02W4s.mjs:19090,
 *   live-verified as --scroll-fade-top-size: 28px / --scroll-fade-bottom-size: 48px),
 *   start opacities defaulting to 0:
 *     --scroll-fade-top-size: 28px; --scroll-fade-bottom-size: 48px;
 *     --scroll-fade-top-start-opacity: 0; --scroll-fade-bottom-start-opacity: 0;
 *
 * The 0.18 baseline carries the `ui-scroll-area--masked` class on the region but none
 * of this machinery (0 hits for `scroll-fade` in its chunk), so its viewport computes
 * mask-image: none — the visible difference this port removes.
 */

/** Official nc()/applyFadeEdges() threshold, in px. */
export const SCROLL_FADE_THRESHOLD_PX = 5;

/** The agents-list instance's fade sizes, from official's `topFadeSize: 28,
 * bottomFadeSize: 48` props and their 0-default start opacities. */
export const AGENTS_LIST_FADE = {
  topPx: 28,
  bottomPx: 48,
  topStartOpacity: 0,
  bottomStartOpacity: 0,
} as const;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface ScrollFadeEdges {
  top: boolean;
  bottom: boolean;
}

/** Official nc() + applyFadeEdges() composition: an edge is "on" when there is content
 * beyond that boundary (threshold 5px), which is exactly `!isAtBoundary`. */
export function fadeEdgesFor(metrics: ScrollMetrics): ScrollFadeEdges {
  const isAtTop = metrics.scrollTop <= SCROLL_FADE_THRESHOLD_PX;
  const isAtBottom = metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - SCROLL_FADE_THRESHOLD_PX;
  return { top: !isAtTop, bottom: !isAtBottom };
}

/** Official ac()'s block gradient for the given edges; null when BOTH edges are off —
 * official's signal to strip every mask property (also the fit-in-viewport case: a
 * non-scrollable list is at both boundaries, so no mask at all). */
export function blockFadeMaskImage(edges: ScrollFadeEdges): string | null {
  if (!edges.top && !edges.bottom) return null;
  const top = edges.top ? "var(--scroll-fade-top-size)" : "0px";
  const bottom = edges.bottom ? "var(--scroll-fade-bottom-size)" : "0px";
  return (
    "linear-gradient(to bottom, rgba(0, 0, 0, var(--scroll-fade-top-start-opacity)) 0px, black " +
    top +
    ", black calc(100% - " +
    bottom +
    "), rgba(0, 0, 0, var(--scroll-fade-bottom-start-opacity)) 100%)"
  );
}

/** The properties official ac() removes when no edge is active. */
export const MASK_IMAGE_PROPERTIES: readonly string[] = [
  "mask-image",
  "-webkit-mask-image",
  "mask-size",
  "mask-repeat",
  "mask-composite",
  "-webkit-mask-composite",
];

/** Structural stand-in for CSSStyleDeclaration so the writer is testable headlessly. */
export interface StylePropertyTarget {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
}

/** Official ac(), block case: write the mask properties, or remove all of them. */
export function applyScrollFadeProperties(style: StylePropertyTarget, edges: ScrollFadeEdges): void {
  const image = blockFadeMaskImage(edges);
  if (image == null) {
    for (const property of MASK_IMAGE_PROPERTIES) style.removeProperty(property);
    return;
  }
  style.setProperty("mask-image", image);
  style.setProperty("-webkit-mask-image", image);
  style.setProperty("mask-size", "100% 100%");
  style.setProperty("mask-repeat", "no-repeat");
}

/** Official oc()'s variable block for the agents-list instance. The vars must live on
 * the masked element itself (official renders them in its style prop) because the
 * gradient references them per-element. */
export function applyScrollFadeVars(style: StylePropertyTarget, fade: typeof AGENTS_LIST_FADE = AGENTS_LIST_FADE): void {
  style.setProperty("--scroll-fade-top-size", fade.topPx + "px");
  style.setProperty("--scroll-fade-bottom-size", fade.bottomPx + "px");
  style.setProperty("--scroll-fade-top-start-opacity", String(fade.topStartOpacity));
  style.setProperty("--scroll-fade-bottom-start-opacity", String(fade.bottomStartOpacity));
}
