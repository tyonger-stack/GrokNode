import assert from "node:assert/strict";
import { parseExpressionAt } from "acorn";

const walk = (node, visit) => {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(child => walk(child, visit)); else if (value && typeof value === "object") walk(value, visit);
};
export function groupHostFunction(source, name) {
  const anchor = `function ${name}(`;
  const found = source.indexOf(anchor);
  assert(found >= 0 && source.indexOf(anchor, found + 1) < 0, "Group host function missing or ambiguous: " + name);
  const start = source.slice(found - 6, found) === "async " ? found - 6 : found;
  const node = parseExpressionAt(source, start, { ecmaVersion: "latest" });
  return { node, text: source.slice(node.start, node.end) };
}
export function patchGroupRosterHost(source) {
  const minimal = groupHostFunction(source, "minimalAgentSummary"), summary = groupHostFunction(source, "buildSummary");
  const result = minimal.node.body.body.find(node => node.type === "ReturnStatement" && node.argument.type === "ObjectExpression").argument;
  const field = name => result.properties.find(prop => prop.type === "Property" && (prop.key.name ?? prop.key.value) === name);
  const isGroup = field("isGroup"), members = field("memberIds");
  assert(isGroup && members, "Group summary fields missing");
  if (isGroup.value.type !== "Literal" || isGroup.value.value !== false) {
    assert(minimal.text.includes("readSandGroupConfig("), "Unexpected group identity projection");
    assert(summary.text.includes("base.isGroup") && summary.text.includes("base.memberIds"), "Source group fallback missing");
    return { source, changed: false };
  }
  let directory;
  walk(minimal.node, node => {
    if (node.type === "CallExpression" && node.callee.name === "getSandProfilePath") directory = source.slice(node.arguments[0].start, node.arguments[0].end);
  });
  assert(directory, "Summary directory expression missing");
  const edits = [
    { start: minimal.node.body.start + 1, end: minimal.node.body.start + 1, text: `\nconst groupProjection0755=readSandGroupConfig(${directory});` },
    { start: isGroup.value.start, end: isGroup.value.end, text: "groupProjection0755!=null" },
    { start: members.start, end: members.end, text: "memberIds:groupProjection0755?.memberIds??[],...(groupProjection0755?.remoteMembers==null?{}:{remoteMembers:groupProjection0755.remoteMembers})" },
  ];
  let groupFallbacks = 0, memberFallbacks = 0;
  walk(summary.node, node => {
    if (node.type === "BinaryExpression" && node.operator === "===" && source.slice(node.left.start, node.left.end) === "args.isGroup" && node.right.value === true) {
      edits.push({ start: node.start, end: node.end, text: "args.isGroup??base.isGroup" }); groupFallbacks++;
    }
    if (node.type === "LogicalExpression" && node.operator === "??" && source.slice(node.left.start, node.left.end) === "args.memberIds" && node.right.type === "ArrayExpression" && node.right.elements.length === 0) {
      edits.push({ start: node.start, end: node.end, text: "args.memberIds??base.memberIds" }); memberFallbacks++;
    }
  });
  assert.equal(groupFallbacks, 1); assert.equal(memberFallbacks, 1);
  let patched = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) patched = patched.slice(0, edit.start) + edit.text + patched.slice(edit.end);
  groupHostFunction(patched, "minimalAgentSummary"); groupHostFunction(patched, "buildSummary");
  return { source: patched, changed: true };
}
