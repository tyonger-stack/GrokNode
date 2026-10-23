// Literal functions from 0.75.3 index.eager-app-DjFE9lSq.js (SHA-256
// 952696656fa99b6631d0d0d4acdb7372fbb62b3a28f0e20c89f2baa340a250bb).
// qn is from index.eager-platform-CVpWlQMj.js (SHA-256
// dc21e290c9d277d92fa1c9167d11a18b64707a70f2d5232505cb8ea6c5c032a3).
// Extracts and byte ranges: rea-grokbot-0753/bot-color-delay/upstream/source-identity.json.
function pf(){return Lc(Q().botColorInChat.snapshots)}
function mde(e){return!e.isGroup}
function cw(e,t){return String(gRe[t](e))}
function OO(e){switch(e){case`black`:case`gray`:return`gray`;case`violet`:return`purple`;default:return e}}
function kO(e){return(e.avatarDataUrl??``).length>0||(e.avatarVersion??``).length>0}
function NO(e){return e===`gray`?void 0:ci(`accent`,e)}
function fQ(e){let{agent:t}=e;if(t===null||!mde(t)||kO(t))return dQ;let n=OO(DO(t));return e.isBotTintEnabled?n===`gray`?dQ:{kind:`botTint`,hue:n}:e.isAccentThemingEnabled?{kind:`branded`,hue:n}:dQ}
function pQ(e){switch(e.kind){case`default`:return;case`branded`:return{"--sand-transcript-bubble-agent-fill":MO(e.hue),...NO(e.hue)};case`botTint`:return{"--sand-transcript-bubble-user-fill":cw(e.hue,`fill/bubble-user`),"--sand-transcript-bubble-user-text":String(Bb[`--sand-text-on-primary`]),...NO(e.hue)}}}
function mQ(e){if(e.kind===`botTint`)return{...NO(e.hue),"--sand-prompt-cta-fill":String(Bb[`--sand-bg-accent-primary`]),"--sand-prompt-cta-fill-hover":String(Bb[`--sand-bg-accent-primary-hover`]),"--sand-prompt-cta-fill-disabled":String(Bb[`--sand-bg-accent-primary-disabled`]),"--sand-prompt-cta-text":String(Bb[`--sand-text-on-primary`]),"--sand-prompt-cta-text-disabled":`color-mix(in srgb, ${Bb[`--sand-text-on-primary`]} 30%, transparent)`}}
function ion(e,t){let n=fQ({agent:e,isAccentThemingEnabled:!1,isBotTintEnabled:t});return n.kind===`botTint`?NO(n.hue):void 0}
function qn(e){let t=e,n=new Set,r=e=>{if(!Object.is(e,t)){t=e;for(let e of[...n])e()}};return{get:()=>t,subscribe:e=>(n.add(e),()=>{n.delete(e)}),set:r,update:e=>r(e(t))}}

export const officialBotColor0753 = "var dQ={kind:`default`};\n" +
  [pf, mde, cw, OO, kO, NO, fQ, pQ, mQ, ion, qn].map(fn => fn.toString()).join("\n");
