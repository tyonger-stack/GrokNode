/**
 * Official Grok Bot 0.78.1's second-level "管理插件和技能" page rules, injected into upstream 0.18's
 * stylesheet.
 *
 * ## What this step does
 *
 * The renderer patch re-recipes the plugin row, the plugins grid, the section header, the show-all
 * control, the collapsed remainder list, the hero and the detail bar's labelled back button with
 * official 0.78.1's own class recipes. A stylix class name is the hash of its declaration block, so
 * a class that exists in official 0.78.1's stylesheet and not in upstream 0.18's is a NO-OP: the
 * element renders unstyled and nothing throws. Every other test stays green.
 *
 * This step appends the rules for those classes to the staged renderer stylesheet. The rules
 * themselves are not authored here — they are lifted byte-for-byte from official 0.78.1's own
 * stylesheet into `marketplace-manage-page-0781-official.css`, the same way the sibling wave's
 * dialog / browse-chrome / detail-view companions are.
 *
 * ## Why the rules are scoped
 *
 * The scope is the plugins-dialog subtree, the convention the sibling wave's theme-token and
 * typography companions already use:
 *
 *   `:where(.sand-plugins-dialog) ` — a DESCENDANT prefix on every selector of the rule.
 *
 * `:where()` contributes NO specificity, so a ported rule weighs against upstream 0.18's own class
 * rules exactly as official's rule weighs against official's. A plain `.sand-plugins-dialog` prefix
 * would add one class of specificity and silently reorder the `:not(#\#)` ladder that orders these
 * rules against their neighbours.
 *
 * ## Fail closed
 *
 * The class list is the measured fixture, not a hand-written one, so the port cannot drift away
 * from the stylesheet silently:
 *
 *   * every class the port applies must resolve INSIDE the plugins dialog in the staged
 *     stylesheet once this step ran — a class that resolves nowhere is a hard error, not a
 *     skipped line;
 *   * a class that does not resolve yet must be covered by the companion CSS, or the step throws;
 *   * every rule in the companion CSS must carry the scope prefix on every selector;
 *   * every rule in the companion CSS must be byte-for-byte a rule of official 0.78.1's stylesheet
 *     (checked whenever the 0.78.1 analysis tree is present on this machine);
 *   * the companion CSS must reproduce byte-for-byte when re-rendered from its parsed blocks, so a
 *     hand edit that the injector cannot reproduce is caught instead of silently shipped.
 *
 * Read-only apart from the staged stylesheet: this step appends bytes to the staged renderer CSS
 * and records its hashes as evidence.
 *
 * @evidence official 0.78.1 `rea-grokbot-0781/app/dist/renderer/assets/index-Dh7EWA8t.css`
 * @evidence upstream 0.18 `src/app/dist/renderer/assets/index-lCyB53CO.css`
 * @evidence `tests/fixtures/official-0781-manage-page-recipes.json` — the measured recipes.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OFFICIAL_CSS_FILE = "marketplace-manage-page-0781-official.css";
const OFFICIAL_STYLESHEET = new URL(
  "../../../rea-grokbot-0781/app/dist/renderer/assets/index-Dh7EWA8t.css",
  import.meta.url,
);
const RECIPES_FIXTURE = new URL(
  "../../tests/fixtures/official-0781-manage-page-recipes.json",
  import.meta.url,
);

/** The scope prefix every ported rule carries. `:where()` keeps the rule's own specificity. */
export const MARKETPLACE_MANAGE_PAGE_0781_SCOPE = ":where(.sand-plugins-dialog) ";

/**
 * The dialog subtree the ported rules are scoped to.
 *
 * A class token appearing anywhere in the staged stylesheet is NOT the same as a class the dialog
 * actually renders with that style. The repo's own conversation-computer-card port carries
 * official's green rule scoped to `.r-conversation-computer-card`, so the staged stylesheet holds
 * `sand-1ufr4hg` and never styles it inside the plugins dialog — the connected badge would render
 * white without the rule below. Every "already carried" and "resolves" test is therefore scoped.
 */
const DIALOG_CLASS = "sand-plugins-dialog";

/**
 * The classes the port applies, read out of the measured fixture.
 *
 * `privateRow.*` is the same row component on the private-skills section; the show-all wrapper and
 * the back button's inner icon and label spans are not in the fixture — they are the live-DOM
 * measurements quoted in the port spec (§2.3 and §2.6) and are declared here verbatim.
 */
const RECIPE_FIELDS = [
  ["yours", "class"],
  ["hero", "class"],
  ["hero", "wrapperClass"],
  ["detailBar", "class"],
  ["detailBar", "buttonClass"],
  ["detailBar", "h3Class"],
  ["detailBar", "h3HiddenClass"],
  ["detailBar", "trailingClass"],
  ["installedSection", "class"],
  ["installedSection", "headerClass"],
  ["installedSection", "h3Class"],
  ["installedSection", "gridClass"],
  ["privateSection", "class"],
  ["privateSection", "headerClass"],
  ["privateSection", "h3Class"],
  ["privateSection", "gridClass"],
  ["row", "class"],
  ["row", "openClass"],
  ["row", "mainClass"],
  ["row", "nameClass"],
  ["row", "subtitleClass"],
  ["row", "trailingClass"],
  ["row", "statusClass"],
  ["privateRow", "class"],
  ["privateRow", "openClass"],
  ["privateRow", "mainClass"],
  ["privateRow", "nameClass"],
  ["privateRow", "subtitleClass"],
  ["privateRow", "trailingClass"],
  ["privateRow", "iconClass"],
  ["showAll", "class"],
  ["collapsed", "class"],
  ["collapsed", "innerClass"],
  ["collapsed", "gridClass"],
];

/** The port-spec's own live-DOM measurements, which the fixture does not carry. */
const SPEC_MEASUREMENTS = {
  // §2.3 — the visible wrapper around the "显示全部 N 个插件" control.
  showAllWrapper:
    "sand-rvj5dj sand-1erjwpq sand-1ympp8d sand-1upsisp sand-t35mv4 sand-1r6a6jf sand-1tu4anv sand-1hc1fzr sand-67bb7w",
  // §2.6 — the labelled back button's inner icon span.
  backButtonIcon:
    "sand-kit-icon sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-2lah0s sand-1heor9g sand-w4jnvo sand-1qx5ct2",
  // §2.6 — the labelled back button's label span.
  backButtonLabel: "sand-b3r6kr sand-lyipyv sand-uxw1ft",
};

/**
 * The classes official 0.78.1 itself gives no rule to.
 *
 * They are stylix namespace markers or plain hooks (`sand-plugins__group`, `sand-plugins-row`,
 * `sand-kit-icon`, `ui-text`, …). Nothing is lifted for them and nothing may be asserted about
 * them: official's own stylesheet carries no rule for any of them either.
 */
export const MARKETPLACE_MANAGE_PAGE_0781_NOOP_CLASSES = [
  "sand-kit-icon",
  "sand-plugins-row",
  "sand-plugins-row__main",
  "sand-plugins-row__name",
  "sand-plugins-row__open",
  "sand-plugins-row__subtitle",
  "sand-plugins-row__trailing",
  "sand-plugins__grid",
  "sand-plugins__group",
  "sand-plugins__show-all",
  "sand-plugins__status",
  "sand-plugins__yours",
  "sand-settings-detail-bar",
  "ui-text",
];

/**
 * The alias classes official ships inside a rule that is lifted for another class.
 *
 * Official writes one declaration under two names when two recipes share it; the alias travels
 * with the rule and is scoped with it.
 */
const COMPANION_ALIAS_CLASSES = ["sand-11ct0s3", "sand-1f9r7lp", "sand-vhurb8"];

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** Strip quoted strings so a `.` inside an attribute value is not read as a class. */
function unquote(selector) {
  return selector.replace(/"[^"]*"|'[^']*'/g, "");
}

/** The class tokens a selector mentions. */
function classesInSelector(selector) {
  return [...unquote(selector).matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)].map((match) => match[1]);
}

/**
 * Parse a stylesheet into its simple rules, each with the chain of at-rules that wraps it.
 *
 * @returns {{ selector: string, body: string, text: string, context: string[] }[]}
 */
function parseStylesheet(css) {
  const rules = [];
  let index = 0;
  let buffer = "";

  const parseBlock = (context) => {
    while (index < css.length) {
      const ch = css[index];
      if (ch === "}") return;
      if (ch === "{") {
        const prelude = buffer.trim();
        buffer = "";
        const bodyStart = index + 1;
        let depth = 1;
        let cursor = bodyStart;
        while (cursor < css.length && depth > 0) {
          if (css[cursor] === "{") depth += 1;
          else if (css[cursor] === "}") depth -= 1;
          if (depth === 0) break;
          cursor += 1;
        }
        const body = css.slice(bodyStart, cursor);
        if (prelude.startsWith("@")) {
          const skip =
            prelude.startsWith("@keyframes") ||
            prelude.startsWith("@font-face") ||
            prelude.startsWith("@property");
          if (!skip) {
            index = bodyStart;
            parseBlock([...context, prelude]);
          }
        } else {
          rules.push({
            selector: prelude,
            body,
            text: `${prelude}{${body}}`,
            context: [...context],
          });
        }
        index = cursor + 1;
        buffer = "";
        continue;
      }
      buffer += ch;
      index += 1;
    }
  };

  parseBlock([]);
  return rules;
}

/** The class tokens a stylesheet's selectors mention. */
function classesInStylesheet(css) {
  const classes = new Set();
  for (const rule of parseStylesheet(css)) {
    for (const name of classesInSelector(rule.selector)) classes.add(name);
  }
  return classes;
}

/** Split one selector into its descendant compounds, honouring parentheses. */
function splitCompounds(selector) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    if (depth === 0 && (/\s/.test(ch) || ch === ">" || ch === "+" || ch === "~")) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * The classes a rule's SUBJECT carries.
 *
 * The subject is the last compound. The classes in the scope chain are ancestors,
 * so they style their own element and not the subject.
 */
function subjectClasses(selector) {
  const compounds = splitCompounds(selector);
  if (compounds.length === 0) return [];
  return classesInSelector(compounds[compounds.length - 1]);
}

/**
 * The classes a stylesheet actually styles INSIDE the plugins dialog.
 *
 * A class token appearing anywhere is not enough. The staged stylesheet carries
 * `.r-conversation-computer-card .sand-1ufr4hg{color:…}` — the green the connected
 * badge needs — but that rule never reaches the plugins dialog, so the port still has
 * to carry the rule itself. A rule reaches the dialog when it is unscoped, or when
 * its scope chain names the dialog.
 */
function classesStyledInDialog(css, dialogClass) {
  const covered = new Set();
  for (const rule of parseStylesheet(css)) {
    for (const part of splitSelectors(rule.selector)) {
      const compounds = splitCompounds(part);
      const scopes = compounds.slice(0, -1);
      const reaches =
        scopes.length === 0 || scopes.some((scope) => scope.includes(dialogClass));
      if (!reaches) continue;
      for (const name of subjectClasses(part)) covered.add(name);
    }
  }
  return covered;
}

/**
 * The classes a stylesheet styles inside the plugins dialog.
 *
 * Exported so the regression test can assert the scope-aware behaviour without reaching into
 * the injector's internals.
 */
export function marketplaceManagePage0781ClassesStyledInDialog(css) {
  return classesStyledInDialog(css, DIALOG_CLASS);
}

/** Every rule that mentions a class, keyed by the class. */
function rulesByClass(css) {
  const byClass = new Map();
  for (const rule of parseStylesheet(css)) {
    for (const name of classesInSelector(rule.selector)) {
      if (!byClass.has(name)) byClass.set(name, []);
      byClass.get(name).push(rule);
    }
  }
  return byClass;
}

/** Split a selector list on its top-level commas. */
function splitSelectors(selector) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Render a parsed block back to CSS, so a hand edit the injector cannot reproduce is caught. */
function renderBlock(block) {
  const rules = block.rules.join("\n");
  if (block.context.length === 0) return rules;
  return `${block.context.join(" ")}{\n${rules}\n}`;
}

const companionCss = readFileSync(new URL(`./${OFFICIAL_CSS_FILE}`, import.meta.url), "utf8");

/** The companion CSS without its comment header. */
function companionBody(css) {
  const start = css.indexOf("*/");
  if (!css.trimStart().startsWith("/*") || start < 0) {
    throw new Error(
      "Marketplace manage-page CSS patch: the companion must start with a comment header.",
    );
  }
  return css.slice(start + 2).trim();
}

/** The companion CSS parsed into blocks: at-rules keep their wrapper. */
function companionBlocks(css) {
  const body = companionBody(css);
  const rules = parseStylesheet(body);
  const blocks = [];
  for (const rule of rules) {
    const contextKey = rule.context.join(" ");
    const last = blocks[blocks.length - 1];
    if (last && last.contextKey === contextKey) {
      last.rules.push(rule.text);
      continue;
    }
    blocks.push({ contextKey, context: rule.context, rules: [rule.text] });
  }
  return { blocks, body };
}

/**
 * Official's own rule for each class the companion lifts, byte for byte.
 *
 * The scope prefix is stripped from every selector, so the result is exactly the text official
 * 0.78.1's stylesheet carries — a test can assert `officialStylesheet.includes(rule)`.
 */
export const MARKETPLACE_MANAGE_PAGE_0781_OFFICIAL_RULES = (() => {
  const { blocks } = companionBlocks(companionCss);
  const official = {};
  for (const block of blocks) {
    for (const rule of block.rules) {
      const selector = rule.slice(0, rule.indexOf("{"));
      const body = rule.slice(rule.indexOf("{"));
      const parts = splitSelectors(selector).map((part) => {
        if (!part.startsWith(MARKETPLACE_MANAGE_PAGE_0781_SCOPE)) {
          throw new Error(
            `Marketplace manage-page CSS patch: a companion rule is not scoped: ${rule.slice(0, 80)}`,
          );
        }
        return part.slice(MARKETPLACE_MANAGE_PAGE_0781_SCOPE.length);
      });
      const officialText = `${parts.join(",")}${body}`;
      for (const name of classesInSelector(selector)) {
        if (name === "sand-plugins-dialog") continue;
        official[name] = officialText;
      }
    }
  }
  return Object.freeze(official);
})();

/** The class names the port applies, read out of the measured fixture. */
export const MARKETPLACE_MANAGE_PAGE_0781_PORTED_CLASSES = (() => {
  const fixture = JSON.parse(readFileSync(RECIPES_FIXTURE, "utf8"));
  const classes = new Set();
  for (const [group, field] of RECIPE_FIELDS) {
    const value = fixture[group]?.[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `Marketplace manage-page CSS patch: the recipes fixture has no ${group}.${field}.`,
      );
    }
    for (const name of value.split(/\s+/)) if (name) classes.add(name);
  }
  for (const value of Object.values(SPEC_MEASUREMENTS)) {
    for (const name of value.split(/\s+/)) if (name) classes.add(name);
  }
  return Object.freeze([...classes].sort());
})();

/**
 * Official Grok Bot 0.78.1's second-level "管理插件和技能" page rules, added to the staged stylesheet.
 *
 * @param {{ stageRoot: string }} options
 * @returns {Promise<object>} the provenance record this step wrote.
 */
export async function applyMarketplaceManagePage0781Css({ stageRoot }) {
  const assets = path.join(stageRoot, "dist", "renderer", "assets");
  const stylesheets = (await readdir(assets)).filter((name) => /^index-.*\.css$/.test(name));
  if (stylesheets.length !== 1) {
    throw new Error(
      `Marketplace manage-page CSS patch: expected one main stylesheet, found ${stylesheets.length}.`,
    );
  }
  const file = stylesheets[0];
  const cssPath = path.join(assets, file);
  const original = await readFile(cssPath, "utf8");

  const { blocks, body } = companionBlocks(companionCss);
  if (blocks.map(renderBlock).join("\n\n") !== body) {
    throw new Error(
      "Marketplace manage-page CSS patch: the companion CSS does not reproduce byte-for-byte from " +
        "its parsed blocks.",
    );
  }

  // The classes upstream 0.18 styles INSIDE the plugins dialog. A class token that only appears
  // under a scope that never reaches the dialog does not count as carried.
  const stagedInDialog = classesStyledInDialog(original, DIALOG_CLASS);
  const portedClasses = MARKETPLACE_MANAGE_PAGE_0781_PORTED_CLASSES;
  const noopClasses = new Set(MARKETPLACE_MANAGE_PAGE_0781_NOOP_CLASSES);

  // Every class the port applies must resolve once this step ran.
  const unresolved = portedClasses.filter(
    (name) => !noopClasses.has(name) && !stagedInDialog.has(name),
  );
  const companionClasses = new Set(Object.keys(MARKETPLACE_MANAGE_PAGE_0781_OFFICIAL_RULES));
  const uncovered = unresolved.filter((name) => !companionClasses.has(name));
  if (uncovered.length > 0) {
    throw new Error(
      "Marketplace manage-page CSS patch: these classes resolve nowhere and the companion CSS " +
        `does not carry a rule for them: ${uncovered.join(", ")}.`,
    );
  }

  // A rule that lifts a class the port does not apply is dead weight; fail closed on it.
  const stray = [...companionClasses].filter(
    (name) =>
      !portedClasses.includes(name) && !COMPANION_ALIAS_CLASSES.includes(name),
  );
  if (stray.length > 0) {
    throw new Error(
      `Marketplace manage-page CSS patch: the companion CSS carries rules for classes the port does ` +
        `not apply: ${stray.join(", ")}.`,
    );
  }

  // Byte-for-byte official, whenever the 0.78.1 analysis tree is on this machine.
  let officialStylesheet = null;
  try {
    officialStylesheet = await readFile(OFFICIAL_STYLESHEET, "utf8");
  } catch {
    officialStylesheet = null;
  }
  if (officialStylesheet) {
    for (const [name, rule] of Object.entries(MARKETPLACE_MANAGE_PAGE_0781_OFFICIAL_RULES)) {
      if (!officialStylesheet.includes(rule)) {
        throw new Error(
          `Marketplace manage-page CSS patch: the rule for ${name} is not official 0.78.1's byte ` +
            `for byte: ${rule.slice(0, 80)}`,
        );
      }
    }
    for (const name of noopClasses) {
      const rule = MARKETPLACE_MANAGE_PAGE_0781_OFFICIAL_RULES[name];
      if (rule) {
        throw new Error(
          `Marketplace manage-page CSS patch: ${name} is declared a no-op class but official gives it ` +
            "a rule.",
        );
      }
    }
  }

  // Append the rules the staged stylesheet still lacks. A rule whose CLASS another patch in the
  // chain already carries is left alone: the class is the identity here, not the rule text —
  // otherwise the same declaration would ship twice, once scoped and once not.
  const appended = [];
  const skipped = [];
  const payload = [];
  for (const block of blocks) {
    const needed = [];
    for (const rule of block.rules) {
      const selector = rule.slice(0, rule.indexOf("{"));
      const names = classesInSelector(selector).filter((name) => name !== "sand-plugins-dialog");
      const missing = names.some(
        (name) => portedClasses.includes(name) && !stagedInDialog.has(name),
      );
      if (missing) {
        needed.push(rule);
        appended.push(rule);
      } else {
        skipped.push(rule);
      }
    }
    if (needed.length === 0) continue;
    payload.push(renderBlock({ context: block.context, rules: needed }));
  }

  const patched = payload.length > 0 ? `${original}\n${payload.join("\n\n")}\n` : original;
  if (payload.length > 0) await writeFile(cssPath, patched);

  // Every class the port applies must resolve in the stylesheet this step just wrote — inside
  // the dialog, which is where the ported page renders it.
  const finalInDialog = classesStyledInDialog(patched, DIALOG_CLASS);
  const stillUnresolved = portedClasses.filter(
    (name) => !noopClasses.has(name) && !finalInDialog.has(name),
  );
  if (stillUnresolved.length > 0) {
    throw new Error(
      "Marketplace manage-page CSS patch: these classes still resolve nowhere in the staged " +
        `stylesheet: ${stillUnresolved.join(", ")}.`,
    );
  }

  // A class that resolves must resolve to OFFICIAL's declaration. A class that resolves to some
  // other declaration is the silent-degradation trap: the element renders, the value is wrong, and
  // nothing fails. The rule that carries the class may differ in its guard count — that is the
  // specificity ladder — but not in what it declares.
  const finalRules = rulesByClass(patched);
  const wrongDeclaration = [];
  for (const [name, officialText] of Object.entries(MARKETPLACE_MANAGE_PAGE_0781_OFFICIAL_RULES)) {
    const officialBody = officialText.slice(officialText.indexOf("{") + 1, officialText.lastIndexOf("}"));
    const rules = finalRules.get(name) ?? [];
    if (!rules.some((rule) => rule.body === officialBody)) {
      wrongDeclaration.push(name);
    }
  }
  if (wrongDeclaration.length > 0) {
    throw new Error(
      "Marketplace manage-page CSS patch: these classes resolve, but not to official 0.78.1's " +
        `declaration: ${wrongDeclaration.join(", ")}.`,
    );
  }

  const provenance = {
    mode: "marketplace-manage-page-0781-css",
    referenceVersion: "0.78.1",
    referenceAsarSha256: "e8d5e10f94f8b52cd02f696599c8e6503420ad85ceed7b41a27bbff7bff22f4d",
    file: `dist/renderer/assets/${file}`,
    originalSha256: sha256(original),
    patchedSha256: sha256(patched),
    companionCssSha256: sha256(companionCss),
    scope: MARKETPLACE_MANAGE_PAGE_0781_SCOPE.trim(),
    portedClasses: portedClasses.length,
    noopClasses: MARKETPLACE_MANAGE_PAGE_0781_NOOP_CLASSES,
    liftedClasses: portedClasses.filter((name) => companionClasses.has(name)),
    aliasClasses: [...companionClasses].filter(
      (name) => !portedClasses.includes(name) && COMPANION_ALIAS_CLASSES.includes(name),
    ),
    rules: portedClasses
      .filter((name) => companionClasses.has(name))
      .map((name) => ({ class: name, official: MARKETPLACE_MANAGE_PAGE_0781_OFFICIAL_RULES[name] })),
    appendedRules: appended,
    skippedRules: skipped,
  };
  await writeFile(
    path.join(stageRoot, "dist", "renderer-marketplace-manage-page-0781-css.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  console.log(
    `Marketplace manage-page CSS: official 0.78.1 page rules added (${file}, ${appended.length} of ` +
      `${appended.length + skipped.length} appended; ${provenance.liftedClasses.length} classes lifted).`,
  );
  return provenance;
}
