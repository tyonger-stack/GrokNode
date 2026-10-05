import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load(entry) {
  const outfile = path.join(repoRoot, "node_modules", ".cache", `tests-addacct-${path.basename(entry, ".ts")}.mjs`);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "error",
    plugins: [{
      name: "js-to-ts",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
          const candidate = path.resolve(path.dirname(args.importer), args.path.replace(/\.js$/, ".ts"));
          return existsSync(candidate) ? { path: candidate } : null;
        });
      },
    }],
  });
  return import(pathToFileURL(outfile).href);
}

const { createAddAccountForm, createAccountEditForm, createAddAccountCta } = await load(
  "frontend/src/extensions/marketplace/detail-cta.ts",
);
const styles = await load("frontend/src/extensions/marketplace/official-styles.ts");
const { TEXT } = await load("frontend/src/extensions/marketplace/model.ts");

/**
 * A DOM shim with the event plumbing the add-account form needs.
 *
 * The point of this file is that every assertion below drives the **real** `createAddAccountForm`
 * through real listeners. A text assertion on the source cannot tell a live handler from one parked
 * behind a dead branch — that exact failure mode is what a previous guard in this repo fell into
 * twice, so the shim carries `addEventListener`/`dispatch` and the tests click and type for real.
 */
function makeDocument() {
  const makeStyle = () => {
    const props = new Map();
    return { setProperty: (name, value) => void props.set(name, value), props };
  };
  const makeNode = (tagName) => {
    const classes = [];
    const attributes = new Map();
    const children = [];
    const listeners = new Map();
    const node = {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      type: "",
      value: "",
      disabled: false,
      placeholder: "",
      focused: false,
      className: "",
      classList: { add: (name) => { if (!classes.includes(name)) classes.push(name); } },
      style: makeStyle(),
      setAttribute: (name, value) => void attributes.set(name, String(value)),
      getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
      hasAttribute: (name) => attributes.has(name),
      append: (...nodes) => void children.push(...nodes),
      remove: () => {},
      focus: () => { node.focused = true; },
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatch: (type, event = {}) => {
        for (const fn of listeners.get(type) ?? []) fn(event);
      },
      hasListener: (type) => (listeners.get(type) ?? []).length > 0,
      get textContent() {
        return children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
      },
      set textContent(value) {
        children.length = 0;
        if (value !== "") children.push(String(value));
      },
      get children() { return children; },
      get classListValues() { return classes; },
    };
    return node;
  };
  return { createElement: (tagName) => makeNode(tagName), createTextNode: (text) => ({ nodeType: 3, textContent: String(text), tagName: null }) };
}

/** Build the form with recording handlers, plus a way to type into its input and click its buttons. */
function harness(overrides = {}) {
  const doc = makeDocument();
  const calls = [];
  const form = createAddAccountForm(doc, {
    serverId: "srv-1",
    sourceAccountKey: "default",
    existingAccountKeys: new Set(["default", "work"]),
    handlers: {
      onAddAccount: (a) => calls.push(["add", a]),
      onAuthenticate: (a) => calls.push(["auth", a]),
      onClose: () => calls.push(["close"]),
    },
    ...overrides,
  });
  const [field, authorize, cancel] = form.children;
  const input = field.children[0];
  const hint = field.children[1];
  return {
    form, field, input, hint, authorize, cancel, calls,
    // 真实击键会同时改 value 并派发 input —— 只赋值不派发会让「随输入实时重算」的那部分
    // 永远测不到，于是把「建了节点但从不更新」当成通过。
    type(v) { input.value = v; input.dispatch("input"); },
    clickAuthorize() { authorize.dispatch("click"); },
    clickCancel() { cancel.dispatch("click"); },
    pressEnter() { input.dispatch("keydown", { key: "Enter" }); },
    pressEscape() { input.dispatch("keydown", { key: "Escape" }); },
  };
}

test("结构：表单三层 + 授权/取消，类名逐字对齐官方", () => {
  const h = harness();
  assert.equal(h.form.tagName, "DIV");
  assert.deepEqual(h.form.classListValues, styles.DETAIL_ADD_ACCOUNT_FORM_CLASSES);
  assert.equal(h.field.tagName, "SPAN");
  assert.deepEqual(h.field.classListValues, styles.DETAIL_ADD_ACCOUNT_FIELD_CLASSES);
  assert.equal(h.input.tagName, "INPUT");
  assert.deepEqual(h.input.classListValues, styles.DETAIL_ADD_ACCOUNT_INPUT_CLASSES);

  // 表单只有三个子节点：field + 授权 + 取消。官方 `ve()` 的那个 div 也正是这三支。
  assert.equal(h.form.children.length, 3);

  // 输入框是官方那套 17 类，与编辑表单的 14 类**不是**同一套 —— 混用是最早那次错位的根。
  assert.equal(styles.DETAIL_ADD_ACCOUNT_INPUT_CLASSES.length, 17);
  assert.equal(styles.DETAIL_ACCOUNT_FORM_INPUT_CLASSES.length, 14);
  assert.notDeepEqual(styles.DETAIL_ADD_ACCOUNT_INPUT_CLASSES, styles.DETAIL_ACCOUNT_FORM_INPUT_CLASSES);
});

test("输入框的 aria-label / placeholder 是官方文案，不是自拟", () => {
  const h = harness();
  assert.equal(h.input.getAttribute("aria-label"), "新账户标签");
  assert.equal(h.input.placeholder, "为此账户添加标签，例如“工作”或“个人”");
  assert.equal(TEXT.accountLabelInput, "新账户标签");
  // 官方 JSX 写 autoFocus，实机 `autofocus` 属性读数为 false（React 挂载时消费掉），
  // 所以实现是显式 focus()，不是设 attribute。
  assert.equal(h.input.focused, true);
  assert.equal(h.input.hasAttribute("autofocus"), false);
});

test("新标签走 onAddAccount，且标签即 accountKey（官方同一函数两种实参名）", () => {
  const h = harness();
  h.type("工作");
  h.clickAuthorize();
  assert.deepEqual(h.calls, [["close"], ["add", { serverId: "srv-1", label: "工作" }]]);
});

test("标签先归一化成 trim().toLowerCase() 再提交", () => {
  const h = harness();
  h.type("  Personal  ");
  h.clickAuthorize();
  assert.deepEqual(h.calls, [["close"], ["add", { serverId: "srv-1", label: "personal" }]]);
});

test("已存在的账户键走 onAuthenticate，不是 onAddAccount", () => {
  const h = harness();
  h.type("work");
  h.clickAuthorize();
  assert.deepEqual(h.calls, [["close"], ["auth", { serverId: "srv-1", accountKey: "work" }]]);
  // 大小写不同也必须命中同一账户：existingAccountKeys 是小写化的，官方 `C` 也是拿归一化后的 q 去比。
  const h2 = harness();
  h2.type("WORK");
  h2.clickAuthorize();
  assert.deepEqual(h2.calls, [["close"], ["auth", { serverId: "srv-1", accountKey: "work" }]]);
});

test("先收起表单、再回调 —— 官方两条提交路径都是这个顺序", () => {
  const h = harness();
  h.type("新账户");
  h.clickAuthorize();
  assert.equal(h.calls[0][0], "close", "官方先 b(null) 收起，再调 i()/t()");
  const h2 = harness();
  h2.type("work");
  h2.clickAuthorize();
  assert.equal(h2.calls[0][0], "close");
});

test("三条不提交的分支：空 / 与源账户同名 / grok", () => {
  for (const [label, typed] of [["空串", ""], ["纯空白", "   "], ["与源账户同名", "default"], ["grok 哨兵", "grok"], ["grok 带空白与大小写", "  GROK "]]) {
    const h = harness();
    h.type(typed);
    h.clickAuthorize();
    assert.deepEqual(h.calls, [["close"]], `${label}：只应收起表单，不得提交`);
  }
});

test("Enter 等价于「授权」，Escape 等价于「取消」", () => {
  const a = harness();
  a.type("工作");
  a.pressEnter();
  assert.deepEqual(a.calls, [["close"], ["add", { serverId: "srv-1", label: "工作" }]]);

  const b = harness();
  b.pressEscape();
  assert.deepEqual(b.calls, [["close"]]);

  // 归一化也要一致：Enter 不能绕过 trim/lower。
  const c = harness();
  c.type("  Work  ");
  c.pressEnter();
  assert.deepEqual(c.calls, [["close"], ["auth", { serverId: "srv-1", accountKey: "work" }]]);
});

test("「取消」只收起，不提交", () => {
  const h = harness();
  h.type("工作");
  h.clickCancel();
  assert.deepEqual(h.calls, [["close"]]);
});

test("两个按钮都真的挂了监听器（不是文本里看着像）", () => {
  const h = harness();
  assert.equal(h.authorize.hasListener("click"), true);
  assert.equal(h.cancel.hasListener("click"), true);
  assert.equal(h.input.hasListener("keydown"), true);
  // 折叠态的 CTA 自己**没有**监听器 —— 它的 handler 装在 view.ts 装上的那一层。
  assert.equal(createAddAccountCta(makeDocument()).hasListener("click"), false);
});

test("按钮类名：授权 = 列表行尾那颗按钮的同一配方，取消 = 它加 4 个 ghost 类", () => {
  // 官方实机：授权 54 类、取消 55 类、交集 51。差集是在浏览器里对 class 集合求差算出来的，
  // 不是肉眼比的。这三个数任一漂移都说明配方被改过。
  assert.equal(styles.ACTION_BUTTON_OFFICIAL_CLASSES.length, 54);
  assert.equal(styles.CANCEL_BUTTON_OFFICIAL_CLASSES.length, 55);
  assert.deepEqual(
    styles.CANCEL_BUTTON_OFFICIAL_CLASSES.filter((c) => !styles.ACTION_BUTTON_OFFICIAL_CLASSES.includes(c)),
    ["sand-jbqb8w", "sand-8cg4aw", "sand-19aaqeu", "sand-1dsx48b"],
  );
  assert.deepEqual(
    styles.ACTION_BUTTON_OFFICIAL_CLASSES.filter((c) => !styles.CANCEL_BUTTON_OFFICIAL_CLASSES.includes(c)),
    ["sand-1kxuqrf", "sand-uo9n5k", "sand-1wd3ewq"],
  );
  // 渲染用的是 0.18 可渲染形（7 个逻辑属性类换成物理属性等价类），长度不变。
  assert.equal(styles.ACTION_BUTTON_CLASSES.length, 54);
  assert.equal(styles.CANCEL_BUTTON_CLASSES.length, 55);

  const h = harness();
  assert.deepEqual(h.authorize.classListValues, styles.ACTION_BUTTON_CLASSES);
  assert.deepEqual(h.cancel.classListValues, styles.CANCEL_BUTTON_CLASSES);
  assert.equal(h.authorize.textContent, "授权");
  assert.equal(h.cancel.textContent, "取消");
  assert.equal(h.authorize.type, "button");
  assert.equal(h.cancel.type, "button");
});

test("编辑表单只有**一个**输入框 —— 错位回归守卫", () => {
  // 这条挡的是最早那个错：`新账户标签` 被当成了编辑表单的一部分，于是基准写成「1→2」，
  // 而官方的编辑表单只有重命名那一个。`ve()` 全文也只有一个 `<input>`。
  const doc = makeDocument();
  const form = createAccountEditForm(doc, {
    serverId: "srv-1",
    accountKey: "default",
    handlers: { onSave: () => {}, onRemove: () => {}, onCancel: () => {} },
  });
  const inputs = form.children
    .filter((c) => c.nodeType === 1)
    .flatMap((wrap) => wrap.children.filter((c) => c.nodeType === 1 && c.tagName === "INPUT"));
  assert.equal(inputs.length, 1, "编辑表单必须只有一个输入框");
  assert.equal(inputs[0].value, "default");
  assert.equal(inputs[0].getAttribute("aria-label"), TEXT.accountRenameInput("default"));
  for (const c of form.children.flatMap((w) => w.children ?? [])) {
    assert.notEqual(c.placeholder, TEXT.accountLabelPlaceholder, "新账户标签输入框不属于编辑表单");
  }
});

// ── 「Grok 是保留的账户标签」提示 ────────────────────────────────────────────
// 官方 `ve()`：`S ? <span …>{I({id:"wLsCed"})}</span> : null`，`S = h != null &&
// trim(h) === Vs`（`Vs` = 保留的 Grok 账户键）。它是**字段 span 里的兄弟节点**，
// 不是 placeholder、不是 aria、也不是 tooltip。
// 实机判据（官方 0.66, Gmail 详情页表单展开态，逐个标签试出来）：
//   `Grok` 出现 / `grok` 出现 / `default` 不出现 / `个人` 不出现 / `工作` 不出现
//   ⇒ 判定是 trim + **大小写不敏感**。

test("提示节点：字段 span 内、input 的兄弟、5 类配方逐字对齐、初始隐藏", () => {
  const h = harness();
  assert.ok(h.hint, "提示节点必须存在");
  assert.equal(h.hint.tagName, "SPAN");
  // 它是 input 的**兄弟**（同一父节点），不是 input 的子节点 —— 官方 JSX 就是这么嵌的。
  assert.equal(h.field.children[0], h.input);
  assert.equal(h.field.children[1], h.hint);
  assert.deepEqual(h.hint.classListValues, styles.DETAIL_ADD_ACCOUNT_HINT_CLASSES);
  assert.equal(styles.DETAIL_ADD_ACCOUNT_HINT_CLASSES.length, 5);
  assert.equal(h.hint.textContent, "Grok 是保留的账户标签");
  assert.equal(TEXT.reservedAccountLabelHint, "Grok 是保留的账户标签");
  // 官方 `S` 还要 `h != null`；初值是空串 ⇒ 提示必须收着。
  assert.equal(h.hint.hidden, true);
});

test("提示随输入实时切换，且大小写不敏感（实机逐个标签试出来的判据）", () => {
  // ⚠️ 只把**实测过**的那些标签列进「应显示」。判据是精确相等而非前缀匹配 ——
  // `Grok2` 曾被我写进这一组，实现按官方的精确相等拒绝了它，是**测试**错了不是实现错了。
  // 写这类用例前先问：这一条我真在官方界面上看到过吗？
  for (const typed of ["Grok", "grok", "  GROK  "]) {
    const h = harness();
    h.type(typed);
    assert.equal(h.hint.hidden, false, `输入 ${JSON.stringify(typed)} 应显示提示`);
  }
  // 「grokish」「Grok2」等**不得**命中：官方是 `trim(h) === Vs`，不是 startsWith。
  for (const typed of ["", "   ", "工作", "个人", "default", "Default", "grokish", "Grok2"]) {
    const h = harness();
    h.type(typed);
    assert.equal(h.hint.hidden, true, `输入 ${JSON.stringify(typed)} 不应显示提示`);
  }
});

test("提示是**实时**的：先命中再改回，必须跟着翻回去", () => {
  // 只测「建了节点」会漏掉「从不更新」。这里同一实例连续改两次，两个方向都要变。
  const h = harness();
  h.type("Grok");
  assert.equal(h.hint.hidden, false);
  h.type("工作");
  assert.equal(h.hint.hidden, true, "提示必须随输入收起，不能只会在出现方向上工作");
  h.type("grok");
  assert.equal(h.hint.hidden, false);
});

test("提示的 input 监听器真的挂着（不是靠建节点蒙混过关）", () => {
  const h = harness();
  assert.equal(h.input.hasListener("input"), true, "删掉这个监听器，上面两条实时用例就会变红");
});
