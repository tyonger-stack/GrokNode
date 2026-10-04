import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(repoRoot, ...p), "utf8");
const VIEW = read("frontend", "src", "extensions", "marketplace", "view.ts");
const STYLES = read("frontend", "src", "extensions", "marketplace", "official-styles.ts");

const classesOf = (name) => {
  const i = STYLES.indexOf(`export const ${name}`);
  assert.ok(i >= 0, `official-styles.ts has no ${name}`);
  const s = STYLES.indexOf("[", i);
  const e = STYLES.indexOf("]", s);
  return (STYLES.slice(s, e).match(/"([^"]+)"/g) ?? []).map((x) => x.slice(1, -1));
};

/**
 * The detail hero and the account row both rendered wrong for months behind a fully green suite.
 *
 * Shared cause: the class list on the node was already correct, so every source assertion passed,
 * but two things the recipe cannot express were missing —
 *   - official sizes the hero icon with an INLINE style, and `sand-tool-icon--logo` has no rule in
 *     either stylesheet, so nothing constrained the span and the img's own `width:100%` blew up;
 *   - the hero wrapper and the account name column were never given their flex classes, so the
 *     name and its edit button stacked and the name was clipped by an ellipsizing <dt>.
 *
 * Measured on official 0.66.0, Gmail detail page: hero 734x88, icon span 56x56 (img 56/56 attrs
 * computing to 55 through a 1px border), accounts block 734x85, account row 734x42, name 57 wide
 * showing the full "default".
 */

test("the hero icon is sized inline, because no class can size it", () => {
  // `sand-tool-icon--logo` carries no rule in 0.18 or in official, so the box must come from the
  // element. Without it the img resolved width:100% against an unconstrained flex item: 401x401,
  // which is what added 346px of page height.
  assert.match(VIEW, /box\.style\.width\s*=\s*"56px"/);
  assert.match(VIEW, /box\.style\.height\s*=\s*"56px"/);
  assert.match(VIEW, /box\.style\.borderRadius\s*=\s*"16px"/);
  // Official's img attributes are 56/56; it computes to 55 through its own 1px border. Setting 55
  // here, as this build did, is off by one against official.
  assert.match(VIEW, /image\.width\s*=\s*56;/);
  assert.match(VIEW, /image\.height\s*=\s*56;/);
  assert.doesNotMatch(VIEW, /image\.width\s*=\s*55;/, "official's attributes are 56/56");
  // A regression to styling the img instead of the wrapper would bring the 401x401 back.
  assert.doesNotMatch(VIEW, /image\.style\.(width|height)\s*=/);
});

test("the hero wrapper carries official's four flex classes", () => {
  // Without them `head` was a bare div: a block with no 12px gap, so the band measured 12px short
  // and, more importantly, the icon had no column to size inside.
  const head = classesOf("DETAIL_HEAD_CLASSES");
  assert.deepEqual(head, ["sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-1v2ro7d"]);
  assert.match(VIEW, /const head = el\("div", DETAIL_HEAD_CLASSES\);/);

  // All four declarations exist in 0.18 unchanged (box-sizing / display:flex / flex-direction:column
  // / gap:12px), so this must stay a class application, never a lifted rule. If someone "fixes" this
  // by adding a LIFTED_OFFICIAL_RULES entry, the lift is redundant and will drift.
  const liftStart = STYLES.indexOf("export const LIFTED_OFFICIAL_RULES");
  const liftBody = STYLES.slice(liftStart, STYLES.indexOf("\n]", liftStart));
  for (const cls of head) {
    assert.doesNotMatch(liftBody, new RegExp(`"${cls}"`), `${cls} is declared by 0.18; lifting it is redundant`);
  }
});

test("the account name is a flex row beside the edit button, not an ellipsizing <dt>", () => {
  const column = classesOf("DETAIL_ACCOUNT_NAME_CLASSES");
  assert.deepEqual(column, ["sand-9f619", "sand-78zum5", "sand-dt5ytf", "sand-12mrbbr", "sand-euugli"]);
  // `display:flex` + `flex-direction:column` + `gap:1px` are what keep the row at 42px; the two
  // that were missing are why the pencil wrapped and the row became 57px.
  assert.ok(column.includes("sand-78zum5"), "display:flex");
  assert.ok(column.includes("sand-dt5ytf"), "flex-direction:column");

  const row = classesOf("DETAIL_ACCOUNT_NAME_ROW_CLASSES");
  assert.deepEqual(row, ["sand-9f619", "sand-78zum5", "sand-6s0dn4", "sand-1nejdyq", "sand-euugli"]);

  // The account key must not be a <dt> carrying DETAIL_INFO_TERM_CLASSES: that recipe includes
  // overflow:hidden and text-overflow:ellipsis, and with no width to grow into it rendered 21px
  // wide and clipped "default" to "d...".
  const accountBlock = VIEW.slice(VIEW.indexOf("const list = el(\"div\", DETAIL_ACCOUNTS_CLASSES)"));
  assert.doesNotMatch(accountBlock, /el\("dt", DETAIL_INFO_TERM_CLASSES/);
  assert.match(accountBlock, /el\("span", DETAIL_ACCOUNT_NAME_ROW_CLASSES, account\.key\)/);
  assert.match(accountBlock, /nameRow\.append\(edit\)/, "the edit button belongs inside the row");
  // The 信息 section legitimately keeps its <dt>; only the account row changed.
  assert.match(VIEW, /el\("dt", DETAIL_INFO_TERM_CLASSES, term\)/);
});
