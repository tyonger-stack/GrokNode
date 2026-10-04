/**
 * The two full-width detail CTAs, built as standalone functions.
 *
 * They live apart from `view.ts` for a reason that is not tidiness. Both were wrong at some point
 * in ways every source-level assertion waved through: the add-account CTA carried its label in
 * `aria-label` so it rendered icon-only, and the full-width row family lost its 14px horizontal
 * inset. The suite is source-text assertions with no DOM library, so it could only ever prove the
 * CONSTANT existed, never that the string or the classes reached a node.
 *
 * Taking `doc` as a parameter rather than reaching for the global keeps this module importable in a
 * plain Node test, where a minimal element shim stands in for the browser. The test then runs the
 * exact function `view.ts` runs, so a regression to the old form shows up in `npm test` instead of
 * in a screenshot nobody diffs.
 */

import { GLYPH, DETAIL_ADD_ACCOUNT_FULL_CLASSES, DETAIL_TOOLS_LABEL_CLASSES, DETAIL_TOOLS_ROW_CLASSES, ICON_GLYPH_CLASSES } from "./official-styles.js";
import { TEXT } from "./model.js";

function applyClasses(element: Element, classNames: readonly string[]): void {
  for (const className of classNames) element.classList.add(className);
}

export function createGlyph(
  doc: Document,
  name: string,
  codePoint: string,
  size = 12,
): HTMLElement {
  const glyphNode = doc.createElement("i");
  applyClasses(glyphNode, ICON_GLYPH_CLASSES);
  glyphNode.setAttribute("data-icon-name", name);
  glyphNode.setAttribute("aria-hidden", "true");
  glyphNode.style.setProperty("--cursor-icon-content", JSON.stringify(codePoint));
  glyphNode.style.setProperty("--icon-size", `${size}px`);
  return glyphNode;
}

/**
 * 账户区的「添加其他账户」。
 *
 * Official 0.66 renders the label as a **text node** beside the glyph and carries no aria-label at
 * all: measured `textContent === "添加其他账户"`, `getAttribute("aria-label") === null`,
 * `children.length === 1` (the glyph), height 43. Carrying the copy in `aria-label` only made the
 * button icon-only, 34px tall, with the text existing purely for screen readers. Glyph stays first,
 * matching official's child order.
 */
export function createAddAccountCta(doc: Document): HTMLButtonElement {
  const button = doc.createElement("button");
  applyClasses(button, DETAIL_ADD_ACCOUNT_FULL_CLASSES);
  (button as HTMLButtonElement).type = "button";
  button.append(createGlyph(doc, "plus", GLYPH.plus, 10));
  button.append(doc.createTextNode(TEXT.addAccount));
  return button as HTMLButtonElement;
}

/**
 * 「工具」section 行：已启用 N/N 个 + chevron。
 *
 * This is the other half of the full-width row family that lost 14px of horizontal inset. Its class
 * list carries both lifted classes (`sand-1pic42t` / `sand-1onr9mi`), so it computes `12px 14px` on
 * official and `12px 0px` when the lifts are missing.
 */
export function createToolsRowCta(doc: Document, toolsLabel: string): HTMLButtonElement {
  const row = doc.createElement("button");
  applyClasses(row, DETAIL_TOOLS_ROW_CLASSES);
  (row as HTMLButtonElement).type = "button";

  const label = doc.createElement("span");
  applyClasses(label, DETAIL_TOOLS_LABEL_CLASSES);
  label.textContent = toolsLabel;
  row.append(label);

  row.append(createGlyph(doc, "chevron-right", GLYPH.chevronDown, 10));
  return row as HTMLButtonElement;
}
