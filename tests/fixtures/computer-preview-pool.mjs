export const VNC_VIEW_FIXTURE = `
var DAe=S.forwardRef(function(props,ref){return p.jsx(VncSession,{...props,ref})});
`;

export const PREVIEW_POOL_FIXTURE = VNC_VIEW_FIXTURE + `
function dbn(n){
  const [sources]=S.useState(()=>[n.src,n.src+"/warm"]);
  return p.jsx("div",{className:re("sand-box-vnc-pool","sand-10l6tqk sand-10a8y8t"),children:sources.map(src=>p.jsx(DAe,{src,isInteractive:n.isInteractive},src))});
}
`;
