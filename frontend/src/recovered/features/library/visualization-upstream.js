// Exact 0.72.1 declaration closures. Ranges and hashes are recorded in visualization-upstream.provenance.json.
export function frameDeclarations(ports) {
const document = (globalThis.document
);
const window = (globalThis.window
);
const r = (ports.IconButton
);
const i = (ports.useModal
);
const a = (ports.portalRoot
);
const o = (ports.noDrag
);
const s = (ports.contentHeight
);
const c = (ports.useFocus
);
const l = (ports.Text
);
const u = (ports.classNames
);
const d = (ports.useStrings
);
const p = (ports.stylex
);
const h = (Object.freeze({type:"visualization-pointer-left"})
);
function _(e,t){let n=e.ownerDocument.createElement(`iframe`);return n.setAttribute(`sandbox`,`allow-scripts`),n.setAttribute(`scrolling`,`no`),n.className=t.className,n.title=t.title,n.src=t.frameUrl,e.append(n),n}
function y(e){let t=s(e.heightPx);return{height:t,maxHeight:t}}
const x = (ports.compiler
);
const S = (ports.React
);
const C = (ports.ReactDOM
);
const w = (ports.jsx
);
var T={stage:{kVAEAm:`sand-ixxii4`,kpwlN0:`sand-10a8y8t`,kY2c9j:`sand-fo81ep`,k1xSpc:`sand-78zum5`,kXwgrk:`sand-dt5ytf`,kGNEyG:`sand-6s0dn4`,kLKAdn:`sand-laft8j`,kGO01o:`sand-x6bls6`,kg3NbH:`sand-j7an9n`,kWkggS:`sand-jzgna8`,kkrTdU:`sand-zuqxi3`,$$css:!0},close:{kzqmXN:`sand-1td3qas`,kZKoxP:`sand-10w6t97`,kMzoRj:`sand-qjedn3`,ksu8eU:`sand-1y0btm7`,kVAM5u:`sand-1a3s9uc`,kMwMTN:`sand-omkthv`,kWkggS:`sand-nrswvp sand-1li8a54`,$$css:!0},frameSlot:(e,t)=>[{kzqmXN:e==null?e:`sand-5lhr3w`,kZKoxP:t==null?t:`sand-16ye13r`,$$css:!0},{"--x-width":(e=>typeof e==`number`?e+`px`:e??void 0)(e),"--x-height":(e=>typeof e==`number`?e+`px`:e??void 0)(t)}]};
function E(e){e.stopPropagation(),e.preventDefault()}
function D(e){D.d=501;let t=(0,x.c)(51),{title:n,frameSize:s,attachFrameSlot:f,onMeasure:m,onClose:h}=e,{_:g}=d(),_;t[0]===Symbol.for(`react.memo_cache_sentinel`)?(_={modal:!0},t[0]=_):_=t[0];let v=i(_),y=c(v.isTop),b;t[1]===h?b=t[2]:(b=()=>h,t[1]=h,t[2]=b);let[O]=(0,S.useState)(b),k;t[3]!==O||t[4]!==v||t[5]!==y?(k=e=>{y.contain(e);let t=e=>{e.key===`Escape`&&v.isTop()&&(e.preventDefault(),e.stopPropagation(),O())};return document.addEventListener(`keydown`,t,!0),()=>document.removeEventListener(`keydown`,t,!0)},t[3]=O,t[4]=v,t[5]=y,t[6]=k):k=t[6];let A=k,j;t[7]===m?j=t[8]:(j=e=>{let t=()=>{m({widthPx:Math.max(0,e.clientWidth-48),heightPx:Math.max(0,e.clientHeight-48)})};return t(),window.addEventListener(`resize`,t),()=>window.removeEventListener(`resize`,t)},t[7]=m,t[8]=j);let M=j,N;t[9]===O?N=t[10]:(N=e=>{e.button!==0||e.ctrlKey||e.altKey||e.target===e.currentTarget&&O()},t[9]=O,t[10]=N);let P=N,F,I,L,R,z;t[11]!==v.ariaModal||t[12]!==n?(F=p(T.stage,o.noDrag),z=C.createPortal,I=n,L=v.ariaModal,R=u(`sand-visualization-lightbox`,F.className),t[11]=v.ariaModal,t[12]=n,t[13]=F,t[14]=I,t[15]=L,t[16]=R,t[17]=z):(F=t[13],I=t[14],L=t[15],R=t[16],z=t[17]);let B=F.style,V;t[18]===Symbol.for(`react.memo_cache_sentinel`)?(V=u(`sand-visualization-lightbox__top-bar`,{className:`sand-10l6tqk sand-htitgo sand-1tk7jg1 sand-9j5i9 sand-78zum5 sand-6s0dn4 sand-167g77z`}.className),t[18]=V):V=t[18];let H;t[19]===g?H=t[20]:(H=g({id:`OIVo2D`}),t[19]=g,t[20]=H);let U;t[21]!==O||t[22]!==H?(U=(0,w.jsx)(`div`,{className:V,children:(0,w.jsx)(r,{"aria-label":H,className:`sand-visualization-lightbox__close`,icon:`close`,iconSize:`xl`,onClick:O,shape:`circle`,style:T.close,variant:`secondary`})}),t[21]=O,t[22]=H,t[23]=U):U=t[23];let W;t[24]===Symbol.for(`react.memo_cache_sentinel`)?(W={className:`sand-78zum5 sand-kh2ocl sand-1iyjqo2 sand-s83m0k sand-1r8uery sand-2lwn1j sand-ysyzu8`},t[24]=W):W=t[24];let G;t[25]===Symbol.for(`react.memo_cache_sentinel`)?(G=u(`sand-visualization-lightbox__card`,{className:`sand-2lah0s sand-1bpp3o7 sand-ggk2y7 sand-hojbe8 sand-10e981r sand-anlk42 sand-t0e3qv`}.className),t[25]=G):G=t[25];let K;t[26]!==f||t[27]!==s?(K=s===null?null:(0,w.jsx)(`div`,{ref:f,...p(T.frameSlot(s.widthPx,s.heightPx))}),t[26]=f,t[27]=s,t[28]=K):K=t[28];let q;t[29]===K?q=t[30]:(q=(0,w.jsx)(`div`,{className:G,children:K}),t[29]=K,t[30]=q);let J;t[31]!==M||t[32]!==P||t[33]!==q?(J=(0,w.jsx)(`div`,{...W,onClick:P,ref:M,children:q}),t[31]=M,t[32]=P,t[33]=q,t[34]=J):J=t[34];let Y;t[35]===Symbol.for(`react.memo_cache_sentinel`)?(Y=u(`sand-visualization-lightbox__caption`,{className:`sand-2lah0s sand-1rhet7l sand-jb2dyf sand-25j84s sand-1wtyyt3 sand-2b8uid sand-104kibb sand-1ua5tub sand-1h7i4cw sand-b3r6kr`}.className),t[35]=Y):Y=t[35];let X;t[36]===n?X=t[37]:(X=(0,w.jsx)(l,{className:Y,dir:`auto`,level:`label`,children:n}),t[36]=n,t[37]=X);let Z;t[38]!==A||t[39]!==P||t[40]!==F.style||t[41]!==U||t[42]!==J||t[43]!==X||t[44]!==I||t[45]!==L||t[46]!==R?(Z=(0,w.jsxs)(`div`,{"aria-label":I,"aria-modal":L,className:R,onClick:P,onContextMenu:E,ref:A,role:`dialog`,style:B,children:[U,J,X]}),t[38]=A,t[39]=P,t[40]=F.style,t[41]=U,t[42]=J,t[43]=X,t[44]=I,t[45]=L,t[46]=R,t[47]=Z):Z=t[47];let Q;return t[48]!==Z||t[49]!==z?(Q=z(Z,a()),t[48]=Z,t[49]=z,t[50]=Q):Q=t[50],Q}
function O(e,t){let n=e.ownerDocument,r=n=>{n.target!==e&&(i(),t(),e.contentWindow?.postMessage(h,`*`))},i=()=>n.removeEventListener(`pointermove`,r,!0);return{arm:()=>n.addEventListener(`pointermove`,r,!0),dispose:i}}
return {attach: _,bounds: y,pointerRelease: O,Stage: D};

}
export function heightDeclarations(ports) {
const ri = (ports.debounce
);
function L9e(e){return e+40}
function R9e(e){return Math.max(0,e-40)}
var qin=ri({name:`frame-height-shrink-hold`,delayMs:400});
function Jin(e){let t=e.appliedHeightPx,n=null,r=()=>{n?.dispose(),n=null},i=n=>{t=n,e.apply(n)},a=e=>{r(),e!==t&&i(e)};return{report:e=>{if(t!==void 0&&e<t){n??=qin.wrap(e=>{n=null,i(e)}),n(e);return}a(e)},dispose:r}}
return {height: L9e,contentHeight: R9e,controller: Jin};

}
export function viewerDeclarations(ports) {
const t = (ports.useEffect
);
const n = (ports.useEvent
);
const r = (ports.Text
);
const o = (ports.assert
);
const s = (ports.useStore
);
const c = (ports.useSession
);
const l = (ports.controller
);
const u = (ports.useThemeTokens
);
const ee = (ports.useTheme
);
const d = (ports.height
);
const te = (ports.usePanel
);
const ne = (ports.useStrings
);
const re = (ports.runtime.isVisualizationThemeVariables
);
const ie = (ports.runtime.parseVisualizationFrameMessage
);
const m = (ports.runtime.visualizationBoundsMessage
);
const ae = (ports.attach
);
const oe = (ports.Stage
);
const h = (ports.bounds
);
const se = (ports.pointerRelease
);
const g = (ports.compiler
);
const _ = (ports.React
);
const v = (ports.ReactDOM
);
const y = (ports.jsx
);
var ce={className:`sand-jbqb8w sand-c342km sand-1lliihq sand-h8yej3 sand-5yr21d`}.className??``;
function b(e,t){let n=h(t);e.contentWindow?.postMessage(m(n),`*`)}
function x(e){x.d=572;let r=(0,g.c)(70),{agentId:i,visual:a,page:f,onClose:p}=e,m=f===void 0?null:f,{_:h}=ne(),w=c(i),T=ee().resolved===`dark`?`dark`:`light`,E=u(),D=E.variables[T];o(re(D),`the ${T} Sand theme lacks a variable visualization frames read`);let O;r[0]!==i||r[1]!==w||r[2]!==T||r[3]!==D||r[4]!==a.documentSha256||r[5]!==a.entryId||r[6]!==a.heightPx||r[7]!==a.title||r[8]!==E.typography?(O={agentId:i,entryId:a.entryId,sessionId:w,documentSha256:a.documentSha256,title:a.title,heightPx:a.heightPx,theme:T,themeVariables:D,typography:E.typography},r[0]=i,r[1]=w,r[2]=T,r[3]=D,r[4]=a.documentSha256,r[5]=a.entryId,r[6]=a.heightPx,r[7]=a.title,r[8]=E.typography,r[9]=O):O=r[9];let k=O,A=te(k),j=s(),M;r[10]!==k||r[11]!==j?(M=()=>j.frame(k).retain(),r[10]=k,r[11]=j,r[12]=M):M=r[12],t(M);let N;r[13]===a.heightPx?N=r[14]:(N=a.heightPx===void 0?void 0:d(a.heightPx),r[13]=a.heightPx,r[14]=N);let P=N,F;r[15]!==i||r[16]!==P||r[17]!==w||r[18]!==a.entryId||r[19]!==j?(F=()=>P??j.lockedFrameHeight({agentId:i,sessionId:w,entryId:a.entryId})??360,r[15]=i,r[16]=P,r[17]=w,r[18]=a.entryId,r[19]=j,r[20]=F):F=r[20];let[I,fe]=(0,_.useState)(F),[L,pe]=(0,_.useState)(null),[R,z]=(0,_.useState)(null),B=(0,_.useRef)(null),V;r[21]===Symbol.for(`react.memo_cache_sentinel`)?(V=e=>{pe(e),B.current!==null&&b(B.current,e)},r[21]=V):V=r[21];let H=n(V),U;r[22]===Symbol.for(`react.memo_cache_sentinel`)?(U=e=>(z(e),()=>z(null)),r[22]=U):U=r[22];let W=n(U),G=m?.box??null,K=(0,_.useRef)(null),q;r[23]===G?q=r[24]:(q=()=>{let e=B.current;return G===null||e===null||K.current===G?de:(K.current=G,b(e,G),ue)},r[23]=G,r[24]=q),t(q);let J;r[25]!==L||r[26]!==G?(J=e=>{let t=G??L;t!==null&&b(e,t)},r[25]=L,r[26]=G,r[27]=J):J=r[27];let Y=n(J),X;r[28]!==I||r[29]!==p||r[30]!==Y||r[31]!==a.title?(X=(e,t)=>{let n=ae(e,{frameUrl:t.frameUrl,title:a.title,className:ce}),r=l({appliedHeightPx:I,apply:fe}),i=se(n,le),o=e.ownerDocument.defaultView,s=()=>Y(n),c=e=>{if(e.source==null||e.source!==n.contentWindow)return;let t=ie(e.data);t?.kind===`height`?r.report(d(t.contentHeightPx)):t?.kind===`escape`?p():(t?.kind===`hover`||t?.kind===`engaged`)&&i.arm()};return n.addEventListener(`load`,s),o?.addEventListener(`message`,c),B.current=n,()=>{B.current=null,n.removeEventListener(`load`,s),o?.removeEventListener(`message`,c),i.dispose(),r.dispose(),n.remove()}},r[28]=I,r[29]=p,r[30]=Y,r[31]=a.title,r[32]=X):X=r[32];let Z=n(X),Q,$;if(r[33]!==h||r[34]!==Z||r[35]!==W||r[36]!==P||r[37]!==A||r[38]!==I||r[39]!==L||r[40]!==H||r[41]!==p||r[42]!==m||r[43]!==R||r[44]!==a.title){$=Symbol.for(`react.early_return_sentinel`);bb0:{let e;r[47]===Z?e=r[48]:(e=e=>(0,y.jsx)(S,{attach:Z,frame:e},e.frameUrl),r[47]=Z,r[48]=e);let t;r[49]===h?t=r[50]:(t=h({id:`apIP6y`}),r[49]=h,r[50]=t);let n;r[51]===t?n=r[52]:(n=(0,y.jsx)(C,{text:t}),r[51]=t,r[52]=n);let i;r[53]===h?i=r[54]:(i=h({id:`LS/Xap`}),r[53]=h,r[54]=i);let o;r[55]===h?o=r[56]:(o=h({id:`BgNTlp`}),r[55]=h,r[56]=o);let s;r[57]!==i||r[58]!==o?(s=(0,y.jsx)(C,{detail:i,text:o}),r[57]=i,r[58]=o,r[59]=s):s=r[59];let c=A.panel({value:e,loading:null,empty:n,unavailable:s});if(m!==null){$=(0,v.createPortal)(c,m.element);break bb0}let l;r[60]!==P||r[61]!==I||r[62]!==L?(l=L===null?null:{widthPx:L.widthPx,heightPx:Math.max(P??0,I)},r[60]=P,r[61]=I,r[62]=L,r[63]=l):l=r[63];let u;r[64]!==W||r[65]!==H||r[66]!==p||r[67]!==l||r[68]!==a.title?(u=(0,y.jsx)(oe,{attachFrameSlot:W,frameSize:l,onClose:p,onMeasure:H,title:a.title}),r[64]=W,r[65]=H,r[66]=p,r[67]=l,r[68]=a.title,r[69]=u):u=r[69],Q=(0,y.jsxs)(y.Fragment,{children:[u,R===null?null:(0,v.createPortal)(c,R)]})}r[33]=h,r[34]=Z,r[35]=W,r[36]=P,r[37]=A,r[38]=I,r[39]=L,r[40]=H,r[41]=p,r[42]=m,r[43]=R,r[44]=a.title,r[45]=Q,r[46]=$}else Q=r[45],$=r[46];return $===Symbol.for(`react.early_return_sentinel`)?Q:$}
function le(){}
function ue(){}
function de(){}
function S(e){S.d=570;let t=(0,g.c)(6),{frame:r,attach:i}=e,a;t[0]!==i||t[1]!==r?(a=e=>i(e,r),t[0]=i,t[1]=r,t[2]=a):a=t[2];let o=n(a),s;t[3]===Symbol.for(`react.memo_cache_sentinel`)?(s={className:`sand-h8yej3 sand-5yr21d`},t[3]=s):s=t[3];let c;return t[4]===o?c=t[5]:(c=(0,y.jsx)(`div`,{ref:o,...s}),t[4]=o,t[5]=c),c}
function C(e){C.d=571;let t=(0,g.c)(8),{text:n,detail:i}=e,a;t[0]===Symbol.for(`react.memo_cache_sentinel`)?(a={className:`sand-78zum5 sand-dt5ytf sand-6s0dn4 sand-l56j7k sand-195vfkc sand-5yr21d sand-2b8uid`},t[0]=a):a=t[0];let o;t[1]===n?o=t[2]:(o=(0,y.jsx)(r,{color:`tertiary`,size:`sm`,children:n}),t[1]=n,t[2]=o);let s;t[3]===i?s=t[4]:(s=i==null?null:(0,y.jsx)(r,{color:`tertiary`,size:`xs`,children:i}),t[3]=i,t[4]=s);let c;return t[5]!==o||t[6]!==s?(c=(0,y.jsxs)(`div`,{...a,children:[o,s]}),t[5]=o,t[6]=s,t[7]=c):c=t[7],c}
return {Viewer: x};

}
export function rowDeclarations(ports) {
const Y = (ports.jsx
);
const Z = (ports.compiler
);
const tC = (ports.Icon
);
const nI = (ports.Row
);
const WUt = (ports.formatAge
);
function NGt(e){NGt.d=569;let t=(0,Z.c)(6),{visual:n,nowMs:r,onOpen:i}=e,a=WUt(n.timestampMs,r),o;t[0]===Symbol.for(`react.memo_cache_sentinel`)?(o=(0,Y.jsx)(`span`,{className:`sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-vy4d1p sand-xk0z11`,children:(0,Y.jsx)(tC,{name:`chart-line`,size:`lg`})}),t[0]=o):o=t[0];let s;return t[1]!==a||t[2]!==i||t[3]!==n.key||t[4]!==n.title?(s=(0,Y.jsx)(nI,{end:`none`,hoverAge:a,label:n.title,lead:o,onOpen:i,paneKey:n.key,title:n.title,tooltip:n.title}),t[1]=a,t[2]=i,t[3]=n.key,t[4]=n.title,t[5]=s):s=t[5],s}
return {Row: NGt};

}
export function themeDeclarations(ports) {
const Gr = (ports.assert
);
function OAe(e){return jAe[e.appearance]}
var gx={"bg/scrim":50,"bg/scrim-heavy":89.7,"bg/hover":6,"bg/active":8,"bg/primary-disabled":15,"bg/secondary":6,"bg/secondary-hover":10,"bg/secondary-active":18,"bg/secondary-disabled":4,"bg/tertiary":6,"bg/quaternary":4,"fill/bubble-agent":6,"fill/bubble-user":100,"fill/attachment-card":0,"fill/attachment-paper":0,"fill/attachment-ink":18,"text/secondary":68,"text/tertiary":56,"text/quaternary":40,"icon/primary":92,"icon/secondary":66,"icon/tertiary":52,"icon/quaternary":32,"border/primary-translucent":24,"border/secondary-translucent":12,"border/tertiary-translucent":8,"border/quaternary-translucent":6,"border/attachment-card":8,"border/attachment-paper":12,"shadow/control":12,"shadow/card":3.5,"shadow/secondary":7,"shadow/inline/ambient":8,"shadow/inline/key":6,"shadow/popover/ambient":10,"shadow/popover/key":10,"shadow/modal/ambient":10,"shadow/modal/key":10,"shadow/window/ambient":56,"shadow/window/edge":10,"shadow/ring":.4,"bg/{role}-primary-disabled":17,"bg/{role}-secondary":9,"bg/{role}-secondary-hover":17,"bg/{role}-secondary-disabled":6.1,"text/{role}-quaternary":13,"text/accent-quaternary":17,"text/danger-quaternary":17,"border/{role}-quaternary":17},kAe={"bg/scrim":69.7,"bg/scrim-heavy":95,"bg/hover":6,"bg/active":8,"bg/primary-disabled":13,"bg/secondary":4,"bg/secondary-hover":8,"bg/secondary-active":20,"bg/secondary-disabled":2,"bg/tertiary":4,"bg/quaternary":2,"fill/bubble-agent":4,"fill/bubble-user":18,"fill/attachment-card":3,"fill/attachment-paper":10,"fill/attachment-ink":24,"text/secondary":66,"text/tertiary":54,"text/quaternary":38,"icon/primary":90,"icon/secondary":64,"icon/tertiary":50,"icon/quaternary":30,"border/primary-translucent":22,"border/secondary-translucent":10,"border/tertiary-translucent":6,"border/quaternary-translucent":4,"border/attachment-card":12,"border/attachment-paper":16,"shadow/control":0,"shadow/card":0,"shadow/secondary":0,"shadow/inline/ambient":0,"shadow/inline/key":0,"shadow/popover/ambient":0,"shadow/popover/key":0,"shadow/modal/ambient":0,"shadow/modal/key":0,"shadow/window/ambient":0,"shadow/window/edge":0,"shadow/ring":0,"bg/{role}-primary-disabled":15,"bg/{role}-secondary":7,"bg/{role}-secondary-hover":15,"bg/{role}-secondary-disabled":4.1,"text/{role}-quaternary":11,"text/accent-quaternary":15,"text/danger-quaternary":15,"border/{role}-quaternary":15},AAe=Object.keys(gx).filter(e=>Object.hasOwn(gx,e)),jAe={light:gx,dark:kAe},MAe={light:{"neutral/0":`#ffffff`,"neutral/1":`#ffffff`,"neutral/2":`#fcfcfc`,"neutral/3":`#f5f5f5`,"neutral/4":`#363636`,"neutral/5":`#1c1c1c`,"neutral/6":`#525252`,"red/0":`#fb2b3e`,"red/1":`#e72e3b`,"red/2":`#c82532`,"red/3":`#cd2834`,"red/4":`#ad1f2a`,"red/5":`#8e1921`,"red/6":`#6f1017`,"red/7":`#ab1e29`,"orange/0":`#fd690f`,"orange/1":`#ee620d`,"orange/2":`#d2550a`,"orange/3":`#c14c00`,"orange/4":`#a23f00`,"orange/5":`#843200`,"orange/6":`#682600`,"orange/7":`#b64907`,"yellow/0":`#f59312`,"yellow/1":`#da830e`,"yellow/2":`#c2730b`,"yellow/3":`#aa6300`,"yellow/4":`#905300`,"yellow/5":`#774400`,"yellow/6":`#5f3500`,"yellow/7":`#aa6409`,"green/0":`#14c16f`,"green/1":`#10ab61`,"green/2":`#0d9655`,"green/3":`#00854a`,"green/4":`#00723e`,"green/5":`#005f33`,"green/6":`#004b27`,"green/7":`#098249`,"cyan/0":`#13b7a2`,"cyan/1":`#10a693`,"cyan/2":`#0d9381`,"cyan/3":`#008273`,"cyan/4":`#007062`,"cyan/5":`#005d51`,"cyan/6":`#004c42`,"cyan/7":`#0a7f70`,"blue/0":`#1e86fc`,"blue/1":`#1680f3`,"blue/2":`#126fd4`,"blue/3":`#0b6dd3`,"blue/4":`#085ab2`,"blue/5":`#054991`,"blue/6":`#033872`,"blue/7":`#0d5eb6`,"purple/0":`#8f59f9`,"purple/1":`#8351e4`,"purple/2":`#7442d1`,"purple/3":`#7547d0`,"purple/4":`#623aae`,"purple/5":`#4f2e8e`,"purple/6":`#3d2270`,"purple/7":`#6539b7`,"magenta/0":`#f93498`,"magenta/1":`#e52f8b`,"magenta/2":`#c82779`,"magenta/3":`#c62378`,"magenta/4":`#a71c63`,"magenta/5":`#881551`,"magenta/6":`#6c0e3e`,"magenta/7":`#ab2067`,"brown/0":`#a06b39`,"brown/1":`#9d6937`,"brown/2":`#86592e`,"brown/3":`#996b42`,"brown/4":`#835a34`,"brown/5":`#6f4b2b`,"brown/6":`#5a3c21`,"brown/7":`#714a25`},dark:{"neutral/0":`#1f1f1f`,"neutral/1":`#161616`,"neutral/2":`#121212`,"neutral/3":`#0e0e0e`,"neutral/4":`#dbdbdb`,"neutral/5":`#f5f5f5`,"neutral/6":`#c1c1c1`,"red/0":`#fc2c3e`,"red/1":`#cf2b35`,"red/2":`#f73643`,"red/3":`#ff6463`,"red/4":`#ff908b`,"red/5":`#ffb3ae`,"red/6":`#ffd2cf`,"red/7":`#a8222a`,"orange/0":`#f9670e`,"orange/1":`#cd5309`,"orange/2":`#f4650e`,"orange/3":`#fe6600`,"orange/4":`#ff9464`,"orange/5":`#ffb696`,"orange/6":`#ffd3c1`,"orange/7":`#a84306`,"yellow/0":`#f69412`,"yellow/1":`#c8770c`,"yellow/2":`#ea8c10`,"yellow/3":`#e28600`,"yellow/4":`#fb9500`,"yellow/5":`#ffb670`,"yellow/6":`#ffd6b0`,"yellow/7":`#a76308`,"green/0":`#14c370`,"green/1":`#0e9f5a`,"green/2":`#13bb6b`,"green/3":`#00ba69`,"green/4":`#29cb78`,"green/5":`#7fdca1`,"green/6":`#b8eac7`,"green/7":`#0a844a`,"cyan/0":`#13b8a3`,"cyan/1":`#0e9886`,"cyan/2":`#12b39f`,"cyan/3":`#00b7a2`,"cyan/4":`#59c8b5`,"cyan/5":`#8dd8c9`,"cyan/6":`#bce8de`,"cyan/7":`#097d6e`,"blue/0":`#1884fc`,"blue/1":`#116dd2`,"blue/2":`#1784fb`,"blue/3":`#4d9bff`,"blue/4":`#7cb5ff`,"blue/5":`#a3caff`,"blue/6":`#c8dfff`,"blue/7":`#0c58aa`,"purple/0":`#905afb`,"purple/1":`#7845d7`,"purple/2":`#8e59f8`,"purple/3":`#a582ff`,"purple/4":`#bba5ff`,"purple/5":`#cdbfff`,"purple/6":`#e0d8ff`,"purple/7":`#6036af`,"magenta/0":`#fb3499`,"magenta/1":`#cf297e`,"magenta/2":`#f63397`,"magenta/3":`#ff55a4`,"magenta/4":`#ff8ab9`,"magenta/5":`#ffafcd`,"magenta/6":`#ffcfe0`,"magenta/7":`#aa2066`,"brown/0":`#a16b39`,"brown/1":`#8c5d31`,"brown/2":`#aa723d`,"brown/3":`#c59e7d`,"brown/4":`#ccb39d`,"brown/5":`#dac7b7`,"brown/6":`#e8ddd3`,"brown/7":`#704925`}},NAe=[`base`,`baseHover`,`pane`,`chrome`,`sidebar`,`elevated`,`onPrimary`,`focus`],PAe=[`accent`,`danger`,`success`,`warn`],_x=[`red`,`orange`,`yellow`,`green`,`cyan`,`blue`,`purple`,`magenta`,`brown`],vx=[...PAe,..._x],FAe=[`Fill`,`FillHover`,`FillPressed`,`FillBright`,`Foreground`,`ForegroundHover`,`ForegroundBright`],IAe=[`Fill`,`FillHover`,`FillBright`,`Foreground`,`ForegroundBright`];
function yx(e){return e===`accent`?IAe:FAe}
var LAe=new Set([...NAe,...vx.flatMap(e=>yx(e).map(t=>`${e}${t}`))]);
function RAe(e){return e!==void 0&&LAe.has(e)}
var zAe={Fill:1,FillHover:2,FillPressed:7,FillBright:0,Foreground:3,ForegroundHover:4,ForegroundBright:1};
function BAe(e,t){return t.every(t=>yx(t).every(n=>Object.hasOwn(e,`${t}${n}`)))}
function bx(e,t){let n=Object.fromEntries(e.flatMap(e=>yx(e).map(n=>[`${e}${n}`,t(n,e)])));return Gr(BAe(n,e),()=>`Missing variants for ${e.join(`, `)}`),n}
function VAe(){return bx(_x,(e,t)=>`{primitive/${t}/${zAe[e]}}`)}
function xx(e,t){return bx([e],e=>`{${t}${e}}`)}
var HAe=/^#[0-9a-f]{6}$/,UAe=/^\{([a-zA-Z]+)\}$/,WAe=/^\{primitive\/([a-z]+\/\d+)\}$/;
function GAe({value:e,theme:t}){let n=WAe.exec(e)?.[1];if(n===void 0)return;let r=t.primitives;Gr(r!==void 0,()=>`${t.id}: ${e} needs a primitives set`);let i=MAe[r][n];return Gr(i!==void 0,()=>`${t.id}: unknown primitive ${e}`),i}
function Sx({value:e,theme:t,seen:n}){if(HAe.test(e))return e;let r=GAe({value:e,theme:t});if(r!==void 0)return r;let i=UAe.exec(e)?.[1];return Gr(RAe(i),()=>`${t.id}: ${e} is not #rrggbb, a primitive, or a theme color`),Gr(!n.includes(i),()=>`${t.id}: reference cycle through ${i}`),Sx({value:t.colors[i],theme:t,seen:[...n,i]})}
function Cx({theme:e,key:t}){return Sx({value:e.colors[t],theme:e,seen:[t]})}
var wx={base:`{primitive/neutral/5}`,baseHover:`{primitive/neutral/4}`,pane:`{primitive/neutral/1}`,chrome:`{primitive/neutral/2}`,sidebar:`{primitive/neutral/3}`,elevated:`{primitive/neutral/0}`,focus:`{accentFillBright}`,...xx(`accent`,`blue`),...xx(`danger`,`red`),...xx(`success`,`green`),...xx(`warn`,`yellow`),...VAe()},Tx={id:`sand-light`,name:`Sand Light`,appearance:`light`,highContrast:!1,primitives:`light`,userBubbleFill:`FillHover`,colors:{...wx,onPrimary:`{primitive/neutral/1}`}},Ex={id:`sand-dark`,name:`Sand Dark`,appearance:`dark`,highContrast:!1,primitives:`dark`,userBubbleFill:`Fill`,colors:{...wx,onPrimary:`{primitive/neutral/5}`}},KAe=[Tx,Ex],Dx={light:Tx,dark:Ex},Ox=e=>({kind:`color`,color:e}),kx=e=>({kind:`themed`,color:e}),Ax=(e,t)=>({kind:`mix`,color:e,opacity:t}),jx=(e,t,n)=>({kind:`over`,color:e,opacity:t,backdrop:n}),qAe={"bg/pane":Ox(`pane`),"bg/chrome":Ox(`chrome`),"bg/sidebar":Ox(`sidebar`),"bg/elevated":Ox(`elevated`),"bg/elevated-hover":jx(`base`,`bg/hover`,`elevated`),"bg/luminous":Ox(`onPrimary`),"bg/scrim":Ax(`universal/black`,`bg/scrim`),"bg/scrim-heavy":Ax(`universal/black`,`bg/scrim-heavy`),"bg/hover":Ax(`base`,`bg/hover`),"bg/active":Ax(`base`,`bg/active`),"bg/primary":Ox(`base`),"bg/primary-hover":Ox(`baseHover`),"bg/primary-disabled":Ax(`base`,`bg/primary-disabled`),"bg/secondary":Ax(`base`,`bg/secondary`),"bg/secondary-hover":Ax(`base`,`bg/secondary-hover`),"bg/secondary-active":Ax(`base`,`bg/secondary-active`),"bg/secondary-disabled":Ax(`base`,`bg/secondary-disabled`),"bg/tertiary":Ax(`base`,`bg/tertiary`),"bg/quaternary":Ax(`base`,`bg/quaternary`),"fill/bubble-agent":Ax(`base`,`fill/bubble-agent`),"fill/bubble-user":Ax(`base`,`fill/bubble-user`),"fill/attachment-card":jx(`base`,`fill/attachment-card`,`elevated`),"fill/attachment-paper":jx(`base`,`fill/attachment-paper`,`elevated`),"fill/attachment-ink":Ax(`base`,`fill/attachment-ink`),"text/primary":Ox(`base`),"text/secondary":Ax(`base`,`text/secondary`),"text/tertiary":Ax(`base`,`text/tertiary`),"text/quaternary":Ax(`base`,`text/quaternary`),"text/on-primary":Ox(`onPrimary`),"text/inverted":Ox(`chrome`),"icon/primary":Ax(`base`,`icon/primary`),"icon/secondary":Ax(`base`,`icon/secondary`),"icon/tertiary":Ax(`base`,`icon/tertiary`),"icon/quaternary":Ax(`base`,`icon/quaternary`),"icon/official":kx(e=>e.appearance===`dark`?`blueForeground`:`blueForegroundBright`),"border/primary-translucent":Ax(`base`,`border/primary-translucent`),"border/secondary-translucent":Ax(`base`,`border/secondary-translucent`),"border/tertiary-translucent":Ax(`base`,`border/tertiary-translucent`),"border/quaternary-translucent":Ax(`base`,`border/quaternary-translucent`),"border/attachment-card":Ax(`base`,`border/attachment-card`),"border/attachment-paper":Ax(`base`,`border/attachment-paper`),"border/focus-primary":Ox(`focus`),"border/pane":Ox(`pane`),"border/chrome":Ox(`chrome`),"border/elevated":Ox(`elevated`),"shadow/control":Ax(`base`,`shadow/control`),"shadow/card":Ax(`base`,`shadow/card`),"shadow/secondary":Ax(`base`,`shadow/secondary`),"shadow/inline/ambient":Ax(`base`,`shadow/inline/ambient`),"shadow/inline/key":Ax(`base`,`shadow/inline/key`),"shadow/popover/ambient":Ax(`base`,`shadow/popover/ambient`),"shadow/popover/key":Ax(`base`,`shadow/popover/key`),"shadow/modal/ambient":Ax(`base`,`shadow/modal/ambient`),"shadow/modal/key":Ax(`base`,`shadow/modal/key`),"shadow/window/ambient":Ax(`base`,`shadow/window/ambient`),"shadow/window/edge":Ax(`base`,`shadow/window/edge`),"shadow/ring":Ax(`base`,`shadow/ring`)};
function Mx(e,t){let n=t.replace(`{role}`,e);return AAe.find(e=>e===n)??t}
function Nx(e){let t=`${e}Fill`,n=t=>Ax(`${e}FillBright`,Mx(e,t));return{[`bg/${e}-primary`]:Ox(t),[`bg/${e}-primary-hover`]:Ox(`${e}FillHover`),[`bg/${e}-primary-disabled`]:Ax(t,Mx(e,`bg/{role}-primary-disabled`)),[`bg/${e}-secondary`]:n(`bg/{role}-secondary`),[`bg/${e}-secondary-hover`]:n(`bg/{role}-secondary-hover`),[`bg/${e}-secondary-disabled`]:n(`bg/{role}-secondary-disabled`),[`bg/${e}-bright`]:Ox(`${e}FillBright`),[`fill/${e}-bubble-user`]:kx(t=>`${e}${t.userBubbleFill}`),[`text/${e}-primary`]:Ox(`${e}Foreground`),[`text/${e}-quaternary`]:n(`text/{role}-quaternary`),[`icon/${e}-primary`]:Ox(`${e}ForegroundBright`),[`border/${e}-primary`]:Ox(t),[`border/${e}-quaternary`]:n(`border/{role}-quaternary`)}}
var Px={...qAe,...Object.fromEntries(vx.flatMap(e=>Object.entries(Nx(e))))};
function Fx(e,t){return e===`universal/black`?`#000000`:Cx({theme:t,key:e})}
function Ix(e,t){return`${e}${Math.round(t*255/100).toString(16).padStart(2,`0`)}`}
function JAe(e,t,n){let r=(e,t)=>Number.parseInt(e.slice(1+t*2,3+t*2),16),i=t/100;return`#${[0,1,2].map(t=>Math.round(r(e,t)*i+r(n,t)*(1-i))).map(e=>e.toString(16).padStart(2,`0`)).join(``)}`}
function YAe(e,t,n){if(e.kind===`themed`)return Fx(e.color(t),t);let r=Fx(e.color,t);switch(e.kind){case`color`:return r;case`mix`:return Ix(r,n[e.opacity]);case`over`:return JAe(r,n[e.opacity],Fx(e.backdrop,t));default:return e}}
function Lx(e){return Gr(Object.hasOwn(Px,e),()=>`Unknown sand semantic token: ${e}`),`--sand-${e.replaceAll(`/`,`-`)}`}
function Rx(e){let t=OAe(e);return Object.fromEntries(Object.entries(Px).map(([n,r])=>[Lx(n),YAe(r,e,t)]))}
var ZAe=new Map(KAe.map(e=>[e,Rx(e)]));
function zx(e){return ZAe.get(e)??Rx(e)}
var e6e={categorical:[`#1084FE`,`#C24E00`,`#9159FE`,`#009957`,`#FF309B`,`#C27400`,`#008F7E`,`#97683D`],other:`#777777`,negative:`#C21D2E`,singleSeriesRest:`#B5D9FF`,areaAlpha:`24`,bandAlpha:`40`,sequential:[`#D6EAFF`,`#80BEFE`,`#459FFE`,`#1084FE`,`#0C64C1`,`#084382`],diverging:[`#C21D2E`,`#FF8C98`,`#E8E8E8`,`#80BEFE`,`#0C64C1`]},t6e={categorical:[`#1084FE`,`#FF6700`,`#9159FE`,`#00C972`,`#FF309B`,`#FF9800`,`#00BCA6`,`#97683D`],other:`#777777`,negative:`#FF263C`,singleSeriesRest:`#084382`,areaAlpha:`24`,bandAlpha:`40`,sequential:[`#052A51`,`#084382`,`#0C64C1`,`#1084FE`,`#459FFE`,`#80BEFE`],diverging:[`#FF5667`,`#82131F`,`#262626`,`#084382`,`#459FFE`]};
function n6e(e){return e===`dark`?t6e:e6e}
function r6e(e){let t=n6e(e);return{...Object.fromEntries(t.categorical.map((e,t)=>[`--sand-dataviz-${t}`,e])),"--sand-dataviz-other":t.other,"--sand-dataviz-negative":t.negative,"--sand-dataviz-single-series-rest":t.singleSeriesRest,"--sand-dataviz-area":`${t.categorical[0]}${t.areaAlpha}`}}
var y8={sans:`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,mono:`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace`};
var u0t={sans:`'XVF', ${y8.sans}`,mono:`'XVF Mono', ${y8.mono}`};
var b8={"heading-1":{fontSize:26,lineHeight:32,letterSpacingEm:-.015,weights:[`medium`],iconSize:24},"heading-2":{fontSize:22,lineHeight:28,letterSpacingEm:-.012,weights:[`regular`,`medium`,`semibold`],iconSize:20},"heading-3":{fontSize:17,lineHeight:24,letterSpacingEm:-.008,weights:[`regular`,`medium`,`semibold`],iconSize:18},"body-1":{fontSize:14,lineHeight:20,letterSpacingEm:0,weights:[`regular`,`medium`,`semibold`],iconSize:16},"body-2":{fontSize:13,lineHeight:18,letterSpacingEm:0,weights:[`regular`,`medium`,`semibold`],iconSize:14},label:{fontSize:12,lineHeight:16,letterSpacingEm:0,weights:[`regular`,`medium`,`semibold`],iconSize:12},caption:{fontSize:11,lineHeight:16,letterSpacingEm:.005,weights:[`regular`,`medium`],iconSize:10}};
var x8={control:`0 1px 3px 0 var(--sand-shadow-control)`,inline:`0 4px 12px -1px var(--sand-shadow-inline-ambient), 0 2px 4px -2px var(--sand-shadow-inline-key), 0 0 0 1px var(--sand-shadow-ring)`,popover:`0 10px 20px -3px var(--sand-shadow-popover-ambient), 0 4px 6px -4px var(--sand-shadow-popover-key), 0 0 0 1px var(--sand-shadow-ring)`,modal:`0 20px 32px -5px var(--sand-shadow-modal-ambient), 0 8px 12px -6px var(--sand-shadow-modal-key), 0 0 0 1px var(--sand-shadow-ring)`,window:`0 22px 70px 4px var(--sand-shadow-window-ambient), 0 0 0 0.5px var(--sand-shadow-window-edge)`},m0t={background:24};
function h5(e){return{...zx(e),...r6e(e.appearance),"--sand-blur-background":`${m0t.background}px`,"--sand-shadow-inline":x8.inline,"--sand-shadow-popover":x8.popover,"--sand-shadow-modal":x8.modal,"--sand-shadow-window":x8.window}}
function mvn(e){return{...h5(Dx[e]),"--cursor-font-family-sans":u0t.sans}}
var hvn={variables:{light:mvn(`light`),dark:mvn(`dark`)},typography:{body:b8[`body-1`],small:b8[`body-2`],label:b8.label,h1:b8[`heading-2`],h2:b8[`heading-3`],h3:b8[`body-1`]}};
return {theme: hvn,series: r6e};

}
