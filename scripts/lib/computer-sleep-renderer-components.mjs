// 电脑休眠/唤醒 (computer sleep/wake) — the renderer overlay, ported from official
// 0.70.2 by byte-export. The asleep stage's exact DOM (mascot, z-z-z, kit button) and
// CSS rules were exported from the official app. This version adds:
//
//   A) Shape-aware mascot: the overlay's SVG swaps to the CURRENT bot's shape
//      (13 official shapes from the 0.70.2 editor picker, exported & embedded).
//   C) Hover actions: preserve the native "打开" button and derive the "休眠"
//      button from the same native button/pill classes, directly below it.
//
// The `computer` namespace controls local preview visibility; Bot execution continues.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Window } from "happy-dom";

const ARTIFACTS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "computer-sleep-official");

export async function loadOfficialAsleepArtifacts() {
  const [html, css, animation] = await Promise.all([
    readFile(path.join(ARTIFACTS_DIR, "asleep-stage.html"), "utf8"),
    readFile(path.join(ARTIFACTS_DIR, "asleep-stage.css"), "utf8"),
    readFile(path.join(ARTIFACTS_DIR, "asleep-animation.css"), "utf8"),
  ]);
  if (!html.includes("{{TITLE}}") || !html.includes("{{WAKE}}") || !html.includes('data-stage="asleep"')) {
    throw new Error("computer-sleep: official asleep template is malformed.");
  }
  return { html, css: css + "\n" + animation };
}

export async function loadOfficialShapeSvgs() {
  const raw = await readFile(path.join(ARTIFACTS_DIR, "shape-map.json"), "utf8");
  const map = JSON.parse(raw);
  const expected = ["blob","cloud","square","sparkle","clover","heart","flower","teardrop","tablet","wedge","house","star","hex"];
  for (const shape of expected) {
    if (typeof map[shape] !== "string" || !map[shape].includes("<svg")) {
      throw new Error(`computer-sleep: shape ${shape} missing or malformed in shape-map.json`);
    }
  }
  return map;
}
export async function loadOfficialAvatarStates() {
  return JSON.parse(await readFile(path.join(ARTIFACTS_DIR, "avatar-states.json"), "utf8"));
}

export async function loadOfficialOpenPill() {
  const [html, css] = await Promise.all([
    readFile(path.join(ARTIFACTS_DIR, "open-pill.html"), "utf8"),
    readFile(path.join(ARTIFACTS_DIR, "open-pill.css"), "utf8"),
  ]);
  return { html, css };
}

export const COMPUTER_SLEEP_LABELS = {
  zh: { title: "电脑预览已关闭", wake: "恢复预览", waking: "正在恢复预览…", open: "打开", sleep: "休眠", sleepHint: "暂停当前 Bot 的预览流，任务继续运行", offline: "电脑正在休眠", wakeComputer: "唤醒电脑" },
  en: { title: "Computer preview is off", wake: "Show preview", waking: "Restoring preview…", open: "Open", sleep: "Sleep preview", sleepHint: "Pause this Bot's preview stream; tasks keep running", offline: "Your computer is sleeping", wakeComputer: "Wake computer" },
};

// 官方 0.71.2 chunk-computer-screen-preview-LY_WYUeq.js `Us` 用 sand-1unejwy / sand-budbmw /
// sand-162z183 / sand-1qvvsn5 给头像与文案定位,这四个类在 0.18 样式表里不存在。
// 声明值逐字取自官方 index-DkV65EBE.css;Chromium 不会应用我们注入的同名选择器,
// 因此改为在挂载时按同一组值内联,几何结果与官方一致。
export const COMPUTER_SLEEP_0712_LAYOUT = Object.freeze({
  avatar: Object.freeze({ top: "calc(50% - 28px)", insetInlineStart: "50%", marginInlineStart: "-16px" }),
  words: Object.freeze({ top: "calc(50% + 10px)" }),
});

// 官方 `We()` 的状态机:away/未启动 → asleep;状态未知或 starting/pulling → starting;
// isStatusUnavailable → unreachable。0.18 把同一个区分暴露在 .sand-computer-preview 的 data-phase 上。
const BUSY_PREVIEW_PHASES = Object.freeze({ loading: 1, starting: 1, pulling: 1 });

export function computerSleepOverlayRuntime(officialHtml, shapeSvgs, sleepIconGlyph, avatarStates) {
  return `
/* grok-node computer sleep overlay + hover pill — official 0.70.2 exports. */
(function(){
  if(typeof window!=='object'||window.__rCompSleep)return;window.__rCompSleep=!0;
  var STAGE_HTML=${JSON.stringify(officialHtml)};
  var SHAPE_SVGS=${JSON.stringify(shapeSvgs)};
  var SHAPE_STATES=${JSON.stringify(avatarStates ?? { sleeping: shapeSvgs, waking: shapeSvgs })};
  var SLEEP_ICON_GLYPH=${JSON.stringify(sleepIconGlyph)};
  var LAYOUT=${JSON.stringify(COMPUTER_SLEEP_0712_LAYOUT)};
  var BUSY_PHASES=${JSON.stringify(BUSY_PREVIEW_PHASES)};
  // 官方 openOverStage:休眠台盖在画面上时,原生「打开」按钮仍可见并变成唤醒动作。
  var OPEN_OVER_STAGE='sand-oegz02';
  var WAKE_SLOT_RE=/\\{\\{WAKE_SLOT\\}\\}[\\s\\S]*?\\{\\{WAKE_SLOT_END\\}\\}/;
  // 从标记末尾开始切，保留紧随其后的 '<'；写死 +14 会多跳一位，
  // 切出的片段丢了开标签，浏览器把 <span ...> 当正文渲染出来。
  var WAKE_SLOT_MARKER='{{WAKE_SLOT}}';
  var WAKE_SLOT_HTML=STAGE_HTML.slice(STAGE_HTML.indexOf(WAKE_SLOT_MARKER)+WAKE_SLOT_MARKER.length,STAGE_HTML.indexOf('{{WAKE_SLOT_END}}'));
  var ZH=(navigator.language||'').toLowerCase().indexOf('zh')===0;
  var L=${JSON.stringify(COMPUTER_SLEEP_LABELS)}[ZH?'zh':'en'];
  var IDS={overlay:'rcompsleep-stage',wake:'rcompsleep-wake',pill:'rcompsleep-pill',pillSleep:'rcompsleep-pill-sleep'};
  function bridge(){var c=window.desktop&&window.desktop.computer;return c!=null&&typeof c.getSleepState==='function'?c:null}
  function pool(){return document.querySelector('.sand-computer-preview__frame .sand-box-vnc-pool')}
  function previewFrame(host){return host.closest('.sand-computer-preview__frame')||host}
  function currentBotId(){var host=pool();return host==null?null:previewFrame(host).getAttribute('data-preview-bot-id')}
  var revisions=new Map();
  function revision(agentId){return revisions.get(agentId)||0}
  function beginChange(agentId){var next=revision(agentId)+1;revisions.set(agentId,next);return next}
  function isPaused(agentId){return window.__rCompPreviewPausedBots!=null&&window.__rCompPreviewPausedBots.has(agentId)}
  function pausePreviewStream(agentId,paused){
    if(!agentId||isPaused(agentId)===paused)return;
    if(window.__rCompPreviewPausedBots==null)window.__rCompPreviewPausedBots=new Set();
    if(paused)window.__rCompPreviewPausedBots.add(agentId);else window.__rCompPreviewPausedBots.delete(agentId);
    window.dispatchEvent(new Event('grok-node-preview-stream-state'));
  }

  // --- Shape resolution: reuse the entry chunk's own Cee (palette+fallback) via fiber ---
  function currentBotShape(){
    var agentId=currentBotId();
    var fallback=typeof Eee==='function'&&agentId?Eee({id:agentId,avatarShape:null}):'blob';
    var host=pool(),frame=host==null?null:previewFrame(host);
    var row=document.querySelector('.sand-agent-item[data-active],[data-agent-id][data-active]');
    var roots=[frame,row];
    for(var root of roots){
    if(root==null)continue;
    var fiber=null;
    for(var k of Object.getOwnPropertyNames(root)){if(k.indexOf('__reactFiber$')===0){fiber=root[k];break;}}
    for(var node=fiber,hops=0;node!=null&&hops<64;node=node.return,hops++){
      var props=node.memoizedProps;
      if(props==null||typeof props!=='object')continue;
      for(var p in props){
        var v=props[p];
        if(v!=null&&typeof v==='object'&&!Array.isArray(v)&&v.id===agentId){
          var shape=typeof Eee==='function'?Eee(v):v.avatarShape;
          return SHAPE_SVGS[shape]!=null?shape:fallback;
        }
      }
    }
    }
    return fallback;
  }
  function swapMascotShape(stage,mode){
    var shape=currentBotShape();
    var state=mode==='waking'?'waking':'sleeping';
    var svg=SHAPE_STATES[state][shape];
    if(svg==null)return;
    var mark=stage.querySelector('.sand-grok-bot-mark');
    if(mark==null)return;
    var container=mark.querySelector('span[style*="inline-block"]');
    if(container!=null){container.innerHTML='<span style="position:absolute;left:50%;top:50%;width:153.33333333333334%;height:153.33333333333334%;transform:translate(-50%,-50%);pointer-events:none;">'+svg+'</span>';}
    stage.setAttribute('data-avatar-shape',shape);
    mark.setAttribute('data-grok-state',state);
  }

  // --- Overlay ---
  function labels(mode){
    var offline=mode==='offline';
    return STAGE_HTML
      .replace('{{TITLE}}',mode==='waking'?L.waking:(offline?L.offline:L.title))
      // 官方 0.71.2 的 Es("asleep") 返回 second:null,台内没有按钮;唤醒走原生打开按钮。
      .replace(WAKE_SLOT_RE,offline?'':'@@WAKE_SLOT@@')
      .replace('@@WAKE_SLOT@@',WAKE_SLOT_HTML)
      .replace('{{WAKE}}',L.wake);
  }
  function previewRoot(){var host=pool();return host==null?null:previewFrame(host).closest('.sand-computer-preview')}
  function computerRunning(frame){
    return frame.querySelector('.sand-box-vnc-pool webview,.sand-box-vnc-pool iframe')!=null;
  }
  // 官方 We():状态已知、电脑没起来 → asleep;未知/启动中 → starting;不可用 → unreachable。
  function isOffline(frame){
    var root=previewRoot();
    if(root==null)return false;
    var phase=root.getAttribute('data-phase');
    if(phase==='error'||BUSY_PHASES[phase]===1)return false;
    return !computerRunning(frame);
  }
  // 官方 He():asleep → 'wake'。原生按钮的 onClick 已经会启动电脑,这里只改可见性与文案。
  var openState=null;
  function setOpenAsWake(on){
    var host=pool();
    if(host==null){openState=null;return}
    var frame=previewFrame(host);
    var open=frame.querySelector(':scope > .sand-computer-preview__open');
    if(on){
      if(open==null){openState=null;return}
      if(openState===null)openState={el:open,label:open.getAttribute('aria-label'),title:open.getAttribute('title'),pill:open.firstElementChild};
      open.classList.add(OPEN_OVER_STAGE);
      open.setAttribute('aria-label',L.wakeComputer);
      open.removeAttribute('title');
      if(openState.pill!=null)openState.pill.style.display='none';
    }else if(openState!=null){
      openState.el.classList.remove(OPEN_OVER_STAGE);
      if(openState.label!=null)openState.el.setAttribute('aria-label',openState.label);else openState.el.removeAttribute('aria-label');
      if(openState.title!=null)openState.el.setAttribute('title',openState.title);
      if(openState.pill!=null)openState.pill.style.removeProperty('display');
      openState=null;
    }
  }
  function removeOverlay(){
    setOpenAsWake(false);
    var el=document.getElementById(IDS.overlay);
    if(el!=null&&el.parentNode!=null){el.parentNode.removeAttribute('data-preview-asleep');el.parentNode.removeChild(el)}
    var host=pool();if(host!=null){host.removeAttribute('data-preview-asleep');previewFrame(host).removeAttribute('data-preview-asleep')}
  }
  function mountOverlay(mode){
    removeOverlay();
    if(mode==='offline')setOpenAsWake(true);
    var host=pool();
    if(host==null)return;
    var frame=previewFrame(host);
    var agentId=frame.getAttribute('data-preview-bot-id');
    if(!agentId)return;
    frame.insertAdjacentHTML('beforeend',labels(mode));
    var stage=frame.lastElementChild;
    if(stage==null||stage.getAttribute('data-stage')!=='asleep'){removeOverlay();return}
    stage.id=IDS.overlay;
    // 官方 0.71.2 用四个 0.18 没有的类定位头像与文案;同名规则在 Chromium 里不生效,
    // 这里按官方声明的内联值落位,几何与官方一致。
    var avatarEl=stage.querySelector('[data-stage-avatar]');
    if(avatarEl!=null){avatarEl.style.top=LAYOUT.avatar.top;avatarEl.style.insetInlineStart=LAYOUT.avatar.insetInlineStart;avatarEl.style.marginInlineStart=LAYOUT.avatar.marginInlineStart}
    var wordsEl=stage.querySelector('[data-stage-words]');
    if(wordsEl!=null&&wordsEl.parentElement!=null)wordsEl.parentElement.style.top=LAYOUT.words.top;
    host.setAttribute('data-preview-asleep','true');
    previewFrame(host).setAttribute('data-preview-asleep','true');
    stage.addEventListener('click',function(event){event.stopPropagation()});
    swapMascotShape(stage,mode);
    var wake=stage.querySelector('button');
    if(wake!=null){
      wake.id=IDS.wake;
      wake.addEventListener('click',function(event){
        event.stopPropagation();
        var b=bridge();if(b==null)return;
        var change=beginChange(agentId);
        wake.disabled=!0;
        swapMascotShape(stage,'waking');
        var title=stage.querySelector('[data-stage-words]>span');
        if(title!=null)title.textContent=L.waking;
        b.wake(agentId).then(function(state){if(change!==revision(agentId))return;beginChange(agentId);if(state==='awake'){pausePreviewStream(agentId,!1);if(currentBotId()===agentId){removeOverlay();rebindHover()}}else{wake.disabled=!1;swapMascotShape(stage,'asleep')}}).catch(function(){wake.disabled=!1;swapMascotShape(stage,'asleep');if(title!=null)title.textContent=L.title});
      });
    }
  }

  // --- Native Open pill styling shared by the Sleep action ---
  var pillVisible=!1;
  var pillOpen=null,pillLabel=null,pillReveal=null;
  function removePill(){
    var el=document.getElementById(IDS.pill);if(el!=null&&el.parentNode!=null)el.parentNode.removeChild(el);
    if(pillOpen!=null){
      if(pillReveal.value==='')pillOpen.style.removeProperty('--sand-computer-open-reveal');
      else pillOpen.style.setProperty('--sand-computer-open-reveal',pillReveal.value,pillReveal.priority);
    }
    pillOpen=null;pillLabel=null;pillReveal=null;pillVisible=!1;
  }
  function mountPill(){
    removePill();
    var host=pool();
    if(host==null)return;
    var frame=previewFrame(host);
    var agentId=frame.getAttribute('data-preview-bot-id');
    if(!agentId)return;
    var open=frame.querySelector(':scope > .sand-computer-preview__open');
    var label=open!=null?open.firstElementChild:null;
    if(open==null||label==null)return;
    var wrap=document.createElement('div');
    wrap.id=IDS.pill;
    wrap.style.cssText='position:absolute;left:50%;top:50%;transform:translate(-50%,calc(50% + var(--cursor-spacing-2,8px)));z-index:50;width:max-content;';
    var sleep=open.cloneNode(!1);
    sleep.id=IDS.pillSleep;
    sleep.classList.remove('sand-computer-preview__open');
    sleep.type='button';
    sleep.setAttribute('aria-label',L.sleep);
    sleep.title=L.sleepHint;
    sleep.style.position='static';sleep.style.inset='auto';sleep.style.width='auto';sleep.style.height='auto';
    sleep.style.setProperty('--sand-computer-open-reveal','1');
    var words=label.cloneNode(!1);
    var nativeIcon=label.querySelector('[data-icon-name="arrows-expand-simple"]');
    if(nativeIcon!=null){
      var icon=nativeIcon.cloneNode(!0);
      icon.setAttribute('data-icon-name','moon-z');
      icon.style.setProperty('--cursor-icon-content',JSON.stringify(SLEEP_ICON_GLYPH));
      words.appendChild(icon);
    }
    words.appendChild(document.createTextNode(L.sleep));sleep.appendChild(words);
    sleep.addEventListener('click',function(event){
      event.stopPropagation();
      var b=bridge();if(b==null)return;
      var change=beginChange(agentId);
      sleep.disabled=!0;
      b.sleep(agentId).then(function(state){if(change!==revision(agentId))return;beginChange(agentId);if(state==='asleep'){pausePreviewStream(agentId,!0);if(currentBotId()===agentId){removePill();mountOverlay('asleep')}}}).catch(function(){sleep.disabled=!1});
    });
    wrap.appendChild(sleep);
    pillOpen=open;pillLabel=label;pillReveal={value:open.style.getPropertyValue('--sand-computer-open-reveal'),priority:open.style.getPropertyPriority('--sand-computer-open-reveal')};
    open.style.setProperty('--sand-computer-open-reveal','1');
    frame.appendChild(wrap);
    pillVisible=!0;
  }

  // --- Pool hover handlers ---
  function bindHover(){
    var lastPool=null;
    function attach(host){
      if(host===lastPool)return;
      removePill();
      if(lastPool!=null){lastPool.removeEventListener('pointerenter',onEnter);lastPool.removeEventListener('pointerleave',onLeave);lastPool.removeEventListener('focusin',onEnter);lastPool.removeEventListener('focusout',onLeave)}
      lastPool=host;
      if(host!=null){host.addEventListener('pointerenter',onEnter);host.addEventListener('pointerleave',onLeave);host.addEventListener('focusin',onEnter);host.addEventListener('focusout',onLeave)}
    }
    function onEnter(){
      if(document.getElementById(IDS.overlay)!=null)return; // no pill while asleep
      if(!pillVisible)mountPill();
    }
    function onLeave(e){
      if(e.relatedTarget&&e.currentTarget.contains(e.relatedTarget))return;
      removePill();
    }
    return function(){
      var host=pool(),frame=host==null?null:previewFrame(host);
      attach(frame);
      if(pillOpen!=null&&pillOpen.firstElementChild!==pillLabel)removePill();
      if(frame!=null&&(frame.matches(':hover')||frame.contains(document.activeElement)))onEnter();
    };
  }
  var rebindHover=bindHover();

  // --- Tick ---
  window.addEventListener('grok-node-preview-stream-mounted',function(){
    var agentId=currentBotId();
    if(agentId&&isPaused(agentId)){removePill();mountOverlay('asleep')}
    else{removeOverlay();removePill();rebindHover()}
  });
  function tick(){
    var b=bridge();
    if(b==null)return;
    var host=pool();
    if(host==null){removeOverlay();removePill();return}
    var agentId=currentBotId();if(!agentId){removeOverlay();removePill();return}
    // 电脑没启动(官方 We() 的 asleep)时先按官方外观挂台,不依赖 host 的休眠集合。
    var offlineHost=pool()!=null&&isOffline(previewFrame(pool()));
    var observedRevision=revision(agentId);
    rebindHover();
    b.getSleepState(agentId).then(function(state){
      if(observedRevision!==revision(agentId))return;
      pausePreviewStream(agentId,state==='asleep');
      if(currentBotId()!==agentId)return;
      if(state==='asleep'||(state==='awake'&&offlineHost)){
        removePill();
        var current=document.getElementById(IDS.overlay);
        if(current==null)mountOverlay(state==='awake'?'offline':'asleep');
        else if(current.getAttribute('data-avatar-shape')!==currentBotShape())swapMascotShape(current,state==='awake'?'offline':'asleep');
      }else if(state==='awake'){
        removeOverlay();
        rebindHover();
      }
    }).catch(function(){});
  }
  setInterval(tick,2500);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(tick,800)});
  else setTimeout(tick,800);
})();
`;
}

/** Tokens the official rules reference that 0.18 doesn't define; scoped to the preview controls. */
export const COMPUTER_SLEEP_TOKEN_SHIMS = Object.freeze({
  "--sand-bg-pane": "#161616",
  "--sand-bg-secondary": "rgba(245,245,245,.04)",
  "--sand-bg-secondary-hover": "rgba(245,245,245,.08)",
  "--sand-bg-secondary-disabled": "rgba(245,245,245,.02)",
  "--sand-border-focus-primary": "#1e86fc",
  "--sand-border-tertiary-translucent": "rgba(28,28,28,.08)",
  "--sand-letter-spacing-sm": "0em",
  "--sand-letter-spacing-xs": "0em",
  "--sand-line-height-sm": "18px",
  "--sand-line-height-xs": "16px",
});

/** Official rules plus the two host-side additions the official frame already had. */
export function computerSleepStyles(officialCss) {
  const scope = ":is(#rcompsleep-stage)";
  const shims = scope + "{" + Object.entries(COMPUTER_SLEEP_TOKEN_SHIMS).map(([token, value]) => `${token}:${value};`).join("") + "}";
  const window = new Window();
  let scopedCss;
  try {
    const sheet = new window.CSSStyleSheet();
    sheet.replaceSync(officialCss);
    function scopedRules(rules) {
      return Array.from(rules, rule => {
        if (typeof rule.selectorText === "string") {
          const pseudo = rule.selectorText.match(/:{1,2}(?:before|after|first-letter|first-line)$/)?.[0] ?? "";
          const selector = pseudo === "" ? rule.selectorText : rule.selectorText.slice(0, -pseudo.length);
          if (/::{0,1}(?:before|after|first-letter|first-line)\b/.test(selector) || (pseudo !== "" && selector.includes(","))) {
            throw new Error(`Unsupported preview pseudo-element selector: ${rule.selectorText}`);
          }
          return `${scope}:is(${selector})${pseudo},${scope} :is(${selector})${pseudo}{${rule.style.cssText}}`;
        }
        if (rule.cssRules != null && rule.type !== window.CSSRule.KEYFRAMES_RULE) {
          return rule.cssText.slice(0, rule.cssText.indexOf("{") + 1) + scopedRules(rule.cssRules) + "}";
        }
        return rule.cssText;
      }).join("\n");
    }
    scopedCss = scopedRules(sheet.cssRules);
  } finally {
    window.close();
  }
  return shims + "\n" + scopedCss + `
.sand-box-vnc-pool[data-preview-asleep="true"]>:not(#rcompsleep-stage){visibility:hidden}
.sand-computer-preview__frame[data-preview-asleep="true"]>.sand-computer-preview__open:not(.sand-oegz02){visibility:hidden}
#rcompsleep-stage{pointer-events:auto}
#rcompsleep-stage:is(.sand-zkaem6){z-index:3}
.sand-computer-preview__frame>.sand-computer-preview__open:is(.sand-oegz02){visibility:visible;z-index:4}
#rcompsleep-pill{pointer-events:auto}
#rcompsleep-pill button{pointer-events:auto}
#rcompsleep-pill-sleep:disabled{cursor:default;opacity:.6}
`;
}

/** Tokens the grok-node additions consume. */
export const COMPUTER_SLEEP_CSS_TOKENS = ["--sand-bg-elevated", "--sand-border-default", "--sand-fill-ghost-hover", "--sand-text-secondary"];
