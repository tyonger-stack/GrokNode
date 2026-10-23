const ENTRY = 'ys=Hn?null:p.jsx(s0n,{onOpenPlugins:ae})';
const CHILDREN = 'children:[yi,ki,Yr,Zr,wi,ai,ys,Vs,hr]';
export function patchAccountFooter0753(source) {
  for (const anchor of [ENTRY, CHILDREN]) {
    if (source.split(anchor).length !== 2) throw new Error(`0.75.3 account footer requires exactly one anchor: ${anchor}`);
  }
  return source.replace(CHILDREN, 'children:[yi,ki,Yr,Zr,wi,ai,p.jsxs("div",{className:"sand-footer-0753",children:[Vs,ys]}),hr]');
}
