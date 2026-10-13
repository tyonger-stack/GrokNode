import { parse } from "acorn";

export function patchComputerPreviewStream(source) {
  if (source.includes("RCompPreviewPoolBase")) throw new Error("Preview-stream patch was already applied.");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const pools = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id?.name === "dbn");
  if (pools.length !== 1) throw new Error("Preview-stream patch: expected the shipped dbn pool function.");
  const pool = pools[0];
  const pending = [pool.body];
  const rootClasses = [];
  let reactAlias;
  let jsxAlias;
  while (pending.length) {
    const node = pending.pop();
    if (node.type === "CallExpression") {
      if (node.arguments[0]?.value === "sand-box-vnc-pool" && node.arguments.length === 2 && typeof node.arguments[1]?.value === "string") rootClasses.push(node.arguments.map(arg => arg.value).join(" "));
      const callee = node.callee;
      if (callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier") {
        if (callee.property.name === "useState") reactAlias = callee.object.name;
        if (callee.property.name === "jsx") jsxAlias = callee.object.name;
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) pending.push(...child.filter(item => item && typeof item.type === "string"));
      else if (child && typeof child.type === "string") pending.push(child);
    }
  }
  if (rootClasses.length !== 1 || !reactAlias || !jsxAlias) throw new Error("Preview-stream patch: native pool classes or React aliases drifted.");
  const viewers = ast.body.filter(node => node.type === "VariableDeclaration").flatMap(node => node.declarations).filter(node => node.id.type === "Identifier" && node.id.name === "DAe");
  const viewer = viewers[0]?.init;
  if (viewers.length !== 1 || viewer?.type !== "CallExpression" || viewer.callee.type !== "MemberExpression" || viewer.callee.computed || viewer.callee.object.name !== reactAlias || viewer.callee.property.name !== "forwardRef") throw new Error("Preview-stream patch: expected the shipped DAe forwardRef viewer.");
  const viewerWrapper = `(function(){
    const RCompVncViewBase=${source.slice(viewer.start, viewer.end)};
    return ${reactAlias}.forwardRef(function(props,ref){
      var paused=${reactAlias}.useSyncExternalStore(RCompPreviewSubscribe,RCompPreviewSnapshot);
      return paused&&(props.isInteractive!==true||props.isViewerVisible===false)?null:${reactAlias}.createElement(RCompVncViewBase,{...props,ref});
    });
  })()`;
  const edits = [
    { start: pool.id.start, end: pool.id.end, text: "RCompPreviewPoolBase" },
    { start: viewer.start, end: viewer.end, text: viewerWrapper },
  ].sort((a, b) => b.start - a.start);
  let renamed = source;
  for (const edit of edits) renamed = renamed.slice(0, edit.start) + edit.text + renamed.slice(edit.end);
  return renamed + `
function RCompPreviewSubscribe(listener){
  window.addEventListener('grok-node-preview-stream-state',listener);
  return function(){window.removeEventListener('grok-node-preview-stream-state',listener)};
}
function RCompPreviewSnapshot(){return window.__rCompPreviewAsleep===true}
function dbn(props){
  var paused=${reactAlias}.useSyncExternalStore(RCompPreviewSubscribe,RCompPreviewSnapshot);
  ${reactAlias}.useLayoutEffect(function(){
    if(paused&&props.isInteractive!==true)window.dispatchEvent(new Event('grok-node-preview-stream-mounted'));
  },[paused,props.isInteractive,props.src]);
  return paused&&props.isInteractive!==true
    ?${jsxAlias}.jsx('div',{className:${JSON.stringify(rootClasses[0])},'data-preview-stream-paused':'true'})
    :${reactAlias}.createElement(RCompPreviewPoolBase,props);
}
`;
}
