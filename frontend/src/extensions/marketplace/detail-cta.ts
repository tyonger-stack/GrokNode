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
  ACTION_BUTTON_CLASSES,
  CANCEL_BUTTON_CLASSES,
  DETAIL_ACCOUNT_NAME_ROW_CLASSES,
  DETAIL_ACCOUNT_FORM_INPUT_CLASSES,
  DETAIL_ACCOUNT_SAVE_CLASSES,
  DETAIL_ADD_ACCOUNT_FULL_CLASSES,
  DETAIL_ADD_ACCOUNT_FORM_CLASSES,
  DETAIL_ADD_ACCOUNT_FIELD_CLASSES,
  DETAIL_ADD_ACCOUNT_HINT_CLASSES,
  DETAIL_ADD_ACCOUNT_INPUT_CLASSES,
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

/**
 * 「添加其他账户」展开后的内联表单。
 *
 * 官方 `ve()` 里这一块挂在账户列表末尾，和「编辑 <account> 账户」展开的表单是**两个不同的东西**：
 *   · 它的外层 div 类列表与编辑表单的槽位**逐字相同**（都读出那 9 个类），
 *   · 但输入框是**另一套 17 类**（编辑表单那套是 14 类），
 *   · 按钮是「授权」/「取消」，编辑表单是「保存 … 账户」/「移除 … 账户」。
 * 之前把「新账户标签」输入框错放进 `createAccountEditForm`、并且断言它「1→2 可见输入框」，
 * 都是因为把这两块当成了同一个表单 —— 基准本身就取错了对象。
 *
 * ## 提交语义（官方 `P` 处理器逐条移植）
 *
 * 官方把标签归一化成 `trim().toLowerCase()` 得到 `q`，然后：
 *   1. 没有草稿 → 直接返回，什么都不做；
 *   2. `q` 为空、或 `q` 等于**源账户**的键 → 只收起表单，**不提交**（重命名回退值）；
 *   3. `q === "grok"`（官方常量 `Vs`）→ 只收起表单，不提交 —— 那是内置账户，不是一个可新建的标签；
 *   4. 否则先收起表单，再按 `q` 是否命中已有账户键分流：命中 → `onAuthenticate({serverId, accountKey})`，
 *      未命中 → `onAddAccount({serverId, label})`。
 * 官方这两条回调在 `chunk-view-BudImuR0.js` 里是同一个函数的两种实参名
 * （`onAddAccount = $ => de($.serverId, $.label)`、`onAuthenticate = $ => de($.serverId, $.accountKey)`），
 * 即「标签就是 accountKey」。所以本地两条都落到 `desktop.mcp.authenticate(serverId, q)`。
 *
 * Enter 与「授权」是同一个处理器，Escape 与「取消」是同一个处理器。
 *
 * `sourceAccountKey` 对应官方的 `u.accountKey`（草稿所属的源账户）。它与第 4 步的
 * `existingAccountKeys` **不是一回事**：前者让「把源账户的键再敲一遍」变成空操作而不是去重新授权它，
 * 后者让「敲一个别的已存在账户」走重新授权。官方那个草稿 hook 在此块上的 `accountKey`
 * 未在产物里单独暴露，本地传账户列表首项的键（Gmail 实机即 `default`）—— 对每个现实取值都等价。
 */
export interface AddAccountFormHandlers {
  /** 新建账户：标签即 accountKey。官方 `onAddAccount`。 */
  readonly onAddAccount: (args: { readonly serverId: string; readonly label: string }) => void;
  /** 该账户键已存在，转为重新授权。官方 `onAuthenticate`。 */
  readonly onAuthenticate: (args: { readonly serverId: string; readonly accountKey: string }) => void;
  /** 收起表单，回到折叠态。 */
  readonly onClose: () => void;
}

export interface AddAccountFormArgs {
  readonly serverId: string;
  /** 草稿所属的源账户键，见上文。 */
  readonly sourceAccountKey: string;
  /** 该 server 上已有的账户键集合，用于第 4 步分流。 */
  readonly existingAccountKeys: ReadonlySet<string>;
  readonly handlers: AddAccountFormHandlers;
  /** 授权进行中：禁用「授权」按钮。官方读的是整个详情页的 `isBusy`。 */
  readonly isBusy?: () => boolean;
}

export function createAddAccountForm(doc: Document, args: AddAccountFormArgs): HTMLElement {
  const { serverId, sourceAccountKey, existingAccountKeys, handlers, isBusy } = args;

  const form = doc.createElement("div");
  applyClasses(form, DETAIL_ADD_ACCOUNT_FORM_CLASSES);
  form.setAttribute("data-add-account-form", serverId);

  const field = doc.createElement("span");
  applyClasses(field, DETAIL_ADD_ACCOUNT_FIELD_CLASSES);
  const input = doc.createElement("input");
  applyClasses(input, DETAIL_ADD_ACCOUNT_INPUT_CLASSES);
  (input as HTMLInputElement).type = "text";
  input.setAttribute("aria-label", TEXT.accountLabelInput);
  input.placeholder = TEXT.accountLabelPlaceholder;
  field.append(input);
  // 「标签是保留名」的红色提示。官方是 `S ? <span …/> : null` —— input 的**兄弟**节点，
  // 判据 `S = h != null && trim(h).toLowerCase() === Vs`（`Vs` 是保留的 Grok 账户键）。
  // 实机读数：输 `Grok` / `grok` 出现，输 `default` / `个人` / `工作` 不出现 ⇒ 大小写不敏感。
  // **常驻建节点、只切 hidden**：官方是同一位置的条件渲染，DOM 里始终有这一支；
  // 反复增删会让焦点/滚动位置跳动。
  const hint = doc.createElement("span");
  applyClasses(hint, DETAIL_ADD_ACCOUNT_HINT_CLASSES);
  hint.textContent = TEXT.reservedAccountLabelHint;
  hint.hidden = true;
  field.append(hint);
  form.append(field);

  const authorize = doc.createElement("button");
  applyClasses(authorize, ACTION_BUTTON_CLASSES);
  (authorize as HTMLButtonElement).type = "button";
  authorize.append(doc.createTextNode(TEXT.authorize));
  form.append(authorize);

  const cancel = doc.createElement("button");
  applyClasses(cancel, CANCEL_BUTTON_CLASSES);
  (cancel as HTMLButtonElement).type = "button";
  cancel.append(doc.createTextNode(TEXT.cancel));
  form.append(cancel);

  // 官方的 `h` 为 null 时渲染折叠按钮、非 null 时渲染本表单；`y(null)` 收起、`y("")` 展开。
  // 这里把「展开」建模为：本表单在 DOM 里存在且输入框已聚焦。
  const label = (): string => (input as HTMLInputElement).value;
  const isReservedLabel = (): boolean => label().trim().toLowerCase() === GROK_ACCOUNT_KEY;
  const syncHint = (): void => {
    hint.hidden = !isReservedLabel();
  };
  syncHint();
  const submit = (): void => {
    const q = label().trim().toLowerCase();
    if (q.length === 0 || q === sourceAccountKey) {
      handlers.onClose();
      return;
    }
    if (q === GROK_ACCOUNT_KEY) {
      handlers.onClose();
      return;
    }
    handlers.onClose();
    if (existingAccountKeys.has(q)) {
      handlers.onAuthenticate({ serverId, accountKey: q });
    } else {
      handlers.onAddAccount({ serverId, label: q });
    }
  };

  (authorize as HTMLButtonElement).disabled = isBusy?.() ?? false;
  authorize.addEventListener("click", () => {
    if (isBusy?.() === true) return;
    submit();
  });
  cancel.addEventListener("click", () => handlers.onClose());
  input.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === "Enter") submit();
    else if (key === "Escape") handlers.onClose();
  });
  // 官方是受控输入（`value:h, onChange: y`），提示随每次击键重算；这里同样要跟。
  input.addEventListener("input", syncHint);

  // 官方 JSX 写的是 `autoFocus: true`；React 在挂载时消费掉它而不留 attribute（实机读数
  // `autofocus === false`），所以这里显式 focus()，而不是设 attribute。
  (input as HTMLInputElement).focus?.();
  return form;
}

/** 官方 `Vs` 常量（`index.eager-app-Cj5f8Gby.js` 的 `dPe`）。输入它只会收起表单、不新建账户。 */
const GROK_ACCOUNT_KEY = "grok";

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
 * 官方读数：点开后**内联**出现，可见输入框 **0→1**，按钮从「编辑 default 账户」换成
 * 「保存 … 账户」+「移除 … 账户」；`role=dialog` 数不变，说明它不是弹层。表单里**只有重命名
 * 那一个输入框** —— 此前这里还多渲染了一个「新账户标签」输入框，理由是「点开后 1→2」。**那条
 * 基准取错了对象**：`新账户标签` 输入框属于末尾「添加其他账户」按钮就地替换出的那块表单
 * （见 `createAddAccountForm`），与编辑表单毫无关系。照着 1→2 补，等于凭空多造一个官方此处
 * 不存在的控件。可复核的判据是官方 `ve()` 全文**只有一个 `<input>`**，且只在展开态渲染。
 *
 * 表单里没有任何 chip / select —— 官方没有「位置/分组选择器」，分组语义只由 `新账户标签`
 * 那个自由文本表达。
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
