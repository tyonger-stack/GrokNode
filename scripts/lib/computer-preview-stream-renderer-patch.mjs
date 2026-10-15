import { parse } from "acorn";

export function patchComputerPreviewStream(source) {
  if (source.includes("RCompPreviewPoolBase")) throw new Error("Preview-stream patch was already applied.");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const pools = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id?.name === "dbn");
  if (pools.length !== 1) throw new Error("Preview-stream patch: expected the shipped dbn pool function.");
  const pool = pools[0];
  const frames = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id?.name === "_bn");
  const fullscreen = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id?.name === "bbn");
  const frame = frames[0];
  const agentBinding = frame?.params[0]?.properties?.find(property => (property.key.name ?? property.key.value) === "agentId")?.value;
  const fullscreenAgentBinding = fullscreen[0]?.params[0]?.properties?.find(property => (property.key.name ?? property.key.value) === "agentId")?.value;
  if (frames.length !== 1 || fullscreen.length !== 1 || agentBinding?.type !== "Identifier" || fullscreenAgentBinding?.type !== "Identifier") throw new Error("Preview-stream patch: native Bot owner components drifted.");
  const frameNodes = [frame.body];
  const frameObjects = [];
  while (frameNodes.length) {
    const node = frameNodes.pop();
    if (node.type === "ObjectExpression" && node.properties.some(property => property.type === "Property" && (property.key.name ?? property.key.value) === "className" && (property.value.value === "sand-computer-preview__frame" || property.value.arguments?.[0]?.value === "sand-computer-preview__frame"))) frameObjects.push(node);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) frameNodes.push(...child.filter(item => item && typeof item.type === "string"));
      else if (child && typeof child.type === "string") frameNodes.push(child);
    }
  }
  if (frameObjects.length !== 1) throw new Error("Preview-stream patch: native preview frame identity anchor drifted.");
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
      var agentId=${reactAlias}.useContext(RCompPreviewOwnerContext());
      var snapshot=${reactAlias}.useCallback(function(){return RCompPreviewSnapshot(agentId)},[agentId]);
      var paused=${reactAlias}.useSyncExternalStore(RCompPreviewSubscribe,snapshot);
      return paused&&(props.isInteractive!==true||props.isViewerVisible===false)?null:${reactAlias}.createElement(RCompVncViewBase,{...props,ref});
    });
  })()`;
  const edits = [
    { start: pool.id.start, end: pool.id.end, text: "RCompPreviewPoolBase" },
    { start: viewer.start, end: viewer.end, text: viewerWrapper },
    { start: frame.id.start, end: frame.id.end, text: "RCompPreviewFrameBase" },
    { start: fullscreen[0].id.start, end: fullscreen[0].id.end, text: "RCompFullscreenBase" },
    { start: frameObjects[0].start + 1, end: frameObjects[0].start + 1, text: `"data-preview-bot-id":${agentBinding.name},` },
  ].sort((a, b) => b.start - a.start);
  let renamed = source;
  for (const edit of edits) renamed = renamed.slice(0, edit.start) + edit.text + renamed.slice(edit.end);
  return renamed + `
function RCompPreviewSubscribe(listener){
  window.addEventListener('grok-node-preview-stream-state',listener);
  return function(){window.removeEventListener('grok-node-preview-stream-state',listener)};
}
function RCompPreviewOwnerContext(){
  if(!window.__rCompPreviewOwnerContext)window.__rCompPreviewOwnerContext=${reactAlias}.createContext(null);
  return window.__rCompPreviewOwnerContext;
}
function RCompPreviewSnapshot(agentId){return window.__rCompPreviewPausedBots?.has(agentId)===true}
function _bn(props){return ${reactAlias}.createElement(RCompPreviewOwnerContext().Provider,{value:props.agentId},${reactAlias}.createElement(RCompPreviewFrameBase,{...props,key:props.agentId}))}
function bbn(props){return ${reactAlias}.createElement(RCompPreviewOwnerContext().Provider,{value:props.agentId},${reactAlias}.createElement(RCompFullscreenBase,{...props,key:props.agentId}))}
function dbn(props){
  var agentId=${reactAlias}.useContext(RCompPreviewOwnerContext());
  var snapshot=${reactAlias}.useCallback(function(){return RCompPreviewSnapshot(agentId)},[agentId]);
  var paused=${reactAlias}.useSyncExternalStore(RCompPreviewSubscribe,snapshot);
  ${reactAlias}.useLayoutEffect(function(){
    if(props.isInteractive!==true)window.dispatchEvent(new Event('grok-node-preview-stream-mounted'));
  },[agentId,paused,props.isInteractive,props.src]);
  return paused&&props.isInteractive!==true
    ?${jsxAlias}.jsx('div',{className:${JSON.stringify(rootClasses[0])},'data-preview-stream-paused':'true'})
    :${reactAlias}.createElement(RCompPreviewPoolBase,{...props,key:agentId});
}
`;
}
