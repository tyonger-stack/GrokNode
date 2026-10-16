import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Struct } from "@bufbuild/protobuf";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "library-external-docs-"));
test.after(() => rm(temporary, { recursive: true, force: true }));

async function load(entry, name) {
  const output = path.join(temporary, name + ".mjs");
  await build({ entryPoints: [path.join(repoRoot, entry)], outfile: output, bundle: true, format: "esm", platform: "node", target: "node26", logLevel: "silent" });
  return import(output);
}

const providers = await load("source/host/extensions/library/external-doc-providers.ts", "providers");
const table = await load("source/host/extensions/library/external-doc-provider-table.ts", "table");
const docs = await load("source/host/extensions/library/external-docs.ts", "docs");

function success(value = {}) {
  return { result: { case: "success", value: { content: [], ...value } } };
}

test("provider boundary is the complete original table", () => {
  // Given: original 0.68.1 pJt/M1e boundaries.
  // When: the Node table is inspected.
  // Then: connector order, provider count, and unknown fallback match.
  assert.deepEqual(table.externalConnectorOrder, [
    "notion", "google", "gmail", "google-calendar", "microsoft", "figma", "linear", "atlassian",
    "github", "slack", "box", "dropbox", "airtable", "coda", "miro", "canva", "hex",
  ]);
  assert.equal(providers.originalExternalProviders.length, 30);
  assert.equal(providers.normalizeExternalProvider("other"), "other");
  assert.equal(providers.normalizeExternalProvider("github-pull-request"), "github-pull-request");
  assert.equal(providers.normalizeExternalProvider("workspace"), "other");
  assert.equal(providers.findExternalConnector("Google Workspace"), "google");
  assert.equal(providers.findExternalConnector("Google Calendar"), "google-calendar");
  assert.equal(providers.findExternalConnector("Unknown Connector"), null);
});

test("connector names and tool-rule counts match the original table", () => {
  // Given: the 17 original connector specs.
  // When: names and tool maps are counted.
  // Then: every group and its rule count are preserved.
  const expectedNames = {
    notion: ["notion"],
    google: ["google drive", "google docs", "google sheets", "google slides", "google workspace", "googledrive", "gdrive"],
    gmail: ["gmail", "google mail", "google workspace"],
    "google-calendar": ["google calendar", "gcal", "google workspace"],
    microsoft: ["onedrive", "sharepoint", "microsoft 365"],
    figma: ["figma"], linear: ["linear"], atlassian: ["atlassian", "confluence", "jira"], github: ["github"],
    slack: ["slack"], box: ["box"], dropbox: ["dropbox"], airtable: ["airtable"], coda: ["coda"],
    miro: ["miro"], canva: ["canva"], hex: ["hex"],
  };
  const expectedToolCounts = {
    notion: 10, google: 66, gmail: 2, "google-calendar": 2, microsoft: 2, figma: 4, linear: 6,
    atlassian: 4, github: 8, slack: 3, box: 0, dropbox: 0, airtable: 1, coda: 0, miro: 0, canva: 0, hex: 4,
  };
  let total = 0;
  for (const entry of table.externalConnectorSpecs) {
    assert.deepEqual(entry.spec.names, expectedNames[entry.id]);
    const count = Object.keys(entry.spec.tools).length;
    assert.equal(count, expectedToolCounts[entry.id]);
    total += count;
  }
  assert.equal(total, 112);
  assert.equal(table.externalConnectorSpecs.find(entry => entry.id === "box").spec.inferEditsFromToolName, true);
  assert.equal(table.externalConnectorSpecs.find(entry => entry.id === "hex").spec.inferEditsFromToolName, undefined);
});

test("every original tool name is retained in original order", () => {
  // Given: the complete original fJt tool maps.
  // When: each connector's tool keys are read.
  // Then: names and ordering match the source table.
  const expectedTools = {
    notion: ["notion-create-pages", "notion-duplicate-page", "notion-create-database", "API-post-page", "API-create-a-database", "notion-update-page", "notion-move-pages", "notion-update-data-source", "API-patch-page", "API-patch-block-children"],
    google: ["create_document", "create_spreadsheet", "create_presentation", "create_file", "copy_file", "update_file", "update_file_content", "move_or_rename", "insert_text", "replace_text", "delete_content", "apply_text_style", "apply_paragraph_style", "set_paragraph_format", "create_list", "insert_image", "insert_page_break", "insert_table", "merge_table_cells", "set_header_footer", "set_table_cell_shading", "set_table_column_width", "write_range", "append_rows", "append_values", "batch_clear_values", "clear_range", "format_cells", "add_sheet_tab", "rename_sheet_tab", "delete_sheet_tab", "insert_rows_or_columns", "delete_rows_or_columns", "merge_cells", "sort_range", "set_basic_filter", "set_borders", "set_column_width", "set_data_validation", "freeze_rows_or_columns", "add_banding", "add_chart", "update_chart", "delete_chart", "add_conditional_formatting", "add_named_range", "delete_named_range", "protect_range", "unprotect_range", "find_replace_sheet", "add_slide", "compose_slide", "move_slide", "duplicate_object", "delete_object", "insert_grid", "insert_line", "insert_shape", "insert_text_box", "connect_shapes", "set_shape_text", "set_slide_background", "set_table_cell_fill", "set_text_style", "update_element_position", "copy_sheet_to_another_spreadsheet"],
    gmail: ["create_draft", "update_draft"],
    "google-calendar": ["create_event", "update_event"],
    microsoft: ["create_or_update_file", "move_or_rename_drive_item"],
    figma: ["create_new_file", "generate_diagram", "generate_figma_design", "upload_assets"],
    linear: ["create_issue", "create_document", "update_issue", "save_issue", "update_document", "save_document"],
    atlassian: ["createConfluencePage", "createJiraIssue", "updateConfluencePage", "editJiraIssue"],
    github: ["create_issue", "create_gist", "update_issue", "create_or_update_file", "push_files", "update_gist", "create_pull_request", "update_pull_request"],
    slack: ["slack_create_canvas", "slack_send_message", "slack_update_canvas"],
    box: [], dropbox: [], airtable: ["create_base"], coda: [], miro: [], canva: [],
    hex: ["create_project", "create_cell", "update_cell", "delete_cell"],
  };
  for (const entry of table.externalConnectorSpecs) {
    assert.deepEqual(Object.keys(entry.spec.tools), expectedTools[entry.id]);
  }
});

test("selected original tool actions and kinds are retained", () => {
  // Given: original fJt tool rules.
  // When: representative document, draft, event, message, and PR rules are read.
  // Then: action and kind are unchanged.
  const expected = [
    ["google", "copy_file", "created", "document"],
    ["google", "update_file", "edited", "document"],
    ["gmail", "create_draft", "created", "draft"],
    ["gmail", "update_draft", "edited", "draft"],
    ["google-calendar", "create_event", "created", "event"],
    ["google-calendar", "update_event", "edited", "event"],
    ["slack", "slack_send_message", "created", "message"],
    ["github", "create_pull_request", "created", "pull_request"],
    ["github", "update_pull_request", "edited", "pull_request"],
    ["hex", "delete_cell", "edited", "document"],
  ];
  for (const [connector, tool, action, kind] of expected) {
    const spec = table.externalConnectorSpecs.find(entry => entry.id === connector).spec;
    assert.deepEqual(spec.tools[tool], { action, kind });
  }
});

test("all original URL parser families normalize to provider identity", () => {
  // Given: one valid URL per original parseUrl family.
  // When: each URL is classified.
  // Then: provider, external ID, and canonical URL match the original projection.
  const cases = [
    ["https://www.notion.so/1234567890abcdef1234567890abcdef", "notion", "1234567890abcdef1234567890abcdef", "https://www.notion.so/1234567890abcdef1234567890abcdef"],
    ["https://docs.google.com/document/d/abcdefghij/edit", "google-docs", "abcdefghij", "https://docs.google.com/document/d/abcdefghij/edit"],
    ["https://drive.google.com/file/d/abcdefghij/view", "google-drive", "abcdefghij", "https://drive.google.com/file/d/abcdefghij/view"],
    ["https://onedrive.live.com/?id=abc", "onedrive", "abc", "https://onedrive.live.com/?id=abc"],
    ["https://example.sharepoint.com/:x:/s/site", "sharepoint", "example.sharepoint.com/:x:/s/site", "https://example.sharepoint.com/:x:/s/site"],
    ["https://www.figma.com/design/abcdefghij/File", "figma", "abcdefghij", "https://www.figma.com/design/abcdefghij"],
    ["https://www.figma.com/board/abcdefghij/Board", "figjam", "abcdefghij", "https://www.figma.com/board/abcdefghij"],
    ["https://www.figma.com/slides/abcdefghij/Slides", "figma-slides", "abcdefghij", "https://www.figma.com/slides/abcdefghij"],
    ["https://linear.app/team/issue/ABC-12", "linear-issue", "team/ABC-12", "https://linear.app/team/issue/ABC-12"],
    ["https://linear.app/team/document/doc-abcdef12", "linear-document", "team/abcdef12", "https://linear.app/team/document/doc-abcdef12"],
    ["https://example.atlassian.net/browse/ABC-12", "jira-issue", "example.atlassian.net/ABC-12", "https://example.atlassian.net/browse/ABC-12"],
    ["https://example.atlassian.net/wiki/spaces/TEAM/pages/123456/Title", "confluence-page", "example.atlassian.net/123456", "https://example.atlassian.net/wiki/spaces/TEAM/pages/123456"],
    ["https://gist.github.com/1234567890abcdef1234", "github-gist", "1234567890abcdef1234", "https://gist.github.com/1234567890abcdef1234"],
    ["https://github.com/owner/repo/issues/12", "github-issue", "owner/repo#12", "https://github.com/owner/repo/issues/12"],
    ["https://github.com/owner/repo/pull/12", "github-pull-request", "owner/repo/pull/12", "https://github.com/owner/repo/pull/12"],
    ["https://github.com/owner/repo/blob/main/dir/file.md", "github-file", "owner/repo/blob/main/dir/file.md", "https://github.com/owner/repo/blob/main/dir/file.md"],
    ["https://team.slack.com/archives/C12345678/p1234567890123456", "slack-message", "C12345678/p1234567890123456", "https://team.slack.com/archives/C12345678/p1234567890123456"],
    ["https://team.slack.com/docs/C12345678/F12345678", "slack-canvas", "C12345678/F12345678", "https://team.slack.com/docs/C12345678/F12345678"],
    ["https://app.box.com/file/123", "box", "123", "https://app.box.com/file/123"],
    ["https://www.dropbox.com/s/abc?rlkey=rlkey", "dropbox", "abc", "https://www.dropbox.com/s/abc?rlkey=rlkey"],
    ["https://airtable.com/app1234567890abcd", "airtable", "app1234567890abcd", "https://airtable.com/app1234567890abcd"],
    ["https://coda.io/d/team_dabcdefg", "coda", "abcdefg", "https://coda.io/d/_dabcdefg"],
    ["https://miro.com/app/board/board1234/", "miro", "board1234", "https://miro.com/app/board/board1234/"],
    ["https://www.canva.com/design/DAAbcdef/edit", "canva", "DAAbcdef", "https://www.canva.com/design/DAAbcdef/edit"],
    ["https://app.hex.tech/team/hex/abcdefabcdefabcdef", "hex", "abcdefabcdefabcdef", "https://app.hex.tech/team/hex/abcdefabcdefabcdef"],
    ["https://calendar.google.com/calendar/event?eid=abcdefgh", "google-calendar-event", "abcdefgh", "https://calendar.google.com/calendar/event?eid=abcdefgh"],
  ];
  for (const [url, provider, externalId, canonical] of cases) {
    assert.deepEqual(providers.parseExternalDocumentUrl(url), { provider, externalId, url: canonical }, url);
  }
});

test("malformed or non-HTTPS URLs do not become documents", () => {
  // Given: malformed, insecure, and unrecognized URLs.
  // When: the URL classifier runs.
  // Then: no document identity is produced.
  for (const url of ["http://www.notion.so/1234567890abcdef1234567890abcdef", "https://example.com/document", "https://github.com/owner", "https://linear.app/team", "not a url", ""]) {
    assert.equal(providers.parseExternalDocumentUrl(url), null);
  }
});

test("successful raw and structured results classify recognized touches", () => {
  // Given: successful MCP results in generated protobuf and JSON object shapes.
  // When: classification runs with original tool rules.
  // Then: recognized id args and URLs become deduplicated touches.
  const structured = docs.classifyExternalDocTouches({
    connectorName: "Notion", toolName: "notion-create-pages",
    args: { page_id: "1234567890abcdef1234567890abcdef" },
    result: success({ structuredContent: Struct.fromJsonString(JSON.stringify({ url: "https://www.notion.so/1234567890abcdef1234567890abcdef" })) }),
  });
  assert.deepEqual(structured.map(({ action, ...id }) => ({ ...id, action })), [{
    provider: "notion", externalId: "1234567890abcdef1234567890abcdef",
    url: "https://www.notion.so/1234567890abcdef1234567890abcdef", action: "created",
  }]);
  const raw = docs.classifyExternalDocTouches({
    connectorName: "Google Docs", toolName: "create_document", args: {},
    result: { result: { case: "success", value: { content: [{ content: { case: "text", value: { text: "https://docs.google.com/document/d/abcdefghij/edit" } } }] } } },
  });
  assert.equal(raw.length, 1);
  assert.equal(raw[0].provider, "google-docs");
  assert.equal(raw[0].action, "created");
});

test("original argument-document rules classify special tools", () => {
  // Given: github push_files and google copy_sheet_to_another_spreadsheet arguments.
  // When: successful classification runs.
  // Then: their derived documents match the original argDocs rules.
  const github = docs.classifyExternalDocTouches({
    connectorName: "GitHub", toolName: "push_files",
    args: { owner: "owner", repo: "repo", branch: "main", files: [{ path: "dir/file.md" }, { path: "../escape.md" }] },
    result: success(),
  });
  assert.deepEqual(github.map(touch => touch.externalId), ["owner/repo/blob/main/dir/file.md"]);
  const google = docs.classifyExternalDocTouches({
    connectorName: "Google Sheets", toolName: "copy_sheet_to_another_spreadsheet",
    args: { spreadsheetId: "source-sheet", destinationSpreadsheetId: "abcdefghij" }, result: success(),
  });
  assert.deepEqual(google.map(touch => [touch.provider, touch.externalId, touch.action]), [["google-sheets", "abcdefghij", "edited"]]);
});

test("google id arguments retain their original document kinds", () => {
  // Given: Google idArgs for document, spreadsheet, presentation, and file.
  // When: successful creation tools classify those arguments.
  // Then: each provider matches the original kind mapping.
  const cases = [
    ["create_document", { documentId: "abcdefghij" }, "google-docs"],
    ["create_spreadsheet", { spreadsheetId: "abcdefghij" }, "google-sheets"],
    ["create_presentation", { presentationId: "abcdefghij" }, "google-slides"],
    ["create_file", { fileId: "abcdefghij" }, "google-drive"],
  ];
  for (const [toolName, args, provider] of cases) {
    const touches = docs.classifyExternalDocTouches({ connectorName: "Google Docs", toolName, args, result: success() });
    assert.equal(touches.length, 1);
    assert.equal(touches[0].provider, provider);
    assert.equal(touches[0].externalId, "abcdefghij");
  }
});

test("failed, unknown, and arbitrary-link results do not classify", () => {
  // Given: error results, isError results, unknown connectors/tools, and arbitrary links.
  // When: classification runs.
  // Then: no touch is emitted.
  const inputs = [
    { connectorName: "Notion", toolName: "notion-create-pages", args: { page_id: "1234567890abcdef1234567890abcdef" }, result: { result: { case: "error", value: { error: "failed" } } } },
    { connectorName: "Notion", toolName: "notion-create-pages", args: { page_id: "1234567890abcdef1234567890abcdef" }, result: success({ isError: true }) },
    { connectorName: "Unknown", toolName: "notion-create-pages", args: { page_id: "1234567890abcdef1234567890abcdef" }, result: success() },
    { connectorName: "Notion", toolName: "notion-read-page", args: {}, result: success({ structuredContent: { url: "https://www.notion.so/1234567890abcdef1234567890abcdef" } }) },
    { connectorName: "Notion", toolName: "notion-create-pages", args: {}, result: success({ structuredContent: { url: "https://example.com/arbitrary" } }) },
    { connectorName: "Notion", toolName: "notion-create-pages", args: { page_id: "bad-id" }, result: success() },
  ];
  for (const input of inputs) assert.deepEqual(docs.classifyExternalDocTouches(input), []);
});
