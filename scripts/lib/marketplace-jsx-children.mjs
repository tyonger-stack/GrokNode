/**
 * Normalize children written in the CLASSIC jsx convention to the AUTOMATIC runtime's form.
 *
 * ## Why this exists
 *
 * Upstream 0.18's renderer chunk calls React through the AUTOMATIC runtime: the chunk's own
 * `t` is `jsx`/`jsxs`, so the signature is
 *
 *   jsx(type, props, key)
 *
 * The third argument is therefore the KEY, not children. Upstream's own code follows that
 * convention everywhere: children live in a `children` property of the props object, and the
 * third argument is a key.
 *
 * The classic convention — `jsx(type, props, children)` — looks natural to write but is
 * silently wrong here: React consumes the children as the key, the element ends up with no
 * children, and it renders as an EMPTY element. No exception is thrown and the chunk still
 * parses, so nothing fails loudly; the UI just loses its text.
 *
 * That is exactly how the first cut of the 0.78.1 marketplace port broke: the chip labels,
 * the 查看全部 group action, the Bot-templates button and the connected-apps entry all rendered
 * with no text, because their children were passed as the third argument.
 *
 * ## The rule
 *
 * A third argument is children — and must be moved into the props object — exactly when:
 *
 *   1. the callee's first argument is a string literal (a DOM element, not a component), and
 *   2. the props object does not already declare a `children` property.
 *
 * Condition 1 keeps component keys alone (`t.jsx(re.Item, {…}, c.key)`), and condition 2 keeps
 * upstream's own keyed DOM elements alone (their props already carry `children:`). Both
 * conditions are checked against upstream 0.18's pristine chunk, which contains three
 * three-argument DOM calls whose props all declare `children:` — none of them is touched.
 *
 * ## Fail-closed
 *
 * The transform parses the source first and re-parses the result. A source that does not parse,
 * or a result that does not parse, throws rather than shipping a broken chunk.
 *
 * @evidence upstream 0.18 `src/app/dist/renderer/assets/view-B5Ug8wEm.js` — the chunk's own
 *   `t.jsx`/`t.jsxs` calls: children in the props object, key as the third argument.
 * @evidence official 0.78.1 `chunk-view-KV06RTpF.js` — the browse chrome this port targets.
 */

import { parse } from "acorn";

/** The chunk's jsx helpers, and the third-argument form the automatic runtime uses. */
function isJsxCall(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "t" &&
    (node.callee.property?.name === "jsx" || node.callee.property?.name === "jsxs")
  );
}

function propsDeclareChildren(propsNode) {
  if (propsNode?.type !== "ObjectExpression") return false;
  return propsNode.properties.some(
    (property) =>
      property.type === "Property" &&
      (property.key?.name === "children" || property.key?.value === "children"),
  );
}

/**
 * Every three-argument call whose third argument is children written the classic way.
 *
 * Returns the offending call sites so a test can assert that none survive.
 */
export function findDomChildrenInThirdArgument(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (isJsxCall(node) && node.arguments.length === 3) {
      const [typeArg, propsArg] = node.arguments;
      if (
        typeArg.type === "Literal" &&
        typeof typeArg.value === "string" &&
        !propsDeclareChildren(propsArg)
      ) {
        found.push({
          start: node.start,
          end: node.end,
          text: source.slice(node.start, node.end),
        });
      }
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object" && value.type) walk(value);
    }
  };
  walk(ast);
  return found;
}

/**
 * Moves every classic-convention third argument into the props object.
 *
 * One call site is rewritten per pass and the source is re-parsed between passes, so a call
 * nested inside another call's children argument is handled from the inside out without the
 * two rewrites overlapping.
 */
export function normalizeJsxChildren(source) {
  let current = source;
  for (let pass = 0; pass < 64; pass += 1) {
    const offenders = findDomChildrenInThirdArgument(current);
    if (offenders.length === 0) return current;
    const target = offenders[0];
    const ast = parse(current, { ecmaVersion: "latest", sourceType: "module" });
    let node = null;
    const walk = (candidate) => {
      if (node || !candidate || typeof candidate !== "object") return;
      if (isJsxCall(candidate) && candidate.arguments.length === 3) {
        const [typeArg, propsArg] = candidate.arguments;
        if (
          typeArg.type === "Literal" &&
          typeof typeArg.value === "string" &&
          !propsDeclareChildren(propsArg) &&
          candidate.start === target.start
        ) {
          node = candidate;
          return;
        }
      }
      for (const key of Object.keys(candidate)) {
        const value = candidate[key];
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object" && value.type) walk(value);
      }
    };
    walk(ast);
    if (!node) throw new Error("normalizeJsxChildren: the offending call site could not be re-found.");
    const [typeArg, propsArg, thirdArg] = node.arguments;
    const calleeText = current.slice(node.callee.start, node.callee.end);
    const typeText = current.slice(typeArg.start, typeArg.end);
    const propsText = current.slice(propsArg.start, propsArg.end);
    const thirdText = current.slice(thirdArg.start, thirdArg.end);
    let inner;
    if (propsArg.type === "ObjectExpression") {
      inner = propsText.slice(1, -1).trim();
      if (inner.endsWith(",")) inner = inner.slice(0, -1).trim();
    } else {
      inner = `...${propsText}`;
    }
    const replacement = `${calleeText}(${typeText},{${inner},children:${thirdText}})`;
    current = current.slice(0, node.start) + replacement + current.slice(node.end);
  }
  throw new Error("normalizeJsxChildren: the rewrite did not converge.");
}
