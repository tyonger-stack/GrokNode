import { officialBotColor0753 } from "./bot-color-0753-official.mjs";

// 强调色 = Bot 颜色 (bot color in chat) — the renderer side of the dimension-reduced
// port. Upstream 0.70.2 tints the 1:1 chat by redefining semantic accent-prefixed tokens on
// three containers (transcript scroll area, composer, info pane) through React props.
// The 0.18 baseline predates that token layer, but its components already consume the
// flat tokens that cover the same surfaces, so this port redefines THOSE at runtime on
// the same three containers. See source/shared/node/grok-bot-bot-color.ts for the
// evidence trail, and the build pass (bot-color-renderer-patch.mjs) for the container
// anchors and the token-existence gate.
//
// Official 0.75.3 helpers run in a private scope with Cee as DO. React reads the
// effective preference snapshot during render; the timer only refreshes that setting.

// Palette id → the 0.18 semantic family that carries that hue's values. black/gray have
// no family ("or keep them black") and never appear here; blue IS the accent family, so
// its entries collapse to just the user-bubble override.
export const BOT_COLOR_HUE_SOURCE = Object.freeze({
  red: "danger",
  green: "success",
  orange: "supplementary1",
  brown: "supplementary2",
  cyan: "supplementary3",
  violet: "supplementary4",
  magenta: "supplementary5",
  yellow: "warning",
  blue: "accent",
});

/** Official hue normalization (0.70.2 `cg`): black/gray are untintable, violet reads as purple. */
export function normalizeBotColorHue(color) {
  if (typeof color !== "string") return null;
  if (color === "black" || color === "gray") return null;
  return color === "violet" ? "purple" : color;
}

function definedTokens(css) {
  return new Set([...css.matchAll(/--sand-[a-z0-9-]+(?=\s*:)/g)].map(match => match[0]));
}

/**
 * Builds hue → { cssVar: replacement } for every hue whose source family exists in the
 * shipped stylesheet. Only tokens that are actually DEFINED in the CSS are emitted, so a
 * family that lacks a variant (e.g. supplementary1-4 have no border tokens) silently
 * keeps the default rather than resolving to an invalid `var(--missing)`.
 */
export function buildBotColorTintTable(css) {
  const present = definedTokens(css);
  const table = {};
  for (const [paletteId, source] of Object.entries(BOT_COLOR_HUE_SOURCE)) {
    const vars = {};
    const put = (target, from) => { if (target !== from && present.has(target) && present.has(from)) vars[target] = `var(${from})`; };
    put("--sand-fill-bubble-user", `--sand-fill-${source}`);
    for (const family of ["fill", "text", "border"]) {
      for (const variant of ["", "-hover", "-disabled", "-subtle", "-subtle-hover", "-subtle-disabled"]) {
        put(`--sand-${family}-accent${variant}`, `--sand-${family}-${source}${variant}`);
      }
    }
    // `blue` IS accent: every accent←accent entry above is an identity mapping and only
    // the user bubble actually changes. Identity entries create CSS variable cycles.
    const entry = source === "accent"
      ? (vars["--sand-fill-bubble-user"] === undefined ? {} : { "--sand-fill-bubble-user": vars["--sand-fill-bubble-user"] })
      : (Object.keys(vars).length > 1 ? vars : null);
    // Keyed by the NORMALIZED hue (violet reads as purple at runtime, official cg()).
    if (entry != null) table[normalizeBotColorHue(paletteId)] = entry;
  }
  return table;
}

/**
 * The classes that paint message bubbles: the user rule (background through
 * `var(--sand-fill-bubble-user)`) and the agent rule (through
 * `var(--sand-fill-bubble-agent)`). These are build-time stylesheet evidence;
 * React supplies tint to the transcript root even before any bubbles exist.
 */
export function findBotColorMessageClasses(css) {
  const pick = token => {
    for (const match of css.matchAll(new RegExp(`\\.([a-z][a-z0-9-]*)[^{}]*\\{[^}]*var\\(${token}\\)[^}]*\\}`, "g"))) return match[1];
    return null;
  };
  const user = pick("--sand-fill-bubble-user");
  const agent = pick("--sand-fill-bubble-agent");
  if (user == null) throw new Error("no rule consumes var(--sand-fill-bubble-user)");
  return { user, agent };
}

export function botColorRuntime(tintTable, messageClasses) {
  const bubbleClass = typeof messageClasses === "string" ? messageClasses : messageClasses.user;
  if (typeof bubbleClass !== "string" || bubbleClass.length === 0) throw new Error("bot-color: bubble class is required");
  return `
/* grok-node bot-color tint — official 0.75.3 derivation, native 0.18 token projection. */
const RbcTint=(()=>{
  ${officialBotColor0753}
  const DO=Cee;
  const TABLE=${JSON.stringify(tintTable)};
  const snapshots=qn(false), service={botColorInChat:{snapshots}};
  const Q=()=>service;
  const Lc=s=>S.useSyncExternalStore(s.subscribe,s.get,s.get);
  const Bb={
    "--sand-text-on-primary":"var(--sand-text-on-primary)",
    "--sand-bg-accent-primary":"var(--sand-fill-accent)",
    "--sand-bg-accent-primary-hover":"var(--sand-fill-accent-hover)",
    "--sand-bg-accent-primary-disabled":"var(--sand-fill-accent-disabled)"
  };
  const gRe={"fill/bubble-user":h=>TABLE[h]?.["--sand-fill-bubble-user"]};
  function ci(_,h){
    const {"--sand-fill-bubble-user":bubble,...accent}=TABLE[h]??{};
    return accent;
  }
  // Semantic tokens absent in 0.18 have no consumer. Only project supported aliases;
  // an alias pointing back at itself must not shadow the inherited native variable.
  function project(style){
    if(style===undefined)return;
    const result={};
    for(const [key,value] of Object.entries(style)){
      const target=key==="--sand-transcript-bubble-user-fill"?"--sand-fill-bubble-user":key;
      if(value!=="var("+target+")"&&Object.values(TABLE).some(vars=>Object.hasOwn(vars,target)))result[target]=value;
    }
    return result;
  }
  let pending=false;
  async function refresh(){
    const bridge=window.desktop?.agent;
    if(pending||typeof bridge?.getBotColorInChat!=="function")return;
    pending=true;
    try{snapshots.set(await bridge.getBotColorInChat()===true)}catch{}finally{pending=false}
  }
  if(typeof window==="object"){refresh();setInterval(refresh,2500)}
  return {
    theme:agent=>fQ({agent:agent??null,isAccentThemingEnabled:false,isBotTintEnabled:pf()}),
    transcript:theme=>project(pQ(theme)),
    composer:theme=>project(mQ(theme)),
    info:agent=>project(ion(agent??null,pf()))
  };
})();
`;
}
