import type { CanvasDecodedContent } from "../../host/extensions/library/canvas-protocol.js";

export type LibraryCanvasFrameTheme = "light" | "dark";

const colors = {
  light: { background: "#fcfcfc", foreground: "#141414", primary: "#1084fe", status: "#14141499", scrollbar: "#1414144d" },
  dark: { background: "#070707", foreground: "#fcfcfc", primary: "#1084fe", status: "#fcfcfc99", scrollbar: "#fcfcfc4d" },
} as const;

export const LIBRARY_CANVAS_FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob:; sandbox allow-scripts; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const scriptText = (text: string): string =>
  text.replace(/[<>&\u2028\u2029]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);

const escapeTitle = (title: string): string => title.replace(/[&<>\"]/g, (character) => `&#${character.charCodeAt(0)};`);

export function renderLibraryCanvasFrameHtml(
  content: CanvasDecodedContent,
  theme: LibraryCanvasFrameTheme,
  title: string,
): string {
  const c = colors[theme];
  const state = JSON.stringify({ kind: theme, primary: c.primary, editorBackground: c.background, editorForeground: c.foreground });
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${escapeTitle(title)}</title><style>
*{margin:0;padding:0;box-sizing:border-box;scrollbar-width:thin;scrollbar-color:${c.scrollbar} transparent}
html{height:100%;padding-top:var(--cursor-canvas-top-inset,0px);scroll-padding-top:var(--cursor-canvas-top-inset,0px)}
html,body{width:100%;min-height:100%;background:${c.background}}
body{padding:24px var(--cursor-canvas-gutter,32px);color:${c.foreground};font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:13px;line-height:18px;overflow-x:hidden}
#root{position:relative;width:100%;max-width:calc(var(--cursor-canvas-content-column,100vw) - 2*var(--cursor-canvas-gutter,32px));margin-inline:auto;min-height:calc(100vh - 48px - var(--cursor-canvas-top-inset,0px) - var(--cursor-canvas-bottom-inset,0px));overflow-x:auto;--cursor-canvas-viewport-height:calc(100vh - 48px - var(--cursor-canvas-top-inset,0px) - var(--cursor-canvas-bottom-inset,0px))}
#root>:only-child:is([style^="height:100%;"],[style^="height: 100%;"],[style*=";height:100%;"],[style*="; height: 100%;"]){min-height:var(--cursor-canvas-viewport-height)!important}
body::after{content:"";display:block;height:var(--cursor-canvas-bottom-inset,0px)}
::-webkit-scrollbar{width:8px;height:8px;background:transparent}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}::-webkit-scrollbar-thumb{background:${c.scrollbar};border-radius:4px}::-webkit-scrollbar-thumb:hover{background:${c.foreground}}
#status{display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 48px - var(--cursor-canvas-top-inset,0px) - var(--cursor-canvas-bottom-inset,0px));color:${c.status};font:13px system-ui}
@media(max-width:479.98px){body{padding:16px var(--cursor-canvas-gutter,16px)}#root{min-height:calc(100vh - 32px);--cursor-canvas-viewport-height:calc(100vh - 32px);max-width:calc(var(--cursor-canvas-content-column,100vw) - 2*var(--cursor-canvas-gutter,16px))}#status{min-height:calc(100vh - 32px)}}
:root{--cursor-canvas-focus-ring-width:1px;--cursor-canvas-focus-ring-offset:2px;--cursor-canvas-focus-ring-radius:4px}*:focus,*:focus-visible{outline:none}*:focus-visible{outline:var(--cursor-canvas-focus-ring-width) solid var(--cursor-canvas-focus-ring-color,currentColor);outline-offset:var(--cursor-canvas-focus-ring-offset)}:where(a[href],[role="link"]):focus-visible{border-radius:var(--cursor-canvas-focus-ring-radius)}
</style></head><body><div id="root"><div id="status">Loading canvas</div></div>
<script>
window.__sandCanvasShowError=function(){var root=document.getElementById('root');if(root)root.innerHTML='<div id="status">Canvas failed to load</div>'};
try{var dataJson=JSON.parse(${scriptText(JSON.stringify(content.dataJsonText))});
if(!dataJson||typeof dataJson!=='object'||Array.isArray(dataJson))throw new Error();
window.__cursorCanvas={tokenParam:'',state:new Map([['theme',${state}]]),data:new Map(Object.entries(dataJson)),reportError:window.__sandCanvasShowError};
window.__sandCanvasBundle=${scriptText(content.bundleJsonText)};
}catch{window.__sandCanvasShowError()}
</script><script type="module">
async function mount(){var bundle=window.__sandCanvasBundle;if(!bundle)return;var runtimeUrl=URL.createObjectURL(new Blob([bundle.runtimeEsm],{type:'text/javascript'}));try{var runtimeModule=await import(runtimeUrl);var userUrl=URL.createObjectURL(new Blob([bundle.userModule],{type:'text/javascript'}));try{await runtimeModule.mountCanvas(userUrl)}finally{URL.revokeObjectURL(userUrl)}}finally{URL.revokeObjectURL(runtimeUrl)}}
mount().catch(window.__sandCanvasShowError);
</script><script>
addEventListener('keydown',function(e){if(e.key==='Escape')parent.postMessage({type:'cursor-canvas-frame-close-request'},'*')},true);
addEventListener('message',function(e){if(e.source!==parent||!e.data)return;if(e.data.type==='cursor-canvas-frame-scroll-to-top'){scrollTo(0,0);return}if(e.data.type!=='cursor-canvas-frame-content-column')return;
for(var pair of [['columnWidthPx','--cursor-canvas-content-column'],['gutterPx','--cursor-canvas-gutter'],['topInsetPx','--cursor-canvas-top-inset'],['bottomInsetPx','--cursor-canvas-bottom-inset']]){var v=e.data[pair[0]],s=document.documentElement.style;if(typeof v==='number'&&(pair[0]==='columnWidthPx'?v>0:v>=0))s.setProperty(pair[1],v+'px');else s.removeProperty(pair[1])}});
</script></body></html>`;
}
