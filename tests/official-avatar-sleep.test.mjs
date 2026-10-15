import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { OFFICIAL_SHAPES } from "../scripts/lib/shape-picker-patch.mjs";
import { loadOfficialAsleepArtifacts, loadOfficialAvatarStates, loadOfficialShapeSvgs, computerSleepOverlayRuntime, computerSleepStyles } from "../scripts/lib/computer-sleep-renderer-components.mjs";

test("all 13 saved Bot shapes survive sleeping/waking overlay transitions", async () => {
  const [{html,css},states,shapes] = await Promise.all([loadOfficialAsleepArtifacts(),loadOfficialAvatarStates(),loadOfficialShapeSvgs()]);
  for (const shape of OFFICIAL_SHAPES) {
    const window = new Window();
    try {
      window.document.body.innerHTML = '<div class="sand-agent-item" data-active></div><div class="sand-computer-preview__frame" data-preview-bot-id="A"><div class="sand-box-vnc-pool"></div><button class="sand-computer-preview__open"><span>Open</span></button></div>';
      const row = window.document.querySelector('.sand-agent-item');
      row.__reactFiber$test = { memoizedProps: {agent: {id:"B",avatarShape:"blob"}} };
      const frame = window.document.querySelector('.sand-computer-preview__frame');
      frame.__reactFiber$test = {memoizedProps:{},return:{memoizedProps:{agent:{id:"A",avatarShape:shape}}}};
      const timers = [];
      window.setInterval = fn => { timers.push(fn); return 0; };
      window.setTimeout = fn => { timers.push(fn); return 0; };
      const calls = [];
      let resolveWake;
      window.desktop = {computer:{
        getSleepState: async id => { calls.push(["get",id]); return "asleep"; },
        wake: id => { calls.push(["wake",id]); return new Promise(resolve=>{resolveWake=resolve;}); },
      }};
      const style = window.document.createElement("style");
      style.textContent = computerSleepStyles(css);
      window.document.head.append(style);
      window.eval(computerSleepOverlayRuntime(html,shapes,"\uf46f",states));
      timers[0]();
      await Promise.resolve();
      await Promise.resolve();
      const stage = window.document.querySelector("#rcompsleep-stage");
      assert.ok(stage,shape);
      assert.equal(stage.getAttribute("data-avatar-shape"),shape);
      assert.equal(stage.querySelector(".sand-grok-bot-mark").getAttribute("data-grok-state"),"sleeping");
      assert.equal(stage.querySelector("svg").id,"r-avatar-sleeping-"+shape);
      assert.equal(stage.querySelector(".sand-grok-bot-mark").style.getPropertyValue("--grok-bot-ink"),"var(--sand-text-tertiary)");
      const z = stage.querySelector(".sand-wl3oru");
      assert.equal(window.getComputedStyle(z).animationName,"sand-6fenen-B");
      assert.ok(css.includes("@keyframes sand-6fenen-B"));
      stage.querySelector("button").click();
      assert.equal(stage.querySelector("svg").id,"r-avatar-waking-"+shape);
      assert.equal(stage.querySelector(".sand-grok-bot-mark").getAttribute("data-grok-state"),"waking");
      assert.ok(stage.querySelector("button").disabled);
      resolveWake("awake");
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(window.document.querySelector("#rcompsleep-stage"),null);
      assert.ok(!window.__rCompPreviewPausedBots.has("A"));
      assert.ok(calls.every(call=>call[1]==="A"));
    } finally { window.close(); }
  }
});
