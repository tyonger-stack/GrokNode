export const VNC_VIEW_FIXTURE = `
var DAe=S.forwardRef(function(props,ref){return p.jsx(VncSession,{...props,ref})});
`;

export const PREVIEW_OWNER_FIXTURE = `
function _bn({agentId,src}){return p.jsxs("div",{className:"sand-computer-preview__frame",children:[p.jsx(dbn,{src}),p.jsx("button",{className:"sand-computer-preview__open",children:p.jsxs("span",{children:[p.jsx("i",{"data-icon-name":"arrows-expand-simple"}),"打开"]})})]})}
function bbn({agentId,children}){return children}
`;

export const PREVIEW_POOL_FIXTURE = VNC_VIEW_FIXTURE + PREVIEW_OWNER_FIXTURE + `
function dbn(n){
  const [sources]=S.useState(()=>[n.src,n.src+"/warm"]);
  return p.jsx("div",{className:re("sand-box-vnc-pool","sand-10l6tqk sand-10a8y8t"),children:sources.map(src=>p.jsx(DAe,{src,isInteractive:n.isInteractive},src))});
}
`;
