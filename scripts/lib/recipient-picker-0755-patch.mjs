import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import official from "./recipient-picker-0755-official.json" with { type: "json" };

const parseModule = source => parse(source, { ecmaVersion: "latest", sourceType: "module" });
const prefix = source => source.replace(/\bsand-([a-z0-9]+)(?![\w-])/g, "rrp0755-sand-$1");
const once = (source, before, after) => {
  assert.equal(source.split(before).length, 2, "Recipient picker anchor missing or ambiguous: " + before.slice(0, 90));
  return source.replace(before, after);
};
const walk = (node, visit) => {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(child => walk(child, visit)); else if (value && typeof value === "object") walk(value, visit);
};
const replaceNodes = (source, edits) => edits.sort((a, b) => b.start - a.start).reduce((result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end), source);
export function portCode(source, bindings, namespace = "rrp0755") {
  const edits = [];
  const visit = (node, parent, field) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier" && bindings[node.name]) {
      const memberKey = parent?.type === "MemberExpression" && field === "property" && !parent.computed;
      const propertyKey = parent?.type === "Property" && field === "key" && !parent.computed;
      if (!memberKey && !propertyKey) {
        const text = parent?.type === "Property" && parent.shorthand && field === "value" ? node.name + ":" + bindings[node.name] : bindings[node.name];
        edits.push({ start: node.start, end: node.end, text });
      }
    }
    for (const [key, value] of Object.entries(node)) if (Array.isArray(value)) value.forEach(child => visit(child, node, key)); else if (value && typeof value === "object") visit(value, node, key);
  };
  visit(parseModule(source), null, null);
  return replaceNodes(source, edits).replace(/\bsand-([a-z0-9]+)(?![\w-])/g, namespace + "-sand-$1");
}
function botResultsOnly(source) {
  const edits = [];
  walk(parseModule(source), node => {
    if (!["IfStatement", "ConditionalExpression"].includes(node.type)) return;
    if (!/\.kind===`human`$/.test(source.slice(node.test.start, node.test.end))) return;
    assert(node.alternate, "Human branch has no supported alternative");
    edits.push({ start: node.start, end: node.end, text: source.slice(node.alternate.start, node.alternate.end) });
  });
  return replaceNodes(source, edits);
}

const sharedBindings = { P: "RRPCache", F: "RRPJSX", ge: "RRPUseI18n", k: "RRPStyle", z: "RRPStyles", h: "RRPType", o: "RRPJoin", mt: "RRPRow", it: "RRPResultLabel", at: "RRPRowHint", ht: "RRPPreventDefault", d: "RRPAvatar", ue: "RRPIcon", me: "RRPKeyCap", Me: "RRPShortcutLimit", Pe: "RRPModifier", i: "RRPAgentName" };
let row = botResultsOnly(official.functions.mt);
row = once(row, "(0,F.jsxs)(ft,{agent:ie,children:[ae,oe]})", "(0,F.jsxs)(`span`,{...k(z.rowName,h.body2),children:[ae,oe]})");
const rowCode = portCode([row, botResultsOnly(official.functions.it), botResultsOnly(official.functions.at), official.functions.ht].join("\n"), sharedBindings);
const chipBaseCode = portCode(`const RRPChipMarker=${official.memberChip.marker};const RRPChipStyles=${official.memberChip.styles};${official.memberChip.function}`, { d: "RRPChipBase", s: "RRPCache", c: "RRPJSX", n: "RRPJoin", o: "RRPStyle", r: "RRPType", i: "RRPWeights", e: "RRPIcon", l: "RRPChipMarker", u: "RRPChipStyles" });
const chipCode = portCode(botResultsOnly(official.functions.$e), { $e: "RRPRecipientChip", P: "RRPCache", F: "RRPJSX", ge: "RRPUseI18n", pe: "RRPIdAvatar", s: "RRPPlusIcon", O: "RRPAvatarSizes", T: "RRPRecipientLabel", j: "RRPChipBase", z: "RRPStyles" });
const nameCode = portCode(Object.entries(official.nameMessages).map(([name, value]) => `const ${name}=${value};`).join("\n") + Object.entries(official.names).map(([name, code]) => name === "O0" ? botResultsOnly(code) : code).join("\n"), { O0: "RRPRecipientLabel", hk: "RRPAgentName", Fp: "RRPDisplayName", Ur: "RRPGlobalI18n", bde: "RRPNameDisk", vde: "RRPNameNew", yde: "RRPNameTeam" });
const layout = Object.fromEntries(Object.entries(official.layout).map(([key, value]) => [key, prefix(value)]));

export const RECIPIENT_PICKER_0755_COMPONENTS = `
const RRPCatalogs=JSON.parse(${JSON.stringify(JSON.stringify(official.messages))});
const RRPThemes=${JSON.stringify(official.themes)};
const RRPStyles=${prefix(official.styles)};
const RRPShortcutLimit=9;
const RRPJSX=p,RRPCache=he,RRPStyle=Fe,RRPJoin=re,RRPType=Ut,RRPIcon=Dr,RRPAvatar=ml,RRPIdAvatar=hme,RRPPlusIcon=au,RRPAvatarSizes=Jj,RRPWeights=RSM0753Yb,RRPKeyCap=RSM0753PC,RRPModifier=_4n;
function RRPMessage(message){const en=RSMCatalogText(RRPCatalogs.en[message.id],message.values),zh=RSMCatalogText(RRPCatalogs.zh[message.id],message.values);return RLocT(en,zh||en)}
function RRPUseI18n(){return{_:RRPMessage}}
const RRPGlobalI18n={_:RRPMessage};
function RRPPalette(){const theme=typeof document==='undefined'?'dark':document.querySelector('.sand-shell')?.dataset.theme??'dark';return RRPThemes[theme.includes('light')?'light':'dark']}
${nameCode}
${rowCode}
${chipBaseCode}
${chipCode}
`;

export function patchRecipientPicker0755(source) {
  assert(!source.includes("function RRPRow("), "Recipient picker patch already applied");
  assert(source.includes("function RSMCatalogText("), "Official search-menu bridge is required");
  const owner = parseModule(source).body.find(node => node.type === "FunctionDeclaration" && node.id.name === "L4n");
  assert(owner, "Pinned recipient controller missing");
  let code = source.slice(owner.start, owner.end);
  code = once(code, "Fe(kQ.input,Ut.body1)", "Fe(RRPStyles.input,Ut.body1)");
  code = once(code, "Fe(kQ.toLabel,Ut.body1)", "Fe(RRPStyles.toLabel,Ut.body1)");
  code = once(code, "Fe(kQ.emptyState,Ut.body2)", "Fe(RRPStyles.emptyState,Ut.body2)");
  code = once(code, "p.jsx(j4n,{", "p.jsx(RRPRecipientChip,{");
  code = once(code, "p.jsx(R4n,{", "p.jsx(RRPRow,{isGroupCompose:RSMGroupActive||s.length>0,isRecipientSelected:s.length>0,setSize:E.length,");
  const edits = [], counts = { placeholder: 0, label: 0, bar: 0, menu: 0, close: 0, list: 0, chips: 0, footer: 0 };
  walk(parseModule(code), node => {
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "re" && node.arguments[0]?.value === "sand-new-chat-bar") {
      edits.push({ start: node.start, end: node.end, text: `re("sand-new-chat-bar",${JSON.stringify(layout.bar)})` }); counts.bar++;
    }
    if (node.type === "AssignmentExpression" && node.left.type === "Identifier" && node.left.name === "ke" && node.right.type === "ConditionalExpression") {
      assert(code.slice(node.right.start, node.right.end).includes("Add or create another Bot"));
      edits.push({ start: node.right.start, end: node.right.end, text: 'RRPMessage({id:"pa8w8y"})' }); counts.placeholder++;
    }
    if (node.type === "AssignmentExpression" && node.left.type === "Identifier" && node.left.name === "ve" && node.right.type === "Literal" && node.right.value === "Search or create Bots") {
      edits.push({ start: node.right.start, end: node.right.end, text: 'RRPMessage({id:"pa8w8y"})' }); counts.label++;
    }
    if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.object.name !== "p" || !["jsx", "jsxs"].includes(node.callee.property.name)) return;
    const [type, props] = node.arguments;
    if (props?.type !== "ObjectExpression") return;
    const prop = name => props.properties.find(prop => prop.type === "Property" && (prop.key.name ?? prop.key.value) === name);
    const className = prop("className"), children = prop("children"), role = prop("role");
    const namedClass = className?.value.type === "CallExpression" && className.value.arguments[0]?.type === "Literal" ? className.value.arguments[0].value : null;
    const kind = { "sand-new-chat-bar": "bar", "sand-new-chat-menu": "menu", "sand-new-chat-bar__close": "close" }[namedClass];
    if (kind) {
      edits.push({ start: className.value.start, end: className.value.end, text: `re(${JSON.stringify(namedClass)},${JSON.stringify(layout[kind])})` }); counts[kind]++;
      if (kind === "menu") {
        assert(children.value.type === "ArrayExpression" && children.value.elements.length === 3);
        const list = children.value.elements[0];
        edits.push({ start: children.value.start, end: children.value.end, text: "[" + code.slice(list.start, list.end).replace(/className:"[^"]+",id:x,role:"listbox"/, `className:${JSON.stringify(layout.list)},id:x,role:"listbox"`) + "]" }); counts.footer++; counts.list++;
      }
    }
    if (role?.value.value === "listbox") assert(children, "Recipient list children missing");
    if (type?.value === "span" && children?.value.type === "CallExpression" && children.value.callee.type === "MemberExpression" && children.value.callee.property.name === "map" && code.slice(children.value.start, children.value.end).includes("RRPRecipientChip")) {
      edits.push({ start: node.start, end: node.end, text: code.slice(children.value.start, children.value.end) }); counts.chips++;
    }
  });
  for (const name of ["placeholder", "label", "bar", "menu", "close", "chips", "footer", "list"]) assert.equal(counts[name], 1, "Recipient picker " + name);
  code = replaceNodes(code, edits);
  code = once(code, "children:[Je,Ce,we,Pe,je]", `children:[Je,p.jsxs("div",{className:${JSON.stringify(layout.chipContainer)},children:[Ce,we]}),Pe,je]`);
  code = once(code, "className:ye,onBlur:ue", "className:ye,style:RRPPalette(),onBlur:ue");
  const conditionalEdits = [];
  walk(parseModule(code), node => {
    if (node.type === "ConditionalExpression" && code.slice(node.test.start, node.test.end) === "s.length>0" && code.slice(node.consequent.start, node.consequent.end).includes("sand-new-chat-bar__close")) conditionalEdits.push({ start: node.start, end: node.end, text: code.slice(node.consequent.start, node.consequent.end) });
  });
  assert.equal(conditionalEdits.length, 1, "Recipient picker close-button condition");
  code = replaceNodes(code, conditionalEdits);
  let result = source.slice(0, owner.start) + code + source.slice(owner.end) + RECIPIENT_PICKER_0755_COMPONENTS;
  result = once(result, "de=y&&U4n(v,n.currentAgentId)", "de=y&&!RSMGroupActive&&U4n(v,n.currentAgentId)");
  parseModule(result);
  return result;
}

const hash = source => createHash("sha256").update(source).digest("hex");
export async function applyRecipientPicker0755Patch({ stageRoot }) {
  const file = "dist/renderer/assets/index-UbX-y3il.js", stylesheet = "dist/renderer/assets/index-lCyB53CO.css";
  const source = await readFile(path.join(stageRoot, file), "utf8"), css = await readFile(path.join(stageRoot, stylesheet), "utf8");
  const patched = patchRecipientPicker0755(source), patchedCss = css + "\n" + official.css;
  await writeFile(path.join(stageRoot, file), patched);
  await writeFile(path.join(stageRoot, stylesheet), patchedCss);
  const record = { mode: "official-recipient-picker-0755", reference: official.reference, officialSourceSha256: official.sourceSha256, officialChipSha256: official.chipSha256, features: ["official-recipient-rows", "official-member-chips", "official-placeholder", "group-row-hint", "no-legacy-keyboard-footer"], adaptations: ["legacy Bot/new-Bot result union", "existing Bot controller and launch contract", "plain name branch for private Bots"], files: [{ path: file, originalSha256: hash(source), patchedSha256: hash(patched) }, { path: stylesheet, originalSha256: hash(css), patchedSha256: hash(patchedCss) }] };
  record.features.push("no-single-chat-preview-in-group-compose");
  await writeFile(path.join(stageRoot, "dist/renderer-recipient-picker-0755-extension.json"), JSON.stringify(record, null, 2) + "\n");
  return record;
}
