import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { closeLibraryDom } from "./library-dom-teardown.mjs";

const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;
globalThis.Node = window.Node;

test.after(async () => {
  await closeLibraryDom(window);
});

const engine = await import("../frontend/src/recovered/features/conversation/workspace/pele-engine/chunk-lazy-D8SAdX1p.js");

test("the shipped 0.75.0 pele engine draws an info diagram", async () => {
  const source = "info\ntitle Hello from Pele\n";
  const type = engine.detectType(source);
  assert.equal(type, "info");
  assert.equal(await engine.load(type), true);
  const rendered = engine.render(source, { idPrefix: "sand-pele-test", images: false, links: false });
  assert.match(rendered.svg, /<svg/);
  assert.match(rendered.svg, /pele-/);
  assert.match(rendered.svg, /Hello from Pele/);
});

test("sankey, venn, wardley, and c4 draw shipped pele markup", async () => {
  const samples = [
    ["sankey-beta\nA,B,10\n", "pele-sankey"],
    ["venn-beta\ntitle Venn\nset A [\"A\"]\nset B [\"B\"]\nunion A,B [\"both\"]\n", "pele-venn"],
    ["wardley-beta\ntitle Example\nanchor Business [0.95, 0.63]\ncomponent Cup [0.79, 0.61]\nBusiness->Cup\n", "pele-wardley"],
    ["C4Context\ntitle System Context\nPerson(customer, \"Customer\")\nSystem(system, \"System\")\nRel(customer, system, \"Uses\")\n", "pele-c4"],
  ];
  for (const [source, marker] of samples) {
    const type = engine.detectType(source);
    assert.equal(typeof type, "string", source);
    assert.equal(await engine.load(type), true, source);
    const rendered = engine.render(source, { idPrefix: marker, images: false, links: false });
    assert.match(rendered.svg, /<svg/);
    assert.match(rendered.svg, new RegExp(marker));
  }
});
