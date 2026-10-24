import { parse } from "acorn";

const REGISTRY = 'globalThis[Symbol.for("sand.main-core.modules")]';

export function desktopCoreRuntimeSource(code) {
  const ast = parse(code, { ecmaVersion: "latest", sourceType: "script" });
  let registration;
  for (const statement of ast.body) {
    if (statement.type !== "ExpressionStatement" || statement.expression.type !== "AssignmentExpression") continue;
    const { left, right } = statement.expression;
    if (left.type !== "MemberExpression" || left.computed !== true
      || code.slice(left.start, left.end) !== REGISTRY
      || right.type !== "CallExpression"
      || code.slice(right.callee.start, right.callee.end) !== "Object.freeze") continue;
    registration = statement;
  }
  if (registration === undefined) throw new Error("Upstream main-core module registry is missing");
  if (code.indexOf(REGISTRY) !== registration.start) throw new Error("Upstream main-core module registry is ambiguous");
  const strict = code.indexOf('"use strict";');
  if (strict < 0 || strict > registration.start) throw new Error("Upstream main-core strict preamble is missing");
  return code.slice(strict, registration.end);
}
