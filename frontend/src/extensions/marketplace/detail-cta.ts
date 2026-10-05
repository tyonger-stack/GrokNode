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

import {
  GLYPH,
  DETAIL_ACCOUNT_NAME_ROW_CLASSES,
  DETAIL_ACCOUNT_FORM_INPUT_CLASSES,
  DETAIL_ACCOUNT_SAVE_CLASSES,
  DETAIL_ADD_ACCOUNT_FULL_CLASSES,
  DETAIL_TOOLS_LABEL_CLASSES,
  DETAIL_TOOLS_ROW_CLASSES,
  ICON_GLYPH_CLASSES,
} from "./official-styles.js";
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

/** 账户编辑表单里两个输入框的外层盒子配方。
 *
 * 官方 0.66 的读数是 `sand-9f619 sand-78zum5 sand-6s0dn4 sand-1nejdyq sand-euugli`（span），
 * 与账户行本身共用 —— 官方就是这么做的，所以这里直接复用同一个常量。
 */
export const ACCOUNT_FIELD_WRAPPER_CLASSES = DETAIL_ACCOUNT_NAME_ROW_CLASSES;

export interface AccountEditFormHandlers {
  /** 保存：key 是原账户键，newKey 是输入框里的新名称。 */
  readonly onSave: (args: { readonly serverId: string; readonly key: string; readonly newKey: string }) => void;
  /** 移除账户。 */
  readonly onRemove: (args: { readonly serverId: string; readonly key: string }) => void;
  /** 关闭表单，回到未编辑态。 */
  readonly onCancel: () => void;
}

/**
 * 账户编辑表单（官方 0.66 的「编辑 default 账户」内联展开）。
 *
 * 官方读数（见 `TEXT` 处的 evidence）：点开后**内联**出现，可见输入框 1→2，按钮从
 * 「编辑 default 账户」换成「保存 … 账户」+「移除 … 账户」；`role=dialog` 数不变，说明它不是
 * 弹层。表单里没有任何 chip / select —— 官方没有「位置/分组选择器」，分组语义只由
 * `新账户标签` 这个自由文本表达。
 *
 * 桥（`window.desktop.mcp.renameAccount` / `.removeAccount`）由宿主 preload 暴露，本模块只负责
 * 发请求、不自己改状态：重命名与移除都会让宿主重算 server 列表，界面等上层刷新。
 *
 * 与本文件其他构造函数一样，`doc` 是参数，测试可传最小 shim 跑真函数。
 */
export function createAccountEditForm(
  doc: Document,
  args: { readonly serverId: string; readonly accountKey: string; readonly handlers: AccountEditFormHandlers },
): HTMLElement {
  const { serverId, accountKey, handlers } = args;
  const form = doc.createElement("div");
  form.setAttribute("data-account-edit-form", accountKey);

  const nameWrap = doc.createElement("div");
  applyClasses(nameWrap, ACCOUNT_FIELD_WRAPPER_CLASSES);
  const rename = doc.createElement("input");
  applyClasses(rename, DETAIL_ACCOUNT_FORM_INPUT_CLASSES);
  (rename as HTMLInputElement).type = "text";
  rename.value = accountKey;
  rename.setAttribute("aria-label", TEXT.accountRenameInput(accountKey));
  nameWrap.append(rename);
  form.append(nameWrap);

  const labelWrap = doc.createElement("div");
  applyClasses(labelWrap, ACCOUNT_FIELD_WRAPPER_CLASSES);
  const label = doc.createElement("input");
  applyClasses(label, DETAIL_ACCOUNT_FORM_INPUT_CLASSES);
  (label as HTMLInputElement).type = "text";
  label.setAttribute("aria-label", TEXT.accountLabelInput);
  label.placeholder = TEXT.accountLabelPlaceholder;
  labelWrap.append(label);
  form.append(labelWrap);

  const save = doc.createElement("button");
  applyClasses(save, DETAIL_ACCOUNT_SAVE_CLASSES);
  (save as HTMLButtonElement).type = "button";
  save.setAttribute("aria-label", TEXT.saveAccount(accountKey));
  save.append(doc.createTextNode(TEXT.saveAccount(accountKey)));
  save.addEventListener("click", () => {
    const next = (rename as HTMLInputElement).value.trim();
    if (next.length === 0 || next === accountKey) return;
    handlers.onSave({ serverId, key: accountKey, newKey: next });
  });
  form.append(save);

  const remove = doc.createElement("button");
  (remove as HTMLButtonElement).type = "button";
  remove.setAttribute("aria-label", TEXT.removeAccount(accountKey));
  remove.append(doc.createTextNode(TEXT.removeAccount(accountKey)));
  remove.addEventListener("click", () => handlers.onRemove({ serverId, key: accountKey }));
  form.append(remove);

  const cancel = doc.createElement("button");
  (cancel as HTMLButtonElement).type = "button";
  cancel.append(doc.createTextNode(TEXT.cancel));
  cancel.addEventListener("click", () => handlers.onCancel());
  form.append(cancel);

  return form;
}
