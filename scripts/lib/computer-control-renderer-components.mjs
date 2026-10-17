// 电脑控制条 — build 组件:官方 0.71.2 控制条 (仅观看 / 取得控制权 / 你正在控制 / 停止)
// 的 DOM 覆盖实现,追加到上游 0.18.0 entry chunk。只读 DOM,不碰 React 内部状态:
// 全屏容器出现即挂控制条,按钮翻转 hasControl,经 webview.send 下发
// sand:vnc-accepts-input 给 preload 输入门控 (source/electron-preload/preload-vnc.ts)。
//
// 样式策略:容器/状态/文字全部复用 0.18.0 已存在且与 0.70.2 声明逐字相同的官方原子类
// (见 tests 里的 SAME 断言);0.18 缺的两个类用 .rcompctl-bar 一条 shim 规则补齐。
//
// 布局策略 (对应官方 0.71.2 chunk-box-desktop-modal--0USskmH.js):
//   官方控制条是 sand-computer-stage 的第二个 flex 子元素 (非 position:absolute),
//   sand-computer-stage 有 sand-dt5ytf (flex-direction:column),
//   stage__frame 的官方值是
//   width: min(100cqw, calc((100cqh - 52px) * 1920 / 1200)) 且 aspectRatio: 1920/1200,
//   即控制条高度从可用高度里扣除,画面按 16:10 完整可见,底部不再被菜单栏遮住。
//
// 输入门控策略 (对应官方 renderer + preload 双层双 gate):
//   !hasControl 时:
//     1) webview 外层 wrapper div 加 sand-47corl (pointer-events:none),阻断所有鼠标输入;
//     2) 如果 webview 有焦点则 blur() 并把焦点交给 fullscreen 容器;
//     3) sand-computer-stage__frame 的 pointerdown 事件展示 2500ms 提示 (官方 hintCount 语义)。
//   hasControl 时移除 sand-47corl 并聚焦 webview。
//   preload 层的 sand:vnc-accepts-input 通道同时发送,管控剪贴板/方向键/Mac 快捷键。

export const COMPUTER_CONTROL_LABELS = {
  take: "取得控制权",
  viewOnly: "仅观看",
  inControl: "你正在控制",
  hint: "取得控制权后即可点击和输入",
  stop: "停止",
};

export const COMPUTER_CONTROL_CHANNEL = "sand:vnc-accepts-input";
// @evidence Grok Bot 0.71.2 chunk-box-desktop-modal--0USskmH.js (Sn) 与 preload-vnc.cjs (ke)
export const COMPUTER_CONTROL_INTERACTIVE_CHANNEL = "sand:vnc-interactive";
export const COMPUTER_CONTROL_VIEWER_VISIBLE_CHANNEL = "sand:vnc-viewer-visible";
// @evidence 0.71.2 sand-computer-stage__frame: width min(100cqw, calc((100cqh - 52px) * 1920 / 1200)); aspectRatio 1920/1200
export const COMPUTER_CONTROL_STAGE_WIDTH = "min(100cqw, calc((100cqh - 52px) * 1920 / 1200))";
export const COMPUTER_CONTROL_STAGE_ASPECT_RATIO = "1920 / 1200";

export const COMPUTER_CONTROL_CSS_TOKENS = [
  "--cursor-chrome",
  "--sand-text-on-primary",
];

// 官方 jn/kn 的类表 (0.70.2 chunk-box-desktop-modal-N-I4Mrel.js),已逐类核对 0.18.0 声明。
export const COMPUTER_CONTROL_BAR_CLASSES = [
  "sand-1n2onr6", "sand-9f619", "sand-3nfvp2", "sand-2lah0s", "sand-6s0dn4",
  "sand-883omv", "sand-c9qbxq", "sand-exx8yu", "sand-18d9i69", "sand-1g0dm76",
  "sand-qjedn3", "sand-1y0btm7", "sand-149ho13", "sand-10e981r", "sand-1z0g938",
  "sand-tyxrsu", "sand-uxw1ft", "sand-qrzla8", "sand-qrzla8", "rcompctl-bar",
].join(" ");

// 官方控制条外层托条的类 (sand-dd8jsf=height:52px; sand-1qj4qm9=background:--sand-bg-chrome)
// 0.18 无 --sand-bg-chrome token,用 .rcompctl-footer shim 替代。
export const COMPUTER_CONTROL_FOOTER_CLASSES = "sand-78zum5 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-h8yej3 sand-dd8jsf sand-1qj4qm9 rcompctl-footer";

export const COMPUTER_CONTROL_STATUS_CLASSES = "sand-3nfvp2 sand-6s0dn4 sand-17d4w8g sand-1o0liin ui-11wthnw ui-1ja60sm ui-vu1jfw ui-h4fh7u";
export const COMPUTER_CONTROL_HINT_CLASSES = "ui-11wthnw ui-1ja60sm ui-vu1jfw sand-1o0liin sand-uxw1ft";
export const COMPUTER_CONTROL_ICON_CLASSES = "ui-icon ui-1qt6sjn ui-1yj7g93 ui-1u4itkb";
// 官方 kn 组件外层 span 的类 (chunk-box-desktop-modal-N-I4Mrel.js)。
export const COMPUTER_CONTROL_KN_CLASSES = "sand-1n2onr6 sand-3nfvp2";
// 官方 fn({name:"computer-watch-hint",delayMs:2500}) 的提示显示时长。
export const COMPUTER_CONTROL_HINT_MS = 2500;
// 0.18.0 原生 kit 按钮类 (与 frontend view.tsx 的 KIT_BUTTON_* 同源,逐类存在于 pinned CSS)。
const KIT_BUTTON_BASE = "sand-kit-button sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-1jnr06f sand-2lah0s sand-9f619 sand-c342km sand-ng3xce sand-jb2p0i sand-uxw1ft sand-1ypdohk sand-tgyt42 sand-s2xxs2 sand-gdialr sand-9lcvmn sand-1k57tk5 sand-784prv sand-1t137rt sand-9v5kkp sand-4sht9k sand-1y3gkto";
const KIT_BUTTON_SM = KIT_BUTTON_BASE + " sand-fifm61 sand-1d3mw78 sand-12oo3zp sand-1iorvi4 sand-1ug7bdz sand-jkvuk6 sand-11iknt3 sand-1kogg8i";
export const COMPUTER_CONTROL_TAKE_CLASSES = KIT_BUTTON_SM + " sand-1wclgxm sand-1e15362 sand-1gzh0bn sand-xcaa6e sand-g7klql";
export const COMPUTER_CONTROL_STOP_CLASSES = KIT_BUTTON_SM + " sand-1tiofj7 sand-ex9vrg sand-wj1584 sand-tyxrsu sand-g7klql";

export function computerControlBarStyles() {
  return [
    // 官方控制条托条:height:52px + background-color:var(--cursor-chrome) 作为 stage 的 flex 子元素
    ".rcompctl-footer{height:52px;background-color:var(--cursor-chrome);flex-shrink:0;}",
    // 控制条药丸 border-color shim
    ".rcompctl-bar{border-color:color-mix(in srgb,var(--sand-text-on-primary) 28%,transparent);}",
  ].join("\n") + "\n";
}

// 图标 glyph 以 CSS 转义序列 ("\\ea70" 形式) 写入 --cursor-icon-content:
// 原始 PUA 字符经 CSSOM 序列化会丢失,转义序列与官方样式表 content:"\\ea70" 同路径。
function cssGlyphEscape(ch) {
  return '"' + String.fromCharCode(92) + ch.codePointAt(0).toString(16) + '"';
}

export function computerControlBarRuntime(glyphs) {
  const NL = String.fromCharCode(10);
  const labels = JSON.stringify(COMPUTER_CONTROL_LABELS);
  const channel = JSON.stringify(COMPUTER_CONTROL_CHANNEL);
  const barClasses = JSON.stringify(COMPUTER_CONTROL_BAR_CLASSES);
  const footerClasses = JSON.stringify(COMPUTER_CONTROL_FOOTER_CLASSES);
  const statusClasses = JSON.stringify(COMPUTER_CONTROL_STATUS_CLASSES);
  const hintClasses = JSON.stringify(COMPUTER_CONTROL_HINT_CLASSES);
  const iconClasses = JSON.stringify(COMPUTER_CONTROL_ICON_CLASSES);
  const takeClasses = JSON.stringify(COMPUTER_CONTROL_TAKE_CLASSES);
  const stopClasses = JSON.stringify(COMPUTER_CONTROL_STOP_CLASSES);
  const knClasses = JSON.stringify(COMPUTER_CONTROL_KN_CLASSES);
  const hintMs = JSON.stringify(COMPUTER_CONTROL_HINT_MS);
  const interactiveChannel = JSON.stringify(COMPUTER_CONTROL_INTERACTIVE_CHANNEL);
  const viewerChannel = JSON.stringify(COMPUTER_CONTROL_VIEWER_VISIBLE_CHANNEL);
  const stageWidth = JSON.stringify(COMPUTER_CONTROL_STAGE_WIDTH);
  const stageAspect = JSON.stringify(COMPUTER_CONTROL_STAGE_ASPECT_RATIO);
  const eyeGlyph = JSON.stringify(cssGlyphEscape(glyphs.eye));
  const pointerGlyph = JSON.stringify(cssGlyphEscape(glyphs["window-pointer-arrow"]));
  const L = [
    "/* grok-node computer control bar: official 0.70.2 pill, view-only by default. */",
    ";(function(){",
    "if(window.__rCompCtl)return;",
    "window.__rCompCtl=true;",
    "var LABELS=" + labels + ";",
    "var CHANNEL=" + channel + ";",
    "var BAR_CLS=" + barClasses + ";",
    "var FOOTER_CLS=" + footerClasses + ";",
    "var STATUS_CLS=" + statusClasses + ";",
    "var HINT_CLS=" + hintClasses + ";",
    "var ICON_CLS=" + iconClasses + ";",
    "var TAKE_CLS=" + takeClasses + ";",
    "var STOP_CLS=" + stopClasses + ";",
    "var KN_CLS=" + knClasses + ";",
    "var HINT_MS=" + hintMs + ";",
    "var INT_CH=" + interactiveChannel + ";",
    "var VIS_CH=" + viewerChannel + ";",
    "var STAGE_W=" + stageWidth + ";",
    "var STAGE_AR=" + stageAspect + ";",
    "var EYE=" + eyeGlyph + ";",
    "var POINTER=" + pointerGlyph + ";",
    // sand-47corl = pointer-events:none (官方 0.70.2/0.18.0 共同声明)
    "var PTNONE='sand-47corl';",
    // sand-dt5ytf = flex-direction:column
    "var FLEXCOL='sand-dt5ytf';",
    "var BOX_SEL='.sand-computer-fullscreen';",
    "var STAGE_SEL='.sand-computer-stage';",
    "var FRAME_SEL='.sand-computer-stage__frame';",
    // webview 外层 wrapper (sand-10l6tqk sand-10a8y8t) — 通过 selector 找
    "var WV_WRAP_SEL='.sand-10l6tqk.sand-10a8y8t';",
    "function sendTo(wv,ch,v){try{var r=wv.send?wv.send(ch,v):null;if(r&&typeof r.catch==='function'){r.catch(function(){});}}catch(e){}}",
    "function sendAccepts(wv,v){sendTo(wv,CHANNEL,v);}",
    "function stageEl(box){return box.querySelector(STAGE_SEL);}",
    "function frameEl(box){return box.querySelector(FRAME_SEL);}",
    "function stageWebview(box){var f=frameEl(box);return f?f.querySelector('webview'):null;}",
    // 官方 0.71.2 三通道:sand:vnc-accepts-input / sand:vnc-interactive / sand:vnc-viewer-visible
    "function interactiveSrc(wv){",
    "  var s=(wv&&(wv.getAttribute?wv.getAttribute('src'):null))||'';",
    "  if(!s)return true;",
    "  return s.indexOf('sandInteractive=1')!==-1;",
    "}",
    "function syncChannels(wv,on){",
    "  if(!wv)return;",
    "  sendAccepts(wv,!!on);",
    "  sendTo(wv,INT_CH,interactiveSrc(wv));",
    "  sendTo(wv,VIS_CH,document.visibilityState!=='hidden');",
    "}",
    "function revokeChannels(wv){if(!wv)return;sendAccepts(wv,false);sendTo(wv,INT_CH,false);sendTo(wv,VIS_CH,false);}",
    "function wvWrap(wv){return wv?wv.closest(WV_WRAP_SEL):null;}",
    // 官方 0.71.2 E = isInteractive && acceptsInput; !acceptsInput 时 wrapper pointer-events:none
    "function applyGate(wrap,wv,on,canFocus){",
    "  if(wrap){if(on)wrap.classList.remove(PTNONE);else wrap.classList.add(PTNONE);}",
    "  if(!wv)return;",
    "  if(on){",
    "    wv.removeAttribute('aria-hidden');",
    "    wv.removeAttribute('tabindex');",
    "    try{wv.focus();}catch(e){}",
    "    setTimeout(function(){try{if(canFocus&&canFocus()&&document.contains(wv))wv.focus();}catch(e){}},32);",
    "  }else{",
    "    wv.setAttribute('aria-hidden','true');",
    "    wv.setAttribute('tabindex','-1');",
    "    try{if(document.activeElement===wv)wv.blur();}catch(e){}",
    "  }",
    "}",
    "var MOUNTS=[];",
    "function mount(box){",
    "  if(box.querySelector(':scope .rcompctl-footer'))return true;",
    "  var wv=stageWebview(box);",
    "  if(!wv)return false;",
    "  var on=false;",
    "  var disposed=false;",
    "  var hintOn=false;",
    "  var hintTimer=0;",
    "  var stage=stageEl(box);",
    "  var frame=frameEl(box);",
    // 0.71.2 不再有 position:absolute 回退:缺 stage/frame 就不挂载
    "  if(!stage||!frame)return false;",
    "  var wvParent=wvWrap(wv);",
    "  var prevW=frame.style.width,prevAR=frame.style.aspectRatio;",
    // 把 stage 变成 flex-column,并按 52px 控制条让位 frame 宽度
    "  stage.classList.add(FLEXCOL);",
    "  frame.style.width=STAGE_W;",
    "  frame.style.aspectRatio=STAGE_AR;",
    // 建托条 div (官方: sand-78zum5 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-h8yej3 sand-dd8jsf sand-1qj4qm9)
    "  var footer=document.createElement('div');",
    "  footer.className=FOOTER_CLS;",
    "  var bar=document.createElement('div');",
    "  bar.className=BAR_CLS;",
    "  var status=document.createElement('span');",
    "  status.className=STATUS_CLS;",
    "  status.setAttribute('aria-live','polite');",
    "  var icon=document.createElement('i');",
    "  icon.className=ICON_CLS;",
    "  icon.setAttribute('aria-hidden','true');",
    "  icon.setAttribute('data-size','sm');",
    "  var textNode=document.createElement('span');",
    "  var hint=document.createElement('span');",
    "  hint.className=HINT_CLS;",
    "  hint.textContent=LABELS.hint;",
    "  var btn=document.createElement('button');",
    "  btn.setAttribute('type','button');",
    "  var btnText=document.createElement('span');",
    "  btnText.className='sand-euugli sand-b3r6kr sand-lyipyv';",
    "  btn.appendChild(btnText);",
    "  var kn=document.createElement('span');",
    "  kn.className=KN_CLS;",
    "  kn.appendChild(btn);",
    "  status.appendChild(icon);status.appendChild(textNode);status.appendChild(hint);",
    "  bar.appendChild(status);bar.appendChild(kn);",
    "  footer.appendChild(bar);",
    "  function render(){",
    "    textNode.textContent=on?LABELS.inControl:LABELS.viewOnly;",
    "    icon.setAttribute('data-icon-name',on?'window-pointer-arrow':'eye');",
    "    icon.style.setProperty('--cursor-icon-content',on?POINTER:EYE);",
    "    status.className=STATUS_CLS+(on?' sand-tyxrsu':'');",
    "    btnText.textContent=on?LABELS.stop:LABELS.take;",
    "    btn.className=on?STOP_CLS:TAKE_CLS;",
    "    btn.setAttribute('data-size','sm');",
    "    btn.setAttribute('data-variant',on?'secondary':'primary');",
    "    hint.style.display=(hintOn&&!on)?'':'none';",
    "    var wrap=wvParent;",
    "    var curWv=stageWebview(box);",
    "    applyGate(wrap,curWv,on,function(){return on&&!disposed&&wv===curWv&&document.contains(box);});",
    "  }",
    "  function clearHint(){if(hintTimer){clearTimeout(hintTimer);hintTimer=0;}}",
    // pointerdown 在 stage__frame 上门控点击：仅观看时截获点击并显示提示
    "  function onFramePointerDown(e){",
    "    if(on)return;",
    "    // 截获点击，阻止 webview 收到（webview wrapper 已有 pointer-events:none，这里仅更新提示）",
    "    hintOn=true;",
    "    clearHint();",
    "    hintTimer=setTimeout(function(){hintOn=false;hintTimer=0;render();},HINT_MS);",
    "    render();",
    "  }",
    "  if(frame){frame.addEventListener('pointerdown',onFramePointerDown);}",
    "  btn.addEventListener('click',function(){",
    "    var cur=stageWebview(box);",
    "    if(cur&&cur!==wv){unbindGuest(wv);revokeChannels(wv);applyGate(wvParent,wv,false);wv=cur;wvParent=wvWrap(cur);bindGuest(wv);}",
    // 0.71.2:停止回到仅观看不主动弹提示,只有仅观看态点画面才提示
    "    hintOn=false;clearHint();",
    "    on=!on;",
    "    syncChannels(wv,on);",
    "    render();",
    "  });",
    // 把 footer 插到 stage 内部（stage__frame 之后）
    // 0.71.2:footer 是 stage 的第二个 flex 子元素,不再有 position:absolute 回退
    "  stage.appendChild(footer);",
    // 0.71.2:三通道在 dom-ready / did-finish-load / visibilitychange 反复重发
    "  function resync(){if(!disposed)syncChannels(wv,on);}",
    "  function bindGuest(guest){guest.addEventListener('dom-ready',resync);guest.addEventListener('did-finish-load',resync);}",
    "  function unbindGuest(guest){guest.removeEventListener('dom-ready',resync);guest.removeEventListener('did-finish-load',resync);}",
    "  bindGuest(wv);",
    "  document.addEventListener('visibilitychange',resync);",
    "  syncChannels(wv,on);",
    "  render();",
    "  function teardown(){",
    "    disposed=true;mo.disconnect();",
    "    clearHint();revokeChannels(wv);",
    "    if(frame)frame.removeEventListener('pointerdown',onFramePointerDown);",
    "    unbindGuest(wv);",
    "    document.removeEventListener('visibilitychange',resync);",
    "    footer.remove();",
    "    stage.classList.remove(FLEXCOL);",
    "    frame.style.width=prevW;frame.style.aspectRatio=prevAR;",
    "    if(wvParent)wvParent.classList.remove(PTNONE);",
    "  }",
    // 全屏框是从 body 摘掉的,挂在 box 上的观察器看不到这种变更;
    // 卸载判定统一交给全局 sweep,这里只管 stage 内 webview 的换帧。
    "  var mo=new MutationObserver(function(){",
    "    var cur=stageWebview(box);",
    "    if(cur!==wv){",
    // 切换 webview 时对旧实例三通道 fail-closed
    "      unbindGuest(wv);revokeChannels(wv);applyGate(wvParent,wv,false);on=false;",
    "      hintOn=false;clearHint();",
    "      if(!cur){",
    "        mo.disconnect();MOUNTS.splice(MOUNTS.indexOf(entry),1);teardown();",
    "        return;",
    "      }",
    "      wv=cur;wvParent=wvWrap(cur);",
    "      bindGuest(wv);",
    "      syncChannels(wv,on);",
    "      render();",
    "    }",
    "  });",
    "  mo.observe(box,{childList:true,subtree:true});",
    "  var entry={box:box,teardown:teardown};",
    "  MOUNTS.push(entry);",
    "  return true;",
    "}",
    "function sweep(){",
    "  for(var i=MOUNTS.length-1;i>=0;i--){",
    "    var m=MOUNTS[i];",
    "    if(document.contains(m.box))continue;",
    "    MOUNTS.splice(i,1);",
    "    try{m.teardown();}catch(e){}",
    "  }",
    "  var boxes=document.querySelectorAll(BOX_SEL);",
    "  for(var j=0;j<boxes.length;j++){try{mount(boxes[j]);}catch(e){}}",
    "}",
    "var obs=new MutationObserver(sweep);",
    "if(document.documentElement){obs.observe(document.documentElement,{childList:true,subtree:true});}",
    "sweep();",
    "})();",
  ];
  return L.join(NL) + NL;
}

