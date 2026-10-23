import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { extractUpstreamDeclarations } from "../scripts/lib/upstream-declarations.mjs";

let moduleId = 0;
const load = (code) => import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${moduleId++}`);
const digest = (code) => createHash("sha256").update(code).digest("hex");
const extract = (code, exports, extra = {}) => extractUpstreamDeclarations({ code, exports, strict: true, ...extra });

async function evidence(scenario, data) {
  const directory = process.env.UPSTREAM_DECLARATIONS_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${scenario}.json`), JSON.stringify({
    scenario, invocation: "node --test tests/upstream-declarations.test.mjs",
    node: process.version, passed: true, ...data,
  }, null, 2) + "\n");
}

test("stateful closures share upstream state and omit startup, including sibling initializers", async () => {
  const source = `
const increment = 2, unrelated = forbiddenStartup();
let state = 0;
function makeCounter(seed = increment) {
  let local = seed;
  return {
    next(step = increment) { state += step; local += step; return { local, state }; },
    shadow(increment) { return increment + local; }
  };
}
function unused() { return neverDefined; }
forbiddenStartup();
throw new Error("unrelated startup executed");
`;
  const result = extract(source, { createCounter: "makeCounter" });
  const { createCounter } = await load(result.code);
  const a = createCounter();
  const b = createCounter(20);
  const observed = [a.next(), b.next(3), a.next(), a.shadow(100)];
  assert.deepEqual(observed, [{ local: 4, state: 2 }, { local: 23, state: 5 }, { local: 6, state: 7 }, 106]);
  assert.doesNotMatch(result.code, /forbiddenStartup|neverDefined|function unused/);
  assert.deepEqual(result.provenance.flatMap((item) => item.bindings), ["increment", "state", "makeCounter"]);
  await evidence("stateful-closure", { source, result, observed });
});

test("parameter defaults see outer dependencies, not body var or function declarations", async () => {
  const source = `
const seed = 7;
function helper() { return 11; }
function read(a = seed, b = helper()) {
  var seed = 99;
  function helper() { return 100; }
  return [a, b, seed, helper()];
}
`;
  const result = extract(source, { read: "read" });
  const observed = (await load(result.code)).read();
  assert.deepEqual(observed, [7, 11, 99, 100]);
  await evidence("parameter-default-scopes", { source, result, observed });
});

test("computed keys, nested destructuring defaults, shorthand and named expressions resolve lexically", async () => {
  const source = `
const key = "payload";
const fallback = 5;
const local = poison(), nested = poison(), self = poison(), arguments = poison();
function read({ [key]: { value: local = fallback } = {}, ...rest } = {}, [nested = local] = []) {
  const object = { local, plain: nested, [key]: rest.extra ?? 1 };
  const recur = function self(n) { return n ? self(n - 1) + 1 : arguments.length; };
  return [object.local, object.plain, object[key], recur(2), (() => arguments.length)()];
}
`;
  const result = extract(source, { read: "read" });
  const read = (await load(result.code)).read;
  const observed = [read(), read({ payload: { value: 9 }, extra: 8 }, [4])];
  assert.deepEqual(observed, [[5, 5, 1, 3, 0], [9, 4, 8, 3, 2]]);
  assert.doesNotMatch(result.code, /poison/);
  await evidence("patterns-and-properties", { source, result, observed });
});

test("block, catch, loop, switch and hoisted var scopes do not leak", async () => {
  const source = `
const item = 9, caught = 7, branch = 5, hoisted = poison();
function scopes() {
  const seen = [typeof hoisted];
  for (let item of [1, 2]) seen.push(item);
  try { throw 3; } catch (caught) { seen.push(caught); }
  switch (branch) { case 5: let branch = 8; seen.push(branch); }
  { seen.push(item()); function item() { return 4; } }
  { var hoisted = 6; }
  label: { break label; }
  return [...seen, item, caught, hoisted];
}
`;
  const result = extract(source, { scopes: "scopes" });
  const observed = (await load(result.code)).scopes();
  assert.deepEqual(observed, ["undefined", 1, 2, 3, 8, 4, 9, 7, 6]);
  assert.doesNotMatch(result.code, /poison/);
  await evidence("block-and-var-scopes", { source, result, observed });
});

test("classes retain heritage, private fields, computed methods and isolated static blocks", async () => {
  const source = `
const value = 7, key = "read", Inner = poison();
class Parent { base() { return 2; } }
class Child extends Parent {
  #value = value;
  static { var value = 90; this.tag = value; }
  static { this.other = value; }
  [key]() { return super.base() + this.#value; }
}
const Named = class Inner { static identity() { return Inner; } };
`;
  const result = extract(source, { Child: "Child", Named: "Named" });
  const { Child, Named } = await load(result.code);
  const observed = [new Child().read(), Child.tag, Child.other, Named.identity() === Named];
  assert.deepEqual(observed, [9, 90, 7, true]);
  assert.doesNotMatch(result.code, /poison/);
  await evidence("class-scopes", { source, result, observed });
});

test("ESM retains used default, namespace and named imports while excluding unused imports", async () => {
  const source = `
import pathDefault, { basename as leaf, join } from "node:path";
import * as pathNamespace from "node:path";
import unused from "not-a-real-module";
import "unrelated-side-effect-module";
export const extension = ".csv";
export function inspect(file) {
  return [leaf(file), pathDefault.posix.sep, pathNamespace.extname(file) === extension];
}
`;
  const result = extract(source, { inspectFile: "inspect" });
  const observed = (await load(result.code)).inspectFile("/tmp/data.csv");
  assert.deepEqual(observed, ["data.csv", "/", true]);
  assert.doesNotMatch(result.code, /\bjoin\b|not-a-real-module|unrelated-side-effect-module/);
  await evidence("esm-imports", { source, result, observed });
});

test("CJS var require declarations survive and run with a caller-provided ESM require shim", async () => {
  const source = `
var pathLib = require("node:path"), unused = require("not-a-real-module");
function filename(file) { return pathLib.basename(file); }
module.exports = { filename };
`;
  const result = extract(source, { filename: "filename" });
  const shim = `import { createRequire } from "node:module"; const require = createRequire(${JSON.stringify(import.meta.url)});\n`;
  const observed = (await load(shim + result.code)).filename("/tmp/sample.csv");
  assert.equal(observed, "sample.csv");
  assert.match(result.code, /var pathLib = require\("node:path"\)/);
  assert.doesNotMatch(result.code, /not-a-real-module|module.exports/);
  await evidence("cjs-require", { source, result, shim, observed });
});

test("binding replacements cut original dependencies and retain their own lexical dependencies", async () => {
  const source = `
const factor = 3;
const adapter = bootApplication();
function read(value) { return adapter.read(value) + externalValue; }
`;
  const bindings = { adapter: "({ read: value => value * factor })", externalValue: "4", unused: "missing" };
  const result = extract(source, { run: "read", default: "read" }, { bindings });
  const loaded = await load(result.code);
  const observed = loaded.run(5);
  assert.equal(observed, 19);
  assert.equal(loaded.default, loaded.run);
  assert.doesNotMatch(result.code, /bootApplication|missing/);
  assert.deepEqual(result, extract(source, { default: "read", run: "read" }, {
    bindings: { unused: "missing", externalValue: "4", adapter: bindings.adapter },
  }));
  await evidence("binding-replacements-and-determinism", { source, result, observed });
});

test("unresolved reads and writes are sorted, exposed and rejected in strict mode", async () => {
  const source = `
function inspect(input = fallback) {
  const object = { plain: input, [dynamicKey]: other, shorthand };
  external = object.plain;
  ({ x: assigned, [writeKey]: target.value } = object);
  return [missing, Math.max(1, 2), process.pid, Buffer, require, __filename, __dirname];
}
`;
  const result = extract(source, { inspect: "inspect" }, { strict: false });
  const expected = ["assigned", "dynamicKey", "external", "fallback", "missing", "other", "shorthand", "target", "writeKey"];
  assert.deepEqual(result.unresolved, expected);
  let strictError;
  assert.throws(() => extract(source, { inspect: "inspect" }), (error) => {
    strictError = error.message;
    assert.deepEqual(error.unresolved, expected);
    return /Unresolved identifiers/.test(error.message);
  });
  await evidence("unresolved-and-strict", { source, result, expected, strictError });
});

test("provenance uses exact source text, SHA-256 and half-open UTF-16 offsets", async () => {
  const variable = "value /* untouched */ = 7";
  const declaration = "function read( ) { /* original */ return value; }";
  const source = `// astral prefix: \u{1f680}\nconst ${variable}, unused = startup();\n${declaration}\n`;
  const result = extract(source, { read: "read" });
  assert.equal((await load(result.code)).read(), 7);
  assert.equal(result.inputSha256, digest(source));
  assert.match(result.rangeConvention, /\[start, end\).*UTF-16.*UTF-8/);
  assert.equal(result.provenance.length, 2);
  for (const [index, exact] of [variable, declaration].entries()) {
    const item = result.provenance[index];
    assert.equal(item.start, source.indexOf(exact));
    assert.equal(item.end, source.indexOf(exact) + exact.length);
    assert.equal(source.slice(item.start, item.end), exact);
    assert.equal(item.sha256, digest(exact));
    assert.equal(item.statementSha256, digest(source.slice(item.statementStart, item.statementEnd)));
    assert.ok(result.code.includes(exact));
    assert.notEqual(item.start, Buffer.byteLength(source.slice(0, item.start)));
  }
  const changed = extract(source + "// different input\n", { read: "read" });
  assert.notEqual(changed.inputSha256, result.inputSha256);
  assert.deepEqual(changed.provenance, result.provenance);
  await evidence("source-provenance", { source, result, expectedSlices: [variable, declaration] });
});

test("mutually recursive declarations and destructured bindings execute intact", async () => {
  const source = `
const [one, zero] = [1, 0];
function even(n) { return n === zero || odd(n - one); }
function odd(n) { return n !== zero && even(n - one); }
`;
  const result = extract(source, { even: "even" });
  const { even } = await load(result.code);
  const observed = [even(10), even(11)];
  assert.deepEqual(observed, [true, false]);
  assert.throws(() => extract(source, { even: "even" }, { bindings: { one: "1" } }), /Cannot partially replace shared declaration/);
  await evidence("recursive-dependencies", { source, result, observed, partialReplacementRejected: true });
});

test("fully selected variable and import statements retain exact formatting and comments", async () => {
  const imported = 'import /* keep */ { basename as base, extname as ext } from "node:path";';
  const variables = "let /* first */ a = 2, /* second */ b = 3;";
  const single = "const\n/* declaration comment */ suffix = '.csv';";
  const source = `${imported}\n${variables}\n${single}\nfunction read() { return [base('a.csv'), ext('a.csv') === suffix, a + b]; }`;
  const result = extract(source, { read: "read" });
  for (const declaration of [imported, variables, single]) assert.ok(result.code.includes(declaration));
  const observed = (await load(result.code)).read();
  assert.deepEqual(observed, ["a.csv", true, 5]);
  await evidence("verbatim-complete-statements", { source, result, observed });
});

test("missing roots, ambiguous declarations and invalid replacement expressions fail closed", async () => {
  const cases = [
    [() => extract("const exists = 1;", { missing: "absent" }), /Missing top-level root: absent/],
    [() => extract("function outer() { const nested = 1; }", { nested: "nested" }), /Missing top-level root: nested/],
    [() => extract("var value = 1; var value = 2;", { value: "value" }), /Ambiguous top-level binding: value/],
    [() => extract("const value = 1;", { value: "value" }, { bindings: { value: "1); startup(); (2" } }), /Invalid replacement binding/],
    [() => extract("function read() { with (input) { return value; } }", { read: "read" }), /Cannot resolve lexical references inside with/],
  ];
  const errors = [];
  for (const [run, expected] of cases) {
    assert.throws(run, (error) => { errors.push(error.message); return expected.test(error.message); });
  }
  await evidence("fail-closed-inputs", { errors, rejectedCount: errors.length });
});

test("a synthetic declaration cluster over 100 KB extracts and executes without startup", async () => {
  const count = 1800;
  const declarations = Array.from({ length: count }, (_, i) =>
    `const binding${i} /* preserve this upstream declaration text */ = ${i ? `binding${i - 1} + 1` : "0"};`);
  const source = declarations.join("\n") + "\nthrow new Error('startup must be excluded');";
  assert.ok(source.length > 100_000);
  const result = extract(source, { value: `binding${count - 1}` });
  const observed = (await load(result.code)).value;
  assert.equal(observed, count - 1);
  assert.equal(result.provenance.length, count);
  await evidence("large-synthetic-cluster", { source, result, observed, inputCharacters: source.length });
});

