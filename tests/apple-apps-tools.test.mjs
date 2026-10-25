import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const outfile = path.join(repoRoot, "node_modules", ".cache", "apple-apps-tools-contract.cjs");
await build({
  entryPoints: [path.join(repoRoot, "source/shared/node/apple-apps-tools.ts")],
  bundle: true, platform: "node", format: "cjs", outfile, logLevel: "error",
});
const {
  APPLE_APP_DOMAINS, APPLE_CONTACTS_LIMIT_DEFAULT, APPLE_CONTACTS_LIMIT_MAX,
  APPLE_DOMAIN_DISPLAY_NAMES, APPLE_DOMAIN_PERMISSIONS, APPLE_NOTES_MAX_CHARS,
  APPLE_PERMISSION_STATES, APPLE_READ_LIMIT_DEFAULT, APPLE_READ_LIMIT_MAX,
  APPLE_SIDECAR_DESCRIPTORS, APPLE_SIDECAR_ERROR_CODES, APPLE_SIDECAR_LAUNCH_POLL_MS,
  APPLE_SIDECAR_LAUNCH_WINDOW_MS, APPLE_SIDECAR_TIMEOUT_CALL_MS,
  APPLE_SIDECAR_TIMEOUT_LOCATION_MS, APPLE_SIDECAR_TIMEOUT_SHORT_MS, APPLE_TOOL_KEYS,
  appleDomainForPermissionKey, appleTccRemediation, clampAppleContactsLimit, clampAppleLimit,
  clampAppleReadLimit,
} = require(outfile);

const evidencePath = fileURLToPath(new URL("../../rea-grokbot-0758/apple/evidence.json", import.meta.url));
const evidence = existsSync(evidencePath)
  ? JSON.parse(await readFile(evidencePath, "utf8"))
  : undefined;
const options = { skip: evidence === undefined && "0.75.8 apple evidence is absent" };

function anchorText(name) {
  const match = evidence.anchors[name]?.matches?.[0]?.text;
  assert.ok(typeof match === "string" && match.length > 0, `evidence anchor ${name} is missing`);
  return match;
}

function includes(haystack, needle, message) {
  assert.ok(haystack.includes(needle), message ?? `expected upstream bytes to contain ${JSON.stringify(needle)}`);
}

test("domain list, probes, bundles, and permission states match the upstream bytes", options, () => {
  assert.deepEqual(APPLE_APP_DOMAINS, ["reminders", "calendar", "contacts", "notes", "mail"]);
  assert.match(anchorText("domain-list"), /Apr=\["reminders","calendar","contacts","notes","mail"\]/);
  const probeMap = anchorText("domain-probe-map");
  for (const domain of APPLE_APP_DOMAINS) {
    const p = APPLE_DOMAIN_PERMISSIONS[domain];
    const others = p.others.length === 0 ? "others:\\[\\]" : `others:\\[${p.others.map((o) => `"${o}"`).join(",")}\\]`;
    assert.match(probeMap, new RegExp(`${domain}:\\{probe:"${p.probe}",${others}\\}`), `${domain} probe/others mismatch`);
  }
  const bundles = anchorText("bundle-table");
  for (const domain of APPLE_APP_DOMAINS) {
    includes(bundles, `${domain}:{bundleId:"${APPLE_DOMAIN_PERMISSIONS[domain].bundleId}"`, `${domain} bundleId mismatch`);
  }
  includes(anchorText("permission-states"), APPLE_PERMISSION_STATES.join('","'));
});

test("tool keys are the TCC permission keys the daemon dispatches on", options, () => {
  const upstreamKeys = [
    anchorText("permission-keys-ios"), anchorText("permission-keys-mac"),
    anchorText("permission-key-contacts"), anchorText("permission-key-calendar"),
    anchorText("domain-probe-map"),
  ].join("\n");
  for (const key of APPLE_TOOL_KEYS) {
    if (key === "device_get_location") continue;
    includes(upstreamKeys, `"${key}"`, `tool key ${key} absent from upstream permission bytes`);
    assert.ok(appleDomainForPermissionKey(key) !== undefined, `tool key ${key} has no domain`);
  }
  includes(anchorText("apple-events-op-dispatch"), "case Gpr:");
  assert.equal(appleDomainForPermissionKey("mac_read_notes"), "notes");
  assert.equal(appleDomainForPermissionKey("mac_draft_mail"), "mail");
  assert.equal(appleDomainForPermissionKey("ios_write_reminders"), "reminders");
  assert.equal(appleDomainForPermissionKey("unknown_key"), undefined);
});

test("limits and timeouts match upstream constants", options, () => {
  assert.equal(APPLE_NOTES_MAX_CHARS, 20_000);
  includes(anchorText("notes-max-chars"), "znt=2e4");
  const limits = anchorText("contacts-limits");
  assert.ok(limits.includes(`Qpr=${APPLE_CONTACTS_LIMIT_DEFAULT}`) && limits.includes(`e0r=${APPLE_CONTACTS_LIMIT_MAX}`));
  includes(anchorText("calendar-window"), "Vpr=10080*60*1e3");
  includes(anchorText("calendar-window"), "SD=744*60*60*1e3");
  includes(anchorText("sidecar-timeouts"), "vpr=75e3");
  includes(anchorText("sidecar-timeouts"), "Rpr=1e5");
  includes(anchorText("sidecar-launch-retry"), "Ckt=8e3");
  includes(anchorText("sidecar-launch-retry"), "Ikt=200");
  assert.deepEqual(
    { short: APPLE_SIDECAR_TIMEOUT_SHORT_MS, call: APPLE_SIDECAR_TIMEOUT_CALL_MS, location: APPLE_SIDECAR_TIMEOUT_LOCATION_MS, launchWindow: APPLE_SIDECAR_LAUNCH_WINDOW_MS, launchPoll: APPLE_SIDECAR_LAUNCH_POLL_MS },
    { short: 10_000, call: 75_000, location: 100_000, launchWindow: 8_000, launchPoll: 200 },
  );
});

test("sidecar error codes are the upstream taxonomy verbatim", options, () => {
  includes(anchorText("sidecar-error-codes"), '"sidecar_not_running"');
  const locationErrors = anchorText("location-errors");
  for (const code of APPLE_SIDECAR_ERROR_CODES) {
    if (code.startsWith("location_")) includes(locationErrors, `"${code}"`, `${code} missing from upstream location error list`);
  }
  assert.ok(APPLE_SIDECAR_ERROR_CODES.includes("sidecar_timeout"));
});

test("sidecar descriptors carry the upstream bundle identities byte for byte", options, () => {
  const descriptors = anchorText("sidecar-descriptors");
  for (const variant of ["prod", "lab", "dev"]) {
    const d = APPLE_SIDECAR_DESCRIPTORS[variant];
    includes(descriptors,
      `${variant}:{variant:"${variant}",appName:"${d.appName}",bundleId:"${d.bundleId}",appSupportDir:"${d.appSupportDir}",executable:"${d.executable}"`,
      `${variant} descriptor must match upstream Z5`);
  }
});

test("tcc remediation copy reproduces the upstream jge() sentences", options, () => {
  const copy = anchorText("tcc-remediation-copy");
  for (const domain of APPLE_APP_DOMAINS) {
    includes(copy, `"${APPLE_DOMAIN_DISPLAY_NAMES[domain]}"`, `display name for ${domain} comes from upstream tst`);
  }
  assert.equal(appleTccRemediation("notes"),
    "Grok Bot isn't allowed to control Notes on this Mac. Turn on Notes under Grok Bot Computer Use in System Settings > Privacy & Security > Automation.");
  assert.equal(appleTccRemediation("mail"),
    "Grok Bot isn't allowed to control Mail on this Mac. Turn on Mail under Grok Bot Computer Use in System Settings > Privacy & Security > Automation.");
  assert.equal(appleTccRemediation("calendar"),
    "Calendar access for Grok Bot Computer Use is off or adds events only on this Mac. Give it Full Access in System Settings > Privacy & Security > Calendars.");
  assert.equal(appleTccRemediation("reminders", "Grok Node Computer Use"),
    "Reminders access for Grok Node Computer Use is off on this Mac. Give it Full Access in System Settings > Privacy & Security > Reminders.");
  assert.equal(appleTccRemediation("contacts"),
    "Contacts access for Grok Bot Computer Use is off on this Mac. Turn it on in System Settings > Privacy & Security > Contacts.");
});

test("limit clamps behave like the upstream limitOf helpers", () => {
  assert.equal(clampAppleReadLimit(undefined), 100);
  assert.equal(clampAppleReadLimit(9999), 500);
  assert.equal(clampAppleReadLimit(0), 1);
  assert.equal(clampAppleReadLimit(3.9), 3);
  assert.equal(clampAppleReadLimit(Number.NaN), 100);
  assert.equal(clampAppleContactsLimit(undefined), 10);
  assert.equal(clampAppleContactsLimit(99), 50);
  assert.equal(clampAppleContactsLimit(2), 2);
  assert.equal(clampAppleLimit("7", 100, 500), 100);
});

test("messages op union shape stays aligned with upstream XI", options, () => {
  const union = anchorText("messages-op-union");
  for (const kind of ["find-chats", "items", "search", "activity", "check-permissions", "fetch-attachment", "find-contacts"]) {
    includes(union, `"${kind}"`, `messages op ${kind} exists upstream`);
  }
  includes(union, '"iMessage","SMS","auto"');
  includes(anchorText("messages-consent"), "messages-consent-result");
  includes(anchorText("messages-consent"), "messages-accepted");
});
