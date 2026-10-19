/** Additive box-side helpers. Keep launcher/profile ownership with box-chrome.
 * Anchors: selected15 readiness; host-main.cjs:681693-681730 launch=false;
 * selected16 PLAYWRIGHT_RUN_CODE_UPLOAD_HINT. Changelog supplements crash/download behavior.
 */
export const SAND_BROWSER_RECOVERY_SOURCE = String.raw`
async function ensureChrome(port, display, launch = true) {
  if (await cdpAlive(port)) return;
  if (!launch) throw new Error("The box browser is not running: nothing answers CDP on port " + String(port));
  let launchError;
  const child = spawn("box-chrome", ["--new-window"], {
    env: { ...process.env, DISPLAY: ":" + String(display) },
    stdio: "ignore",
  });
  child.once("error", (error) => { launchError = error; });
  child.unref();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await cdpAlive(port)) return;
    if (launchError !== undefined) throw launchError;
    await sleep(500);
  }
  throw new Error("The box browser's CDP endpoint did not come up on port " + String(port));
}

async function configureBrowserDownloads(browser, directory = "/workspace/downloads") {
  mkdirSync(directory, { recursive: true });
  const session = await browser.newBrowserCDPSession();
  const pending = new Map();
  const completed = [];
  session.on("Browser.downloadWillBegin", (event) => {
    pending.set(event.guid, event.suggestedFilename);
  });
  session.on("Browser.downloadProgress", (event) => {
    if (event.state === "inProgress") return;
    const filename = pending.get(event.guid);
    pending.delete(event.guid);
    completed.push({ filename, state: event.state });
  });
  await session.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory, eventsEnabled: true });
  return {
    finish: async () => {
      const deadline = Date.now() + 60000;
      while (pending.size > 0 && Date.now() < deadline) await sleep(50);
      if (pending.size > 0) throw new Error("Browser download timed out");
      if (completed.some((item) => item.state !== "completed")) throw new Error("Browser download failed");
      return completed;
    },
    dispose: () => session.detach(),
  };
}

async function uploadBrowserFiles(page, ref, paths) {
  const workspace = "/workspace";
  const { realpathSync } = await import("node:fs");
  const { resolve, sep } = await import("node:path");
  if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string" || !p.startsWith("/"))) {
    throw new Error("Upload paths must be absolute paths under /workspace");
  }
  const root = realpathSync(workspace);
  const files = paths.map((p) => {
    const resolved = realpathSync(resolve(p));
    if (!resolved.startsWith(root + sep) || !statSync(resolved).isFile()) {
      throw new Error("Upload paths must be files under /workspace");
    }
    return resolved;
  });
  // connectOverCDP's setInputFiles still buffers paths above 50MiB. The box
  // browser shares this filesystem, so pass filenames directly to Chrome.
  const session = await page.context().newCDPSession(page);
  try {
    const remote = await session.send("Runtime.evaluate", {
      expression: "globalThis.__sandRefs instanceof Map ? globalThis.__sandRefs.get(" + JSON.stringify(ref) + ") : undefined",
    });
    if (remote.result.objectId === undefined) throw new Error("Unknown or stale upload ref");
    await session.send("DOM.setFileInputFiles", { files, objectId: remote.result.objectId });
  } finally {
    await session.detach();
  }
}
`;
