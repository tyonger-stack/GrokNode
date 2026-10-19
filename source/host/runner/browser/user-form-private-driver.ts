// Runs only in the box. Input is one private stdin frame; output contains statuses only.
export const USER_FORM_PRIVATE_DRIVER_SOURCE = String.raw`
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
delete process.env.DEBUG;
process.env.PWDEBUG = '0';
const input = createInterface({ input: process.stdin, terminal: false });
const frame = await new Promise(resolve => input.once('line', resolve));
input.close();
let browser;
let request;
const outcomes = [];
let submit;
const host = url => { try { const u = new URL(url); return ['https:', 'http:'].includes(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./, '') : undefined; } catch { return undefined; } };
const mappedTargetId = cdpPort => {
  try {
    const parsed = JSON.parse(readFileSync('/tmp/.sand-browser/views-' + String(cdpPort - 9222) + '.json', 'utf8'));
    const viewId = parsed.lastViewId;
    const target = typeof viewId === 'string' && parsed.views ? parsed.views[viewId] : undefined;
    return typeof target === 'string' && target.length > 0 ? target : undefined;
  } catch { return undefined; }
};
const openPages = context => context.pages().filter(page => typeof page.isClosed !== 'function' || page.isClosed() !== true);
async function pageMatchesTarget(context, page, wanted, deadline) {
  if (Date.now() >= deadline || typeof context.newCDPSession !== 'function') return false;
  let session;
  try {
    session = await context.newCDPSession(page);
    const remaining = Math.max(0, deadline - Date.now());
    const info = await Promise.race([
      session.send('Target.getTargetInfo'),
      new Promise(resolve => setTimeout(() => resolve(undefined), remaining)),
    ]);
    const targetId = info && info.targetInfo ? info.targetInfo.targetId : undefined;
    return targetId === wanted;
  } catch { return false; }
  finally { if (session && typeof session.detach === 'function') await session.detach().catch(() => {}); }
}
async function adoptPage(browser, request) {
  const contexts = browser.contexts();
  const wanted = mappedTargetId(request.cdpPort);
  if (wanted) {
    const deadline = Date.now() + 1000;
    for (const context of contexts) {
      if (typeof context.newCDPSession !== 'function') continue;
      for (const page of openPages(context)) {
        if (await pageMatchesTarget(context, page, wanted, deadline)) return page;
      }
    }
  }
  const pages = contexts.flatMap(openPages);
  const same = pages.filter(page => host(page.url()) === request.domain);
  const pool = same.length > 0 ? same : pages;
  return pool.length > 0 ? pool[pool.length - 1] : undefined;
}

try {
  request = JSON.parse(frame);
  let playwright;
  try { playwright = createRequire(import.meta.url)('playwright-core'); }
  catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    playwright = createRequire('/opt/sand/deps/package.json')('playwright-core');
  }
  const { chromium } = playwright;
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + request.cdpPort, { timeout: 5000 });
  const page = await adoptPage(browser, request);
  if (page && typeof page.setDefaultTimeout === 'function') page.setDefaultTimeout(2000);
  if (!page) {
    for (const entry of request.entries) outcomes.push({ id: entry.field.id, status: 'failed', reason: 'domain_mismatch' });
  } else {
    const anchor = page.url();
    const guard = async () => { const live = await page.evaluate(() => location.href); return host(live) !== request.domain ? 'domain_mismatch' : live !== anchor ? 'page_moved' : undefined; };
    // page.locator pierces iframes, so a selector can resolve inside a frame the
    // top-level guard never saw. The owner frame's own host must match too.
    const frameGuard = async handle => {
      const frame = await handle.ownerFrame();
      const frameUrl = frame === null ? undefined : frame.url();
      if (frameUrl === undefined) return 'stale_locator';
      return host(frameUrl) === request.domain ? undefined : 'domain_mismatch';
    };
    const hiddenOrInert = handle => handle.evaluate(el => el.closest('[aria-hidden="true"], [inert]') !== null);
    for (const entry of request.entries) {
      const target = entry.field.target;
      if (!target) { outcomes.push({ id: entry.field.id, status: 'not_filled' }); continue; }
      let handle;
      let reason = await guard();
      try {
        if (!reason) {
          if (target.kind === 'ref') {
            const ref = await page.evaluateHandle(key => globalThis.__sandRefs?.get(key) ?? null, target.value);
            handle = ref.asElement();
            if (!handle) await ref.dispose();
          } else {
            const locator = target.kind === 'label' ? page.getByLabel(target.value, { exact: true }) : page.locator(target.value);
            if (await locator.count() === 1) handle = await locator.elementHandle();
          }
          if (!handle) reason = 'stale_locator';
          else {
            reason ??= await frameGuard(handle);
            if (!reason && (!(await handle.isVisible()) || !(await handle.isEnabled()) || (await hiddenOrInert(handle)))) reason = 'fill_failed';
            else if (!reason && entry.field.type !== 'checkbox' && entry.field.type !== 'select' && !await handle.isEditable()) reason = 'fill_failed';
          }
        }
        reason ??= await guard();
        if (!reason && handle && request.probeOnly !== true) {
          if (entry.field.type === 'checkbox') await handle.setChecked(entry.value, { timeout: 2000 });
          else if (entry.field.type === 'select') await handle.selectOption(entry.value, { timeout: 2000 });
          else await handle.fill(entry.value, { timeout: 2000 });
          if (entry.field.secret === true || entry.field.type === 'password' || entry.field.type === 'otp') {
            // Structured snapshots redacted only password-typed inputs officially,
            // which reads an OTP straight back; this marker closes that channel.
            await handle.evaluate(el => el.setAttribute('data-sand-write-only', '1'));
            // Computer screenshots are raw pixels, so mask the rendered glyphs too.
            // Only the presentation changes: value, type and submit semantics stay.
            await handle.evaluate(el => el.style.setProperty('-webkit-text-security', 'disc', 'important'));
          }
          reason = await guard();
          if (!reason && request.submitAfterFill === true && request.entries.length === 1 && entry.field.type === 'otp') {
            submit = { attempted: true, succeeded: false };
            if (!await guard() && !await frameGuard(handle) && await handle.isVisible() && await handle.isEditable()) {
              await handle.press('Enter', { timeout: 2000 });
              submit.succeeded = true;
            }
          }
        }
      } catch { reason = page.isClosed() ? 'driver_unavailable' : host(page.url()) !== request.domain ? 'domain_mismatch' : page.url() !== anchor ? 'page_moved' : 'fill_failed'; }
      finally { if (handle) await handle.dispose(); }
      outcomes.push(reason ? { id: entry.field.id, status: 'failed', reason } : { id: entry.field.id, status: 'filled' });
    }
  }
} catch {
  for (const entry of request?.entries ?? []) if (!outcomes.some(o => o.id === entry.field.id)) outcomes.push({ id: entry.field.id, status: 'failed', reason: 'driver_unavailable' });
} finally {
  const line = '__USER_FORM_RESULT__' + JSON.stringify({ fields: outcomes, ...(request?.submitAfterFill ? { submit: submit ?? { attempted: false } } : {}) }) + '\n';
  await new Promise(resolve => { process.stdout.write(line, () => resolve()); });
  process.exit(0);
}
`;
