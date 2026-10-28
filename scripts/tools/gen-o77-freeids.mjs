import { parse } from '/Users/Apple/Documents/grokbot/grok-bot-0.18-reconstructed/node_modules/acorn/dist/acorn.mjs';
import fs from 'node:fs';
function analyze(code) {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const free = new Set();
  function newScope(parent) { return { parent, names: new Set() }; }
  let scope = newScope(null);
  const bind = n => scope.names.add(n);
  const isBound = n => { for (let s = scope; s; s = s.parent) if (s.names.has(n)) return true; return false; };
  const bindPat = p => {
    if (!p) return;
    switch (p.type) {
      case 'Identifier': bind(p.name); break;
      case 'ObjectPattern': p.properties.forEach(pr => bindPat(pr.value || pr.argument)); break;
      case 'ArrayPattern': p.elements.forEach(bindPat); break;
      case 'AssignmentPattern': bindPat(p.left); break;
      case 'RestElement': bindPat(p.argument); break;
    }
  };
  function visitFn(node, inner) {
    if (node.id) bind(node.id.name);   // declaration binds in ENCLOSING scope (hoisting)
    const outer = scope; scope = newScope(outer);
    (node.params || []).forEach(bindPat);
    inner();
    scope = outer;
  }
  function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'VariableDeclaration':
        node.declarations.forEach(d => { visit(d.init); bindPat(d.id); });
        return;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
        visitFn(node, () => { if (node.body) visit(node.body); });
        return;
      case 'ClassDeclaration': case 'ClassExpression': {
        if (node.superClass) visit(node.superClass);
        const outer = scope; scope = newScope(outer);
        if (node.id) bind(node.id.name);
        node.body.body.forEach(m => { if (m.computed) visit(m.key); if (m.value) visit(m.value); });
        scope = outer;
        return;
      }
      case 'BlockStatement': {
        const outer = scope; scope = newScope(outer);
        node.body.forEach(visit);
        scope = outer;
        return;
      }
      case 'Property':
        if (node.computed) visit(node.key);
        visit(node.value);
        return;
      case 'MemberExpression':
        visit(node.object);
        if (node.computed) visit(node.property);
        return;
      case 'Identifier':
        if (!isBound(node.name)) free.add(node.name);
        return;
      case 'CatchClause': {
        const outer = scope; scope = newScope(outer);
        if (node.param) bindPat(node.param);
        visit(node.body);
        scope = outer;
        return;
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'key' || k === 'property' || k === 'label') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && visit(c));
      else if (v && typeof v.type === 'string') visit(v);
    }
  }
  visit(ast);
  return free;
}
const files = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = {};
for (const [name, code] of Object.entries(files)) {
  try { out[name] = [...analyze(code)].sort(); } catch (e) { out[name] = { __error: e.message }; }
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
