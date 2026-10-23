import { createHash } from "node:crypto";
import { parse } from "acorn";
import { base, recursive } from "acorn-walk";

const GLOBALS = new Set(`
  globalThis Infinity NaN undefined eval isFinite isNaN parseFloat parseInt
  decodeURI decodeURIComponent encodeURI encodeURIComponent escape unescape
  Object Function Boolean Symbol Error AggregateError EvalError RangeError
  ReferenceError SyntaxError TypeError URIError Number BigInt Math Date String
  RegExp Array Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array
  Int32Array Uint32Array Float16Array Float32Array Float64Array BigInt64Array
  BigUint64Array Map Set WeakMap WeakSet ArrayBuffer SharedArrayBuffer DataView
  Atomics JSON WeakRef FinalizationRegistry Iterator AsyncIterator Promise
  Reflect Proxy Intl WebAssembly DisposableStack AsyncDisposableStack SuppressedError
  console setTimeout clearTimeout setInterval clearInterval setImmediate
  clearImmediate queueMicrotask structuredClone URL URLSearchParams TextEncoder
  TextDecoder AbortController AbortSignal require process Buffer __filename __dirname
`.trim().split(/\s+/));

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const scope = (parent = null, varBoundary = false) => ({ parent, varBoundary, names: new Set() });

function pattern(node, onName, onExpression) {
  if (!node) return;
  switch (node.type) {
    case "Identifier": onName(node); break;
    case "RestElement": pattern(node.argument, onName, onExpression); break;
    case "AssignmentPattern":
      pattern(node.left, onName, onExpression);
      onExpression(node.right);
      break;
    case "ArrayPattern":
      for (const item of node.elements) pattern(item, onName, onExpression);
      break;
    case "ObjectPattern":
      for (const item of node.properties) {
        if (item.type === "RestElement") pattern(item.argument, onName, onExpression);
        else {
          if (item.computed) onExpression(item.key);
          pattern(item.value, onName, onExpression);
        }
      }
      break;
    case "MemberExpression": onExpression(node); break;
    default: throw new Error(`Unsupported binding pattern: ${node.type}`);
  }
}

function bindingNames(node) {
  const names = [];
  pattern(node, (id) => names.push(id.name), () => {});
  return names;
}

function freeReferences(node) {
  const references = [];
  const bind = (node, target, current, visit) => pattern(
    node, (id) => target.names.add(id.name), (expression) => visit(expression, current),
  );
  const visitors = {
    Identifier(node, current) { references.push({ name: node.name, scope: current }); },
    Pattern(node, current, visit) {
      pattern(node, (id) => visit(id, current), (expression) => visit(expression, current));
    },
    VariableDeclaration(node, current, visit) {
      let target = current;
      if (node.kind === "var") while (!target.varBoundary) target = target.parent;
      for (const declaration of node.declarations) {
        bind(declaration.id, target, current, visit);
        if (declaration.init) visit(declaration.init, current);
      }
    },
    Function(node, current, visit) {
      if (node.type === "FunctionDeclaration") current.names.add(node.id.name);
      const named = scope(current);
      if (node.type === "FunctionExpression" && node.id) named.names.add(node.id.name);
      const parameters = scope(named);
      if (node.type !== "ArrowFunctionExpression") parameters.names.add("arguments");
      for (const parameter of node.params) bind(parameter, parameters, parameters, visit);
      // Body var/function declarations must not shadow references in parameter defaults.
      const body = scope(parameters, true);
      if (node.body.type === "BlockStatement") {
        for (const statement of node.body.body) visit(statement, body);
      } else visit(node.body, body);
    },
    Class(node, current, visit) {
      if (node.type === "ClassDeclaration") current.names.add(node.id.name);
      const inner = scope(current);
      if (node.id) inner.names.add(node.id.name);
      if (node.superClass) visit(node.superClass, inner);
      visit(node.body, inner);
    },
    BlockStatement(node, current, visit) { base.BlockStatement(node, scope(current), visit); },
    StaticBlock(node, current, visit) { base.StaticBlock(node, scope(current, true), visit); },
    CatchClause(node, current, visit) {
      const inner = scope(current);
      bind(node.param, inner, inner, visit);
      visit(node.body, inner);
    },
    ForStatement(node, current, visit) { base.ForStatement(node, scope(current), visit); },
    ForInStatement(node, current, visit) { base.ForInStatement(node, scope(current), visit); },
    ForOfStatement(node, current, visit) { base.ForOfStatement(node, scope(current), visit); },
    SwitchStatement(node, current, visit) {
      visit(node.discriminant, current);
      const inner = scope(current);
      for (const branch of node.cases) visit(branch, inner);
    },
    WithStatement() { throw new Error("Cannot resolve lexical references inside with"); },
  };
  recursive(node, scope(null, true), visitors);
  return [...new Set(references.filter((reference) => {
    for (let current = reference.scope; current; current = current.parent) {
      if (current.names.has(reference.name)) return false;
    }
    return true;
  }).map(({ name }) => name))].sort();
}

function parseSource(code) {
  try { return parse(code, { ecmaVersion: "latest", sourceType: "module" }); }
  catch {
    return parse(code, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
  }
}

function indexDeclarations(ast, code) {
  const index = new Map();
  function add(node, statement, names, text, analysisNode) {
    const unit = { node, statement, names, text, analysisNode };
    for (const name of names) {
      if (!index.has(name)) index.set(name, []);
      index.get(name).push(unit);
    }
  }
  for (const statement of ast.body) {
    const node = statement.type.startsWith("Export") ? statement.declaration : statement;
    if (!node) continue;
    if (node.type === "VariableDeclaration") {
      for (const declaration of node.declarations) {
        add(declaration, node, bindingNames(declaration.id),
          `${node.kind} ${code.slice(declaration.start, declaration.end)};`,
          { ...node, declarations: [declaration] });
      }
    } else if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) {
      add(node, node, [node.id.name], code.slice(node.start, node.end), node);
    } else if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        const original = code.slice(specifier.start, specifier.end);
        const clause = specifier.type === "ImportSpecifier" ? `{ ${original} }` : original;
        add(specifier, node, [specifier.local.name],
          `import ${clause} from ${code.slice(node.source.start, node.end)};`, null);
      }
    }
  }
  return index;
}

function entries(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a name-to-string object`);
  }
  return Object.keys(value).sort().map((key) => {
    if (typeof value[key] !== "string") throw new TypeError(`${label}.${key} must be a string`);
    return [key, value[key]];
  });
}

/**
 * Select top-level declarations and their lexical dependency closure as ESM.
 * Variable declarators and import specifiers are atomic source units; only their
 * declaration/import wrappers and export aliases are generated. Destructuring
 * stays intact. Replacements cut the original dependency edge and emit consts.
 * Ranges are half-open [start, end) in JS string characters (UTF-16 code units),
 * not byte offsets. SHA-256 hashes cover the UTF-8 encoding of exact source slices.
 * strict rejects unresolved identifiers; it does not validate dynamic lookup or
 * initialization performed by excluded statements. CJS globals need a caller shim
 * when the output executes as ESM. Relative imports keep their original location.
 */
export function extractUpstreamDeclarations({ code, exports: requested, bindings = {}, strict = false }) {
  if (typeof code !== "string") throw new TypeError("code must be a string");
  const roots = entries(requested, "exports");
  const overrides = entries(bindings, "bindings");
  const ast = parseSource(code);
  const index = indexDeclarations(ast, code);
  const replacements = new Map();
  for (const [name, expression] of overrides) {
    const text = `const ${name} = (${expression}\n);`;
    const parsed = parse(text, { ecmaVersion: "latest", sourceType: "module" });
    const node = parsed.body[0];
    if (parsed.body.length !== 1 || node.type !== "VariableDeclaration" ||
        node.declarations.length !== 1 || node.declarations[0].id.type !== "Identifier" ||
        node.declarations[0].id.name !== name) {
      throw new Error(`Invalid replacement binding: ${name}`);
    }
    replacements.set(name, { names: [name], text, analysisNode: node, replacement: true,
      start: index.get(name)?.[0].node.start ?? -1 });
  }
  for (const [, name] of roots) {
    if (!index.has(name)) throw new Error(`Missing top-level root: ${name}`);
  }
  const selected = new Set();
  const unresolved = new Set();
  const queue = roots.map(([, name]) => name);
  for (let i = 0; i < queue.length; i++) {
    const name = queue[i];
    const candidates = index.get(name);
    if (!replacements.has(name) && candidates?.length > 1) {
      throw new Error(`Ambiguous top-level binding: ${name}`);
    }
    const unit = replacements.get(name) ?? candidates?.[0];
    if (!unit) {
      if (!GLOBALS.has(name)) unresolved.add(name);
      continue;
    }
    if (selected.has(unit)) continue;
    if (!unit.replacement && unit.names.some((name) => replacements.has(name))) {
      throw new Error(`Cannot partially replace shared declaration: ${unit.names.join(", ")}`);
    }
    selected.add(unit);
    if (unit.analysisNode) queue.push(...freeReferences(unit.analysisNode));
  }
  const missing = [...unresolved].sort();
  if (strict && missing.length) {
    const error = new Error(`Unresolved identifiers: ${missing.join(", ")}`);
    error.unresolved = missing;
    throw error;
  }
  const units = [...selected].sort((a, b) => {
    const position = (a.start ?? a.node.start) - (b.start ?? b.node.start);
    if (position) return position;
    return a.names[0] < b.names[0] ? -1 : a.names[0] > b.names[0] ? 1 : 0;
  });
  const statementCounts = new Map();
  for (const { statement } of units) {
    if (statement) statementCounts.set(statement, (statementCounts.get(statement) ?? 0) + 1);
  }
  const emittedStatements = new Set();
  const fragments = [];
  for (const { statement, text } of units) {
    const members = statement?.declarations ?? statement?.specifiers;
    if (members && statementCounts.get(statement) === members.length) {
      if (!emittedStatements.has(statement)) fragments.push(code.slice(statement.start, statement.end));
      emittedStatements.add(statement);
    } else fragments.push(text);
  }
  const aliases = roots.map(([publicName, name]) => `${name} as ${JSON.stringify(publicName)}`);
  const output = [...fragments, `export { ${aliases.join(", ")} };`, ""].join("\n");
  parse(output, { ecmaVersion: "latest", sourceType: "module" });
  return {
    code: output,
    unresolved: missing,
    inputSha256: sha256(code),
    rangeConvention: "[start, end) in JavaScript UTF-16 code units; SHA-256 over UTF-8 source text",
    provenance: units.filter((unit) => !unit.replacement).map(({ node, statement, names }) => ({
      kind: node.type, bindings: names, start: node.start, end: node.end,
      sha256: sha256(code.slice(node.start, node.end)),
      statementStart: statement.start, statementEnd: statement.end,
      statementSha256: sha256(code.slice(statement.start, statement.end)),
    })),
    replacements: units.filter((unit) => unit.replacement).map(({ names }) => names[0]),
  };
}

