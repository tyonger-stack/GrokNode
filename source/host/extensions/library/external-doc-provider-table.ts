import type { ExternalDocumentId } from "./external-doc-urls.js";
import { airtableDocumentId, canvaDocumentId, miroDocumentId } from "./external-doc-cloud-urls.js";
import {
  externalUrlParsers, figmaDocumentId, githubPushFiles,
  googleDestinationSpreadsheet, googleDocumentArgumentId, googleDocumentId, googlePresentationArgumentId, gmailDraftId, notionDocumentId,
  stringProperty,
} from "./external-doc-urls.js";

// allow: SIZE_OK — pure data table ported from original main-app.cjs fJt/pJt.
export const externalConnectorOrder = [
  "notion", "google", "gmail", "google-calendar", "microsoft", "figma", "linear", "atlassian",
  "github", "slack", "box", "dropbox", "airtable", "coda", "miro", "canva", "hex",
] as const;
export type ExternalConnectorId = typeof externalConnectorOrder[number];
export type ExternalToolAction = "created" | "edited";
export type ExternalToolKind = "document" | "draft" | "event" | "message" | "pull_request";
export type ExternalIdParser = (value: unknown) => ExternalDocumentId | null;
export type ExternalArgDocsParser = (value: unknown) => readonly ExternalDocumentId[];
export type ExternalToolRule = { readonly action: ExternalToolAction; readonly kind: ExternalToolKind };
export type ExternalProviderSpec = {
  readonly names: readonly string[];
  readonly parseUrl?: (url: URL) => ExternalDocumentId | null;
  readonly idArgs?: Readonly<Record<string, ExternalIdParser>>;
  readonly documentId?: ExternalIdParser;
  readonly tools: Readonly<Record<string, ExternalToolRule>>;
  readonly argDocs?: Readonly<Record<string, ExternalArgDocsParser>>;
  readonly uploadServices?: readonly string[];
  readonly inferEditsFromToolName?: boolean;
};

function rules(action: ExternalToolAction, names: readonly string[], kind: ExternalToolKind = "document"): Record<string, ExternalToolRule> {
  return Object.fromEntries(names.map(name => [name, { action, kind }]));
}

const GOOGLE_EDIT_TOOLS = [
  "update_file", "update_file_content", "move_or_rename", "insert_text", "replace_text", "delete_content",
  "apply_text_style", "apply_paragraph_style", "set_paragraph_format", "create_list", "insert_image",
  "insert_page_break", "insert_table", "merge_table_cells", "set_header_footer", "set_table_cell_shading",
  "set_table_column_width", "write_range", "append_rows", "append_values", "batch_clear_values", "clear_range",
  "format_cells", "add_sheet_tab", "rename_sheet_tab", "delete_sheet_tab", "insert_rows_or_columns",
  "delete_rows_or_columns", "merge_cells", "sort_range", "set_basic_filter", "set_borders", "set_column_width",
  "set_data_validation", "freeze_rows_or_columns", "add_banding", "add_chart", "update_chart", "delete_chart",
  "add_conditional_formatting", "add_named_range", "delete_named_range", "protect_range", "unprotect_range",
  "find_replace_sheet", "add_slide", "compose_slide", "move_slide", "duplicate_object", "delete_object",
  "insert_grid", "insert_line", "insert_shape", "insert_text_box", "connect_shapes", "set_shape_text",
  "set_slide_background", "set_table_cell_fill", "set_text_style", "update_element_position", "copy_sheet_to_another_spreadsheet",
];

const specTable: Record<ExternalConnectorId, ExternalProviderSpec> = {
  notion: {
    names: ["notion"], parseUrl: externalUrlParsers.notion,
    idArgs: { page_id: notionDocumentId, database_id: notionDocumentId, data_source_id: notionDocumentId, page_or_database_ids: notionDocumentId },
    documentId: notionDocumentId,
    tools: { ...rules("created", ["notion-create-pages", "notion-duplicate-page", "notion-create-database", "API-post-page", "API-create-a-database"]),
      ...rules("edited", ["notion-update-page", "notion-move-pages", "notion-update-data-source", "API-patch-page", "API-patch-block-children"]) },
  },
  google: {
    names: ["google drive", "google docs", "google sheets", "google slides", "google workspace", "googledrive", "gdrive"],
    parseUrl: externalUrlParsers.google,
    idArgs: { documentId: googleDocumentArgumentId, spreadsheetId: googleDestinationSpreadsheet, presentationId: googlePresentationArgumentId, fileId: googleDocumentId },
    documentId: googleDocumentId,
    tools: { ...rules("created", ["create_document", "create_spreadsheet", "create_presentation", "create_file", "copy_file"]), ...rules("edited", GOOGLE_EDIT_TOOLS) },
    argDocs: { copy_sheet_to_another_spreadsheet: value => {
      const destination = googleDestinationSpreadsheet(stringProperty(value, "destinationSpreadsheetId"));
      return destination === null ? [] : [destination];
    } },
    uploadServices: ["google-drive"],
  },
  gmail: {
    names: ["gmail", "google mail", "google workspace"], idArgs: { draftId: gmailDraftId },
    tools: { ...rules("created", ["create_draft"], "draft"), ...rules("edited", ["update_draft"], "draft") },
  },
  "google-calendar": {
    names: ["google calendar", "gcal", "google workspace"], parseUrl: externalUrlParsers["google-calendar"],
    tools: { ...rules("created", ["create_event"], "event"), ...rules("edited", ["update_event"], "event") },
  },
  microsoft: {
    names: ["onedrive", "sharepoint", "microsoft 365"], parseUrl: externalUrlParsers.microsoft,
    tools: rules("edited", ["create_or_update_file", "move_or_rename_drive_item"]), uploadServices: ["onedrive", "sharepoint"],
  },
  figma: {
    names: ["figma"], parseUrl: externalUrlParsers.figma, idArgs: { fileKey: figmaDocumentId, file_key: figmaDocumentId },
    tools: { ...rules("created", ["create_new_file", "generate_diagram"]), ...rules("edited", ["generate_figma_design", "upload_assets"]) },
  },
  linear: {
    names: ["linear"], parseUrl: externalUrlParsers.linear,
    tools: { ...rules("created", ["create_issue", "create_document"]), ...rules("edited", ["update_issue", "save_issue", "update_document", "save_document"]) },
  },
  atlassian: {
    names: ["atlassian", "confluence", "jira"], parseUrl: externalUrlParsers.atlassian,
    tools: { ...rules("created", ["createConfluencePage", "createJiraIssue"]), ...rules("edited", ["updateConfluencePage", "editJiraIssue"]) },
  },
  github: {
    names: ["github"], parseUrl: externalUrlParsers.github,
    tools: { ...rules("created", ["create_issue", "create_gist"]), ...rules("edited", ["update_issue", "create_or_update_file", "push_files", "update_gist"]),
      ...rules("created", ["create_pull_request"], "pull_request"), ...rules("edited", ["update_pull_request"], "pull_request") },
    argDocs: { push_files: githubPushFiles },
  },
  slack: {
    names: ["slack"], parseUrl: externalUrlParsers.slack,
    tools: { ...rules("created", ["slack_create_canvas"]), ...rules("created", ["slack_send_message"], "message"), ...rules("edited", ["slack_update_canvas"]) },
  },
  box: { names: ["box"], parseUrl: externalUrlParsers.box, tools: {}, inferEditsFromToolName: true },
  dropbox: { names: ["dropbox"], parseUrl: externalUrlParsers.dropbox, tools: {}, inferEditsFromToolName: true },
  airtable: {
    names: ["airtable"], parseUrl: externalUrlParsers.airtable, idArgs: { baseId: airtableDocumentId, base_id: airtableDocumentId },
    tools: rules("created", ["create_base"]), inferEditsFromToolName: true,
  },
  coda: { names: ["coda"], parseUrl: externalUrlParsers.coda, tools: {}, inferEditsFromToolName: true },
  miro: { names: ["miro"], parseUrl: externalUrlParsers.miro, idArgs: { board_id: miroDocumentId, boardId: miroDocumentId }, tools: {}, inferEditsFromToolName: true },
  canva: { names: ["canva"], parseUrl: externalUrlParsers.canva, idArgs: { design_id: canvaDocumentId, designId: canvaDocumentId }, tools: {}, inferEditsFromToolName: true },
  hex: {
    names: ["hex"], parseUrl: externalUrlParsers.hex,
    tools: { ...rules("created", ["create_project"]), ...rules("edited", ["create_cell", "update_cell", "delete_cell"]) },
  },
};

export const externalConnectorSpecs: readonly {
  readonly id: ExternalConnectorId;
  readonly spec: ExternalProviderSpec;
}[] = externalConnectorOrder.map(id => ({ id, spec: specTable[id] }));
