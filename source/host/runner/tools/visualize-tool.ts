import { createHash } from "node:crypto";
import { z } from "zod";
import type { Context } from "../../../packages/context/core.js";
import type { VisualizationMessage } from "../../../shared/visualization.js";
import { invariant } from "../../../shared/invariant.js";
import { isBoxRootPath, resolveBoxWorkspacePath, isSourceMissingError as isBoxFileMissingError } from "../../box/box-transfer.js";
import { defineCommunicateTool } from "./communicate-tool.js";
import { SandToolInputError } from "./tool-input-error.js";

// Grok Bot 0.72.1 host-main.cjs sha256 68b8ce61bdf621b17f5f71014cf8d66897083348c320666305840581eaae440d.
// Producer 779584-779796; limits 722025-722036 and 761974-761986; guidance 762330-762340.
export const VISUALIZATION_TITLE_MAX_CHARS = 120;
export const VISUALIZATION_SUMMARY_MAX_CHARS = 500;
export const VISUALIZATION_FRAGMENT_MAX_BYTES = 1024 * 1024;
const VISUALIZATION_FRAME_PADDING_PX = 20;
const VISUALIZATION_CONTENT_MAX_WIDTH_PX = Math.floor(960 - 82 - 2 * 0.5 - 2 * VISUALIZATION_FRAME_PADDING_PX);
const VISUALIZATION_CONTENT_MAX_HEIGHT_PX = 720 - 2 * VISUALIZATION_FRAME_PADDING_PX;
const VISUALIZATION_CONTENT_MIN_HEIGHT_PX = 160;
const VISUALIZATION_FRAGMENT_MAX_SIZE = `${VISUALIZATION_FRAGMENT_MAX_BYTES / (1024 * 1024)} MB`;
const VISUALIZATION_RUNTIME_GLOBALS = { three: "THREE" };
const GROK_BOT_TOOL_NAMES = { Visualize: "Visualize", SendToUser: "SendMessage" };
const VISUAL_CLEARLY_HELPS = "a visual makes the answer clearly easier to understand than text, a table or a Mermaid diagram would";
const VISUAL_ASKED_FOR = "the person asks for a chart or an inline visual";
const VISUALIZE_WHEN = `Use ${GROK_BOT_TOOL_NAMES.Visualize} when ${VISUAL_CLEARLY_HELPS}, as with numbers to compare or follow over time, places on a map, or a 3D shape. Also use it when ${VISUAL_ASKED_FOR}. Draw a flow, structure or relationship diagram as a fenced \`mermaid\` block by default.`;
const VISUALIZATION_FRAGMENT_RULES = [
  `A fragment only, with no doctype, html, head or body tags, under ${VISUALIZATION_FRAGMENT_MAX_SIZE}.`,
  "One root element with an id. Keep every style and script inside the fragment and scope CSS to that id.",
  "No network. No external URLs, no script src and no fetch. Inline data: images are fine.",
  "No forms, links or navigation."
];

type VisualizationSource = { kind: "html"; html: string } | { kind: "path"; path: string };
type VisualizationTarget = { kind: "new"; channel: string | undefined } | { kind: "edit"; visualId: string };
export interface VisualizationPages {
  save(html: string): Promise<{ sha256: string }>;
}
export interface VisualizationRevisions {
  revise(input: { visualId: string; documentSha256: string; title: string; summary: string; heightPx: number; timestampMs: number }): Promise<
    { kind: "revised"; entryId: string } | { kind: "unchanged" } | { kind: "not-found" }
  >;
}
export interface VisualizeToolDependencies {
  pages(): VisualizationPages | undefined;
  readBoxFile(ctx: Context, boxPath: string, maxBytes: number): Promise<Uint8Array>;
  sendBlockReason(message: VisualizationMessage): string | undefined;
  emit(message: VisualizationMessage, timestampMs: number): string | undefined;
  revisions?(): VisualizationRevisions | undefined;
}
export class BoxFileTooLargeError extends Error {}
function parseVisualId(raw: string): string | null {
  return /^viz-[0-9a-f]{1,64}$/.test(raw) ? raw : null;
}
function describeChannelAddressProblem(_address: string): string {
  return "Inline visuals cannot be delivered to a channel by this host, so nothing was shown. Leave channel out to show the visual in this chat.";
}

export class SandVisualizationUnavailableError extends SandToolInputError {
  static readonly telemetryName = "SandVisualizationUnavailableError";
}
export const visualizeArguments = z.object({
  title: z.string().trim().min(1).max(VISUALIZATION_TITLE_MAX_CHARS).regex(/^[^\r\n]*$/, "title must be one line").describe(
    `One line naming the visual, at most ${VISUALIZATION_TITLE_MAX_CHARS} characters. Slack and older apps show it in place of the visual.`
  ),
  summary: z.string().trim().min(1).max(VISUALIZATION_SUMMARY_MAX_CHARS).describe(
    `One or two sentences on what the visual shows, at most ${VISUALIZATION_SUMMARY_MAX_CHARS} characters. Slack and older apps show it under the title.`
  ),
  height: z.number().int().min(VISUALIZATION_CONTENT_MIN_HEIGHT_PX).max(VISUALIZATION_CONTENT_MAX_HEIGHT_PX).describe("The content height in whole px."),
  html: z.string().optional().describe("The HTML fragment that draws the visual. Pass html or path, not both."),
  path: z.string().trim().optional().describe(
    "In place of html, the absolute path of a file on your computer that holds the fragment."
  ),
  channel: z.string().trim().optional().describe(
    `Optional. A connected channel address shaped platform:chat, the same address ${GROK_BOT_TOOL_NAMES.SendToUser} takes. The channel receives the title and summary.`
  ),
  visualId: z.string().trim().optional().describe(
    `Optional. The visualId of a visual you showed in this chat. Its card then shows this fragment in place of a new card. Pass it to fix or update that visual, then send a short ${GROK_BOT_TOOL_NAMES.SendToUser} line saying what changed.`
  )
});
function given(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}
export function visualizationSource(html: string | undefined, path33: string | undefined): VisualizationSource | undefined {
  if (given(html)) return given(path33) ? undefined : { kind: "html", html };
  return given(path33) ? { kind: "path", path: path33 } : undefined;
}
export const visualizeParameters = visualizeArguments.transform(
  ({ html, path: path33, channel, visualId, ...visual }, ctx) => {
    if (!given(html) && !given(path33) && (html !== undefined || path33 !== undefined)) {
      if (html !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["html"],
          message: "It is empty. Send the HTML fragment in html, or leave html out and send path."
        });
      }
      if (path33 !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["path"],
          message: "It is empty. Send the fragment file's absolute path in path, or leave path out and send html."
        });
      }
      return z.NEVER;
    }
    const source = visualizationSource(html, path33);
    if (source === undefined) {
      ctx.addIssue({ code: "custom", message: "Pass exactly one of html or path." });
      return z.NEVER;
    }
    const newChannel = given(channel) ? channel : undefined;
    if (!given(visualId)) {
      const target2: VisualizationTarget = { kind: "new", channel: newChannel };
      return { ...visual, source, target: target2 };
    }
    const edited = parseVisualId(visualId);
    if (edited === null) {
      ctx.addIssue({
        code: "custom",
        path: ["visualId"],
        message: `${visualId} is not a visualId. Pass the visualId a ${GROK_BOT_TOOL_NAMES.Visualize} result named.`
      });
      return z.NEVER;
    }
    if (newChannel !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "A changed visual stays where it is and posts nothing to a channel. Pass channel or visualId, not both."
      });
      return z.NEVER;
    }
    const target: VisualizationTarget = { kind: "edit", visualId: edited };
    return { ...visual, source, target };
  }
);
export const VISUALIZE_DESCRIPTION = [
  "Show the user a visual inline in the chat. You write an HTML fragment and the app runs it in a sandboxed frame.",
  VISUALIZE_WHEN,
  "Size:",
  `- The visual is at most ${VISUALIZATION_CONTENT_MAX_WIDTH_PX} px wide inside the host's ${VISUALIZATION_FRAME_PADDING_PX} px padding, and narrower in a small window. Declare height, from ${VISUALIZATION_CONTENT_MIN_HEIGHT_PX} to ${VISUALIZATION_CONTENT_MAX_HEIGHT_PX} px, and the card keeps that box.`,
  "- The frame never scrolls. Anything taller is cut off until the user clicks Expand.",
  "Fragment rules:",
  ...VISUALIZATION_FRAGMENT_RULES.map((rule) => `- ${rule}`),
  `Also send a short ${GROK_BOT_TOOL_NAMES.SendToUser} text reply as usual. After you change a visual with visualId, the reply says what changed.`
].join("\n");
const UNAVAILABLE2 = "Inline visuals are unavailable for this account, so nothing was shown.";
const EDIT_UNAVAILABLE = "This chat can't change a visual in place, so nothing changed. Show it as a new visual, without visualId.";
export function visualIdOf(toolCallId: string) {
  const visualId = parseVisualId(
    `viz-${createHash("sha256").update(toolCallId).digest("hex").slice(0, 10)}`
  );
  invariant(visualId !== null, "a hex digest prefix makes a visualId");
  return visualId;
}
const THREE_CLASS_CALLED_WITHOUT_NEW = new RegExp(
  `\\b${VISUALIZATION_RUNTIME_GLOBALS.three}\\.(\\w+)\\.call\\(\\s*this\\b`
);
export async function readFragment(ctx: Context, source: VisualizationSource, readBoxFile: VisualizeToolDependencies["readBoxFile"]) {
  if (source.kind === "html") return source.html;
  const boxPath = resolveBoxWorkspacePath(source.path);
  if (!isBoxRootPath(boxPath)) {
    throw new SandToolInputError(
      `${boxPath} is outside your computer's /workspace, /home and /root, so nothing was shown. Save the fragment under one of them and pass that path.`
    );
  }
  try {
    const bytes = await readBoxFile(ctx, boxPath, VISUALIZATION_FRAGMENT_MAX_BYTES);
    if (bytes.byteLength > VISUALIZATION_FRAGMENT_MAX_BYTES) throw new BoxFileTooLargeError();
    return new TextDecoder().decode(bytes);
  } catch (error64) {
    if (error64 instanceof BoxFileTooLargeError) {
      throw new SandToolInputError(
        `${boxPath} is over the ${VISUALIZATION_FRAGMENT_MAX_SIZE} limit, so nothing was shown. Draw it with less inline data and call again.`
      );
    }
    if (isBoxFileMissingError(error64)) {
      throw new SandToolInputError(
        `${boxPath} is not a file on your computer, so nothing was shown. Pass the absolute path of the file that holds the fragment.`
      );
    }
    throw error64;
  }
}
export function fragmentProblem({
  html,
  origin
}: { html: string; origin: string }): string | undefined {
  if (html.trim().length === 0) return `${origin} is empty, so nothing was shown.`;
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes > VISUALIZATION_FRAGMENT_MAX_BYTES) {
    return `${origin} is ${bytes} bytes, over the ${VISUALIZATION_FRAGMENT_MAX_BYTES}-byte limit, so nothing was shown. Draw it with less inline data and call again.`;
  }
  const calledClass = THREE_CLASS_CALLED_WITHOUT_NEW.exec(html)?.[1];
  if (calledClass === undefined) return undefined;
  const three = VISUALIZATION_RUNTIME_GLOBALS.three;
  return `${three}.${calledClass}.call(this) throws because three.js classes are ES classes, so nothing was shown. Subclass with class X extends ${three}.${calledClass} and call again.`;
}
export function createVisualizeTool(deps: VisualizeToolDependencies) {
  return defineCommunicateTool(deps, {
    id: "VISUALIZE",
    name: GROK_BOT_TOOL_NAMES.Visualize,
    description: VISUALIZE_DESCRIPTION,
    parameters: visualizeParameters,
    describeActivity: () => ({ detail: "inline visual" }),
    execute: async (ctx, args: z.infer<typeof visualizeParameters>, d) => {
      const { target } = args;
      const revisions = target.kind === "edit" ? d.revisions?.() : undefined;
      if (target.kind === "edit" && revisions === undefined) {
        throw new SandVisualizationUnavailableError(EDIT_UNAVAILABLE);
      }
      const html = await readFragment(ctx, args.source, d.readBoxFile);
      const problem = fragmentProblem({
        html,
        origin: args.source.kind === "html" ? "html" : args.source.path
      });
      if (problem !== undefined) throw new SandToolInputError(problem);
      const channel = target.kind === "new" ? target.channel : undefined;
      const channelProblem = channel === undefined ? undefined : describeChannelAddressProblem(channel);
      if (channelProblem !== undefined) throw new SandToolInputError(channelProblem);
      const pages = d.pages();
      if (pages === undefined) throw new SandVisualizationUnavailableError(UNAVAILABLE2);
      const { sha256 } = await pages.save(html);
      const visualId = target.kind === "edit" ? target.visualId : visualIdOf(d.toolCallId);
      const message: VisualizationMessage = {
        type: "visualization",
        title: args.title,
        summary: args.summary,
        documentSha256: sha256,
        heightPx: args.height,
        visualId,
        ...channel === undefined ? {} : { channel }
      };
      const blocked = d.sendBlockReason(message);
      if (blocked !== undefined) throw new SandToolInputError(blocked);
      if (revisions === undefined) {
        const entryId = d.emit(message, Date.now());
        const shown = `Shown inline as visual ${visualId}${entryId === undefined ? "" : ` in entry ${entryId}`}.`;
        return channel === undefined ? shown : `${shown} ${channel} receives the title and summary.`;
      }
      const outcome = await revisions.revise({
        visualId,
        documentSha256: sha256,
        title: args.title,
        summary: args.summary,
        heightPx: args.height,
        timestampMs: Date.now()
      });
      switch (outcome.kind) {
        case "revised":
          return `Changed visual ${visualId} in place in entry ${outcome.entryId}. Tell the user in a short ${GROK_BOT_TOOL_NAMES.SendToUser} line what changed.`;
        case "unchanged":
          return `Visual ${visualId} already shows this fragment, title, summary and height, so nothing changed.`;
        case "not-found":
          throw new SandToolInputError(
            `No visual ${visualId} in this chat, so nothing changed. Pass the visualId of a visual you showed in this chat while it is among its recent messages, or show a new visual without visualId.`
          );
      }
      outcome;
      throw new Error("unreachable");
    }
  });
}

