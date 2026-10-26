/**
 * Runtime port of official Grok Bot 0.75.8's scroll fade on the left-rail agents
 * (avatar) list. The mask logic lives in agents-list-fade-core.ts (recovered verbatim
 * from official); this entry wires it to the 0.18-rendered DOM:
 *
 *   .sand-agents-list                     the scroll-area region (role=region)
 *   └─ .ui-scroll-area__viewport          the element official masks
 *
 * Official's component drives the mask from its scrollbar controller (scroll events,
 * refreshed metrics, edges cached so the style is only rewritten on change, cleanup on
 * unmount removes every mask property). The replication here:
 *   - find the viewport (attribute-contains selectors; the classes are stable across
 *     0.18/0.75.8 — verified live in both apps);
 *   - set official's per-instance vars (28px/48px/0/0) on the viewport;
 *   - on scroll (passive, rAF-batched), on viewport/content resize (ResizeObserver,
 *     matching official's observer pair) and on DOM mutations (remounts), recompute the
 *     edges and rewrite the mask only when an edge changed;
 *   - when the viewport element is replaced, detach (strip the mask properties, exactly
 *     official's unmount cleanup) and re-attach to the new one.
 *
 * React only manages style properties it knows about, so the inline properties this
 * entry writes survive re-renders of the 0.18 viewport.
 */

import {
  applyScrollFadeProperties,
  applyScrollFadeVars,
  fadeEdgesFor,
  type ScrollFadeEdges,
} from "./agents-list-fade-core.js";

const REGION_SELECTOR = '[class*="sand-agents-list"]';
const VIEWPORT_SELECTOR = '[class*="ui-scroll-area__viewport"]';

function findViewport(doc: Document): HTMLElement | null {
  const region = doc.querySelector(REGION_SELECTOR);
  if (region == null) return null;
  // No instanceof checks: the entry may run against another realm's DOM (tests), and
  // both selectors only ever match the div the scroll component renders.
  const viewport = region.querySelector(VIEWPORT_SELECTOR);
  return viewport == null ? null : (viewport as HTMLElement);
}

interface Attachment {
  viewport: HTMLElement;
  content: Element | null;
  onScroll: () => void;
  resize: ResizeObserver | null;
  lastEdges: ScrollFadeEdges | null;
}

let attached: Attachment | null = null;

function applyEdges(attachment: Attachment, force = false): void {
  const { viewport } = attachment;
  const edges = fadeEdgesFor({
    scrollTop: viewport.scrollTop,
    scrollHeight: viewport.scrollHeight,
    clientHeight: viewport.clientHeight,
  });
  const previous = attachment.lastEdges;
  if (!force && previous != null && previous.top === edges.top && previous.bottom === edges.bottom) return;
  attachment.lastEdges = edges;
  applyScrollFadeProperties(viewport.style, edges);
}

function detach(): void {
  if (attached == null) return;
  const { viewport, onScroll, resize } = attached;
  viewport.removeEventListener("scroll", onScroll);
  resize?.disconnect();
  // Official's useLayoutEffect cleanup: ac(viewport, all-false, …) → every mask
  // property removed. The vars stay (they carry no visual on their own).
  applyScrollFadeProperties(viewport.style, { top: false, bottom: false });
  attached = null;
}

function attach(viewport: HTMLElement): void {
  const raf: { id: number | null } = { id: null };
  const onScroll = () => {
    if (raf.id != null) return;
    raf.id = requestAnimationFrame(() => {
      raf.id = null;
      if (attached != null) applyEdges(attached);
    });
  };
  viewport.addEventListener("scroll", onScroll, { passive: true });
  // Official observes the viewport and its content element; content growth/shrink
  // (bots added/removed) flips edges without a scroll event.
  let resize: ResizeObserver | null = null;
  if (typeof ResizeObserver === "function") {
    resize = new ResizeObserver(() => {
      if (attached != null) applyEdges(attached);
    });
    resize.observe(viewport);
  }
  const content = viewport.firstElementChild;
  if (content != null) resize?.observe(content);
  attached = { viewport, content, onScroll, resize, lastEdges: null };
  applyScrollFadeVars(viewport.style);
  applyEdges(attached, true);
}

function sync(): void {
  const viewport = findViewport(document);
  if (attached != null && attached.viewport === viewport) {
    // Same viewport but a replaced content element: move the resize observation to
    // the new child so content growth still flips the edges.
    const content = viewport?.firstElementChild ?? null;
    if (attached.content !== content) {
      if (attached.content != null) attached.resize?.unobserve(attached.content);
      if (content != null) attached.resize?.observe(content);
      attached.content = content;
      applyEdges(attached, true);
    }
    return;
  }
  detach();
  if (viewport != null) attach(viewport);
}

function scheduleSync(): void {
  try {
    sync();
  } catch {
    return;
  }
}

const observer = new MutationObserver(scheduleSync);
observer.observe(document.body, { childList: true, subtree: true });
scheduleSync();

const testHooks = globalThis as unknown as {
  __sandAgentsListFadeSync?: () => void;
  __sandAgentsListFadeStop?: () => void;
};
testHooks.__sandAgentsListFadeSync = sync;
testHooks.__sandAgentsListFadeStop = () => {
  observer.disconnect();
  detach();
};
