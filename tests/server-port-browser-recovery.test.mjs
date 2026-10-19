import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile, readFile, rm, open, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';

const root = process.env.BROWSER_EVIDENCE_DIR ? path.resolve(process.env.BROWSER_EVIDENCE_DIR) : await mkdtemp(path.join(tmpdir(), 'browser-recovery-'));
await mkdir(root, { recursive: true });
const pwPath = process.env.PLAYWRIGHT_CORE_PATH;
if (!pwPath) {
  test('real Chrome recovery fixture', { skip: 'Set PLAYWRIGHT_CORE_PATH to an existing playwright-core package' }, () => {});
} else {
const { chromium } = await import(pathToFileURL(path.join(pwPath, 'index.mjs')).href);
const executable = process.env.CHROME_EXECUTABLE_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const compiled = await build({ entryPoints: ['source/host/runner/tools/sand-browser-driver-source.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { SAND_BROWSER_DRIVER_SOURCE } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const workspace = path.join(root, 'workspace');
await mkdir(workspace, { recursive: true });
// Only fixture paths/imports differ; every exercised function is the emitted production driver.
const moduleSource = SAND_BROWSER_DRIVER_SOURCE.slice(0, SAND_BROWSER_DRIVER_SOURCE.indexOf('const watchdog ='))
  .replace('msg = JSON.parse(String(data));', `msg = JSON.parse(String(data)); writeFileSync(${JSON.stringify(path.join(root, 'cdp.jsonl'))}, JSON.stringify(msg) + "\\n", { flag: "a" });`)
  .replace('"playwright-core/lib/utilsBundle"', JSON.stringify(path.join(pwPath, "lib/utilsBundle.js")))
  .replaceAll('"/workspace', JSON.stringify(workspace).slice(0, -1))
  .replaceAll('"/tmp/.sand-browser"', JSON.stringify(path.join(root, 'state')))
  .replace('import("playwright-core")', `import(${JSON.stringify(pathToFileURL(path.join(pwPath, 'index.mjs')).href)})`);
await writeFile(path.join(root, 'fixture-driver.mjs'), moduleSource + '\nexport { ensureChrome, cdpAlive, configureBrowserDownloads, uploadBrowserFiles, resolvePage, run };\n');
const driver = await import(pathToFileURL(path.join(root, 'fixture-driver.mjs')).href);
const server = createServer((req, res) => {
  if (req.url === '/download') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''original%20report.csv" });
    res.end('fixture,download\n1,ok\n');
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Recovery fixture</title><input id="upload" type="file"><a href="/download">Download</a>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}`;
const portServer = createServer();
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
const profile = path.join(root, 'isolated-profile');
const bin = path.join(root, 'bin');
await mkdir(bin, { recursive: true });
await writeFile(path.join(bin, 'box-chrome'), `#!${process.execPath}\nimport {spawn} from 'node:child_process';\nimport {mkdirSync,appendFileSync} from 'node:fs';\nmkdirSync(${JSON.stringify(profile)},{recursive:true});\nappendFileSync(${JSON.stringify(path.join(root, 'launcher.log'))},'launch\\n');\nconst child=spawn(${JSON.stringify(executable)},${JSON.stringify(['--headless=new', '--disable-background-networking', '--disable-sync', '--disable-default-apps', '--no-first-run', '--no-proxy-server', '--user-data-dir=' + profile, '--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1', 'about:blank'])},{stdio:'ignore',detached:true});\nchild.unref();\nsetTimeout(()=>{},5000);\n`, { mode: 0o755 });
process.env.PATH = bin + path.delimiter + process.env.PATH;
let browser;
async function closeChrome() {
  if (!browser) return;
  const session = await browser.newBrowserCDPSession();
  await session.send('Browser.close');
  await browser.close();
  browser = undefined;
  for (let i = 0; i < 100 && await driver.cdpAlive(port); i++) await new Promise(resolve => setTimeout(resolve, 50));
}
try {
  await test('launcher readiness before exit, no-launch guard, and restart with deleted profile', async () => {
    await assert.rejects(driver.ensureChrome(port, 98, false), /not running/);
    const started = performance.now();
    await driver.ensureChrome(port, 98);
    const readyMs = performance.now() - started;
    assert.ok(readyMs < 5000, `readiness took ${readyMs}ms; launcher deliberately remains alive for 5s`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    await closeChrome();
    await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await driver.ensureChrome(port, 98);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    assert.ok((await stat(profile)).isDirectory());
    assert.equal((await readFile(path.join(root, 'launcher.log'), 'utf8')).trim().split('\n').length, 2);
    await writeFile(path.join(root, 'startup.json'), JSON.stringify({ readyMs, profileRecreated: true, launches: 2 }, null, 2));
  });
  await test('actual CDP Page.crash recovers same page and driver snapshot; missing named view fails closed', async () => {
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    await page.goto(fixtureUrl);
    assert.equal(await page.title(), 'Recovery fixture');
    const session = await context.newCDPSession(page);
    const crashed = page.waitForEvent('crash');
    void session.send('Page.crash').catch(() => undefined);
    await crashed;
    await assert.rejects(page.evaluate(() => 1), /crashed/);
    const result = await driver.run({ op: 'snapshot', cdpPort: port, display: 98 });
    await session.detach();
    await browser.close();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const recoveredPage = browser.contexts()[0].pages()[0];
    assert.equal(await recoveredPage.title(), 'Recovery fixture');
    assert.equal(result.ok, true);
    assert.match(result.data, /Download/);
    await assert.rejects(driver.resolvePage({ viewId: 'lost', op: 'click', display: 98 }, browser.contexts()[0], { views: { lost: 'missing-target' }, urls: {} }), /no open tab/);
    await writeFile(path.join(root, 'crash.json'), JSON.stringify({ crashObserved: true, title: await recoveredPage.title(), result }, null, 2));
  });
  await test('55 MiB path upload, symlink escape rejection, and original download filename', async () => {
    const page = browser.contexts()[0].pages()[0];
    await page.goto(fixtureUrl);
    const upload = path.join(workspace, 'large-fixture.bin');
    const file = await open(upload, 'w');
    await file.truncate(55 * 1024 * 1024);
    await file.close();
    await driver.run({ op: 'snapshot', cdpPort: port, display: 98 });
    const receipt = await driver.run({ op: 'file_upload', cdpPort: port, display: 98, ref: 'e1', paths: [upload] });
    assert.equal(receipt.ok, true);
    const uploaded = await page.locator('#upload').evaluate(el => ({ name: el.files[0].name, size: el.files[0].size }));
    assert.deepEqual(uploaded, { name: 'large-fixture.bin', size: 55 * 1024 * 1024 });
    const outside = path.join(root, 'outside.txt');
    await writeFile(outside, 'not an upload');
    const link = path.join(workspace, 'escape.txt');
    await symlink(outside, link);
    await assert.rejects(driver.uploadBrowserFiles(page, 'e1', [link]), /under \/workspace/);
    const downloadReceipt = await driver.run({ op: 'click', cdpPort: port, display: 98, ref: 'e2' });
    assert.equal(downloadReceipt.ok, true);
    const downloaded = path.join(workspace, 'downloads', 'original report.csv');
    let bytes;
    for (let i = 0; i < 100; i++) {
      try { bytes = await readFile(downloaded, 'utf8'); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(bytes, 'fixture,download\n1,ok\n');
    await writeFile(path.join(root, 'files.json'), JSON.stringify({ uploaded, downloaded, bytes, escapeRejected: true }, null, 2));
  });
} finally {
  await closeChrome();
  await new Promise(resolve => server.close(resolve));
}
}
