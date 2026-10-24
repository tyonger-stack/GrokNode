import { parse } from "acorn";

export function mergeReplyStyles(...values) {
  const classes = new Map();
  const style = {};
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (value.$$css) {
      for (const [key, entry] of Object.entries(value)) if (key !== "$$css") classes.set(key, entry);
    } else Object.assign(style, value);
  };
  values.forEach(visit);
  return { className: [...classes.values()].filter(Boolean).join(" "), style };
}

export function replyComponentCode(source) {
  const selected = new Set(["Kvn", "Xlt", "LAe", "zvn", "Uvn", "BAe", "$vn", "Wvn", "OAe", "Dvn", "Rvn", "Fvn"]);
  const parts = [];
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
    if (node.type === "FunctionDeclaration" && (selected.has(node.id.name) || node.id.name.startsWith("R0753"))) parts.push(source.slice(node.start, node.end));
    if (node.type === "VariableDeclaration") for (const declaration of node.declarations) {
      if (declaration.id.type === "Identifier" && (selected.has(declaration.id.name) || declaration.id.name.startsWith("R0753"))) parts.push(`const ${source.slice(declaration.start, declaration.end)};`);
    }
  }
  return parts.join("\n");
}

export function createReplyRuntime(source, { React, locale = "zh-CN" } = {}) {
  const sentinel = Symbol.for("react.memo_cache_sentinel");
  const jsx = React ? (type, props, key) => React.createElement(type, { ...props, key }) : (type, props) => ({ type, props });
  let nextId = 0;
  const p = { jsx, jsxs: jsx, Fragment: React?.Fragment ?? "Fragment" };
  const Text = ({ children, className }) => jsx("span", { className, style: { fontSize: "inherit", lineHeight: "inherit" }, children });
  const Glyph = ({ name, size, rootStyle }) => jsx("svg", {
    "aria-hidden": true,
    "data-icon": name,
    width: size === "xs" ? 12 : 16,
    height: size === "xs" ? 12 : 16,
    viewBox: "0 0 16 16",
    ...mergeReplyStyles(rootStyle),
    children: jsx("path", { d: "M4 4l8 8M12 4l-8 8", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
  });
  const globals = {
    S: React ?? { useId: () => `reply-${nextId++}` },
    he: { c: size => React ? React.useMemo(() => Array(size).fill(sentinel), []) : Array(size).fill(sentinel) },
    p,
    Fe: mergeReplyStyles,
    re: (...values) => values.filter(Boolean).join(" "),
    bt: Glyph,
    vt: Text,
    yo: ({ children }) => children,
    o5e: value => value,
    RLocT: (en, zh) => locale === "zh-CN" ? zh : en,
  };
  const code = replyComponentCode(source);
  const components = new Function(...Object.keys(globals), `${code}\nreturn{Kvn,Xlt,LAe,zvn};`)(...Object.values(globals));
  return { ...components, jsx, globals };
}

export function expandReplyTree(node) {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(expandReplyTree);
  if (typeof node.type === "function") return expandReplyTree(node.type(node.props));
  return { ...node, props: { ...node.props, children: expandReplyTree(node.props?.children) } };
}

export function findReplyNodes(node, predicate) {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(entry => findReplyNodes(entry, predicate));
  return [...(predicate(node) ? [node] : []), ...findReplyNodes(node.props?.children, predicate)];
}
