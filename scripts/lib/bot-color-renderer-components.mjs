// 强调色 = Bot 颜色 (bot color in chat) — the renderer side of the dimension-reduced
// port. Upstream 0.70.2 tints the 1:1 chat by redefining semantic accent-prefixed tokens on
// three containers (transcript scroll area, composer, info pane) through React props.
// The 0.18 baseline predates that token layer, but its components already consume the
// flat tokens that cover the same surfaces, so this port redefines THOSE at runtime on
// the same three containers. See source/shared/node/grok-bot-bot-color.ts for the
// evidence trail, and the build pass (bot-color-renderer-patch.mjs) for the container
// anchors and the token-existence gate.
//
// The injected runtime is an IIFE appended to the entry chunk, where it shares module
// scope with the baseline's own palette helpers (Cee/QCe) — it reuses them verbatim
// instead of re-implementing the palette + deterministic fallback hash.

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
    const put = (target, from) => { if (present.has(from)) vars[target] = `var(${from})`; };
    put("--sand-fill-bubble-user", `--sand-fill-${source}`);
    for (const family of ["fill", "text", "border"]) {
      for (const variant of ["", "-hover", "-disabled", "-subtle", "-subtle-hover", "-subtle-disabled"]) {
        put(`--sand-${family}-accent${variant}`, `--sand-${family}-${source}${variant}`);
      }
    }
    // `blue` IS accent: every accent←accent entry above is an identity mapping and only
    // the user bubble actually changes. Keeping the identity entries would be harmless
    // but noisy; dropping them keeps the emitted table honest about what it does.
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
 * `var(--sand-fill-bubble-agent)`). The runtime uses BOTH to find the transcript
 * scroll area among all `.ui-scroll-area` elements — an agent-only conversation has
 * no user bubbles, so scoping on the user class alone would silently drop the tint.
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
  const messageSelector = typeof messageClasses === "string" ? `.${bubbleClass}` : `.${messageClasses.user}${messageClasses.agent == null ? "" : `,.${messageClasses.agent}`}`;
  if (typeof bubbleClass !== "string" || bubbleClass.length === 0) throw new Error("bot-color: bubble class is required");
  return `
/* grok-node bot-color tint (强调色=Bot 颜色) — dimension-reduced port of 0.70.2 botTint. */
(function(){
  if(typeof window!=='object'||window.__rbotTint)return;window.__rbotTint=!0;
  var TABLE=${JSON.stringify(tintTable)};
  var BUBBLE='${messageSelector}';
  var APPLIED=[];
  function applyTint(els,vars){
    for(var i=0;i<els.length;i++){var style=els[i].style;for(var j=0;j<APPLIED.length;j++)style.removeProperty(APPLIED[j]);}
    var names=Object.keys(vars);
    for(var i2=0;i2<els.length;i2++){var style2=els[i2].style;for(var j2=0;j2<names.length;j2++)style2.setProperty(names[j2],vars[names[j2]]);}
    APPLIED=names;
  }
  // Official eligibility (0.70.2 ar()): groups and custom-avatar bots stay default, and
  // Cee/QCe are the baseline's own palette resolution (palette check + deterministic
  // fallback hash), shared through this chunk's module scope.
  function hueOf(agent){
    if(agent==null||typeof agent!=='object'||agent.isGroup===true)return null;
    if(typeof QCe==='function'&&QCe(agent)===true)return null;
    var color=typeof Cee==='function'?Cee(agent):agent.avatarColor;
    if(typeof color!=='string')return null;
    if(color==='black'||color==='gray')return null;
    return color==='violet'?'purple':color;
  }
  // Walks the React fiber of the SIDEBAR'S ACTIVE ROW for the current agent. Verified
  // against the live 0.18 build: the row component (class sand-agent-item, carrying
  // data-agent-id/data-active) holds the full agent object in props.agent a few hops up.
  // The transcript container's own ancestry deliberately carries no agent-like prop in
  // 0.18 (probed 80 hops, zero hits), so the sidebar is the authoritative source here —
  // the same source the injected main-bot sidebar treats as the roster of record.
  function agentOf(){
    var row=document.querySelector('.sand-agent-item[data-active],[data-agent-id][data-active]');
    if(row==null)return null;
    var fiber=null;
    for(var k of Object.getOwnPropertyNames(row)){if(k.indexOf('__reactFiber$')===0){fiber=row[k];break;}}
    for(var node=fiber,hops=0;node!=null&&hops<16;node=node.return,hops++){
      var props=node.memoizedProps;
      if(props==null||typeof props!=='object')continue;
      for(var prop in props){
        var value=props[prop];
        if(value!=null&&typeof value==='object'&&!Array.isArray(value)&&('avatarColor' in value||'avatarShape' in value))return value;
      }
    }
    return null;
  }
  function findContainers(){
    var out=[],scroller=null,scrolls=document.querySelectorAll('.ui-scroll-area');
    for(var i=0;i<scrolls.length;i++){if(scrolls[i].querySelector(BUBBLE)!=null){scroller=scrolls[i];break;}}
    if(scroller!=null)out.push(scroller);
    var composer=document.querySelector('.sand-prompt-form');
    if(composer!=null)out.push(composer);
    var pane=document.querySelector('.sand-info-pane');
    if(pane!=null)out.push(pane);
    return out;
  }
  var lastKey=null;
  function tick(){
    var bridge=window.desktop&&window.desktop.agent;
    if(bridge==null||typeof bridge.getBotColorInChat!=='function')return;
    bridge.getBotColorInChat().then(function(enabled){
      var els=findContainers();
      if(els.length===0)return;
      var hue=null,key=enabled===true?'':'off';
      if(enabled===true){hue=hueOf(agentOf());key=hue==null?'none':hue;}
      // Re-apply every tick: containers remount on view switches, and same-value
      // setProperty calls are cheap. The key only gates logging noise, not application.
      if(key!==lastKey){lastKey=key;}
      applyTint(els,hue!=null&&TABLE[hue]!=null?TABLE[hue]:{});
    }).catch(function(){});
  }
  setInterval(tick,2500);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(tick,500);});
  else setTimeout(tick,500);
})();
`;
}
