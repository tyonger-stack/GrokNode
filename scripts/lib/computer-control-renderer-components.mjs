// 电脑控制条 — build 组件:官方 0.70.2 控制条 (仅观看 / 取得控制权 / 你正在控制 / 停止)
// 的 DOM 覆盖实现,追加到上游 0.18.0 entry chunk。只读 DOM,不碰 React 内部状态:
// 全屏容器出现即挂控制条,按钮翻转 hasControl,经 webview.send 下发
// sand:vnc-accepts-input 给 preload 输入门控 (source/electron-preload/preload-vnc.ts)。
//
// 样式策略:容器/状态/文字全部复用 0.18.0 已存在且与 0.70.2 声明逐字相同的官方原子类
// (见 tests 里的 SAME 断言);0.18 缺的两个类用 .rcompctl-bar 一条 shim 规则补齐。
//
// 布局策略 (对应官方 0.70.2 chunk-box-desktop-modal-N-I4Mrel.js):
//   官方控制条是 sand-computer-stage 的第二个 flex 子元素 (非 position:absolute),
//   sand-computer-stage 有 sand-dt5ytf (flex-direction:column),
//   stage__frame 宽度公式用 (100cqh - 52px) 而非 100cqh。
//   我们通过 DOM 操作复刻:把 stage 切换到 flex-column,把 wrap 插为 stage 的子元素,
//   并通过 JS 把 stage__frame 的 style.width 里的 100cqh 替换为 calc(100cqh - 52px)。
//
// 输入门控策略 (对应官方 renderer + preload 双层门控):
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
export const COMPUTER_CONTROL_FOOTER_CLASSES = "sand-78zum5 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-h8yej3 rcompctl-footer";

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
    "function sendAccepts(wv,v){try{var r=wv.send?wv.send(CHANNEL,v):null;if(r&&typeof r.catch==='function'){r.catch(function(){});}}catch(e){}}",
    "function stageEl(box){return box.querySelector(STAGE_SEL);}",
    "function frameEl(box){return box.querySelector(FRAME_SEL);}",
    "function wvWrapEl(box){return box.querySelector(WV_WRAP_SEL);}",
    "function stageWebview(box){var f=frameEl(box);return f?f.querySelector('webview'):null;}",
    // 把 stage__frame 的 width 内联样式里的 100cqh 替换为 calc(100cqh - 52px)
    "function patchFrameWidth(frame,ctrl){",
    "  if(!frame)return;",
    "  var w=frame.style.width||'';",
    "  if(ctrl){",
    "    if(w.indexOf('rcompctl')!==-1)return;",
    "    frame.style.width=w.replace(/100cqh/g,'calc(100cqh - 52px)').replace(/calc\\(calc\\(/g,'calc(') + '/* rcompctl */';",
    "  }else{",
    "    frame.style.width=w.replace(/calc\\(100cqh - 52px\\)/g,'100cqh').replace('/* rcompctl */','');",
    "  }",
    "}",
    "function mount(box){",
    "  if(box.querySelector(':scope .rcompctl-footer'))return true;",
    "  var wv=stageWebview(box);",
    "  if(!wv)return false;",
    "  var on=false;",
    "  var hintOn=false;",
    "  var hintTimer=0;",
    "  var stage=stageEl(box);",
    "  var frame=frameEl(box);",
    // 把 stage 变成 flex-column
    "  if(stage&&!stage.classList.contains(FLEXCOL)){stage.classList.add(FLEXCOL);}",
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
    // 输入门控: webview wrapper pointer-events 切换 + webview blur/focus
    "    var wrap=wvWrapEl(box);",
    "    var curWv=stageWebview(box);",
    "    if(wrap){",
    "      if(on){wrap.classList.remove(PTNONE);}",
    "      else{wrap.classList.add(PTNONE);}",
    "    }",
    "    if(curWv){",
    "      if(on){try{curWv.focus();}catch(e){}}",
    "      else{",
    "        try{if(document.activeElement===curWv||curWv.contains&&curWv.contains(document.activeElement)){curWv.blur();box.focus();}}catch(e){}",
    "      }",
    "    }",
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
    "    if(cur&&cur!==wv){try{sendAccepts(wv,false);}catch(e){}wv=cur;}",
    "    if(on){hintOn=true;clearHint();hintTimer=setTimeout(function(){hintOn=false;hintTimer=0;render();},HINT_MS);}",
    "    else{hintOn=false;clearHint();}",
    "    on=!on;",
    "    sendAccepts(wv,on);",
    "    render();",
    "  });",
    // 把 footer 插到 stage 内部（stage__frame 之后）
    "  if(stage){",
    "    stage.appendChild(footer);",
    "    patchFrameWidth(frame,true);",
    "  }else{",
    // 回退：stage 找不到时保持旧的 absolute 布局
    "    footer.style.cssText='position:absolute;left:0;right:0;bottom:0;height:52px;display:flex;align-items:center;justify-content:center;background-color:var(--cursor-chrome);z-index:5;';",
    "    box.appendChild(footer);",
    "  }",
    "  render();",
    "  var mo=new MutationObserver(function(){",
    "    if(!document.contains(box)){",
    "      mo.disconnect();clearHint();",
    "      if(frame)frame.removeEventListener('pointerdown',onFramePointerDown);",
    "      return;",
    "    }",
    "    var cur=stageWebview(box);",
    "    if(cur!==wv){",
    "      if(on){try{sendAccepts(wv,false);}catch(e){}on=false;}",
    "      hintOn=false;clearHint();",
    "      if(!cur){",
    "        footer.remove();",
    "        var st2=stageEl(box);",
    "        if(st2)st2.classList.remove(FLEXCOL);",
    "        patchFrameWidth(frameEl(box),false);",
    "        mo.disconnect();",
    "        if(frame)frame.removeEventListener('pointerdown',onFramePointerDown);",
    "        return;",
    "      }",
    "      wv=cur;",
    "      render();",
    "    }",
    "  });",
    "  mo.observe(box,{childList:true,subtree:true});",
    "  return true;",
    "}",
    "function sweep(){var boxes=document.querySelectorAll(BOX_SEL);for(var i=0;i<boxes.length;i++){try{mount(boxes[i]);}catch(e){}}}",
    "var obs=new MutationObserver(sweep);",
    "if(document.documentElement){obs.observe(document.documentElement,{childList:true,subtree:true});}",
    "sweep();",
    "})();",
  ];
  return L.join(NL) + NL;
}

