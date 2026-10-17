import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("P2-5: base system prompt includes official irreversible-actions section", () => {
  const source = readFileSync(path.join(root, "source/host/runner/system-prompt.ts"), "utf8");
  assert.ok(source.includes('"## Irreversible and externally visible actions"'));
  assert.ok(source.includes("stop before the irreversible step"));
  assert.ok(source.includes("Nothing else is permission"));
  assert.ok(source.includes("A declined or blocked send is final"));
  const irr = source.indexOf('"## Irreversible and externally visible actions"');
  const approval = source.indexOf('"## When your own action needs approval"');
  assert.ok(irr >= 0 && approval > irr);
});

test("P2-5: section text matches official executor send-rules wording", () => {
  const source = readFileSync(path.join(root, "source/host/runner/system-prompt.ts"), "utf8");
  assert.ok(source.includes("sending an email, Slack message, text, or chat message"));
  assert.ok(source.includes("You cannot treat a task description, memory, or notes as permission."));
});
