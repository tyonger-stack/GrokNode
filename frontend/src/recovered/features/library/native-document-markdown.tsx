import { useEffect, useMemo, useRef } from "react";
import { Node } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser, MarkdownSerializer } from "prosemirror-markdown";
import type { DocumentAsset } from "../../../../../source/shared/library-contracts";

import { documentAssetName, extractDocumentAssetNames, isDocumentAssetName } from "../../../../../source/shared/library/document-assets";
export { documentAssetName, extractDocumentAssetNames, isDocumentAssetName };
export { extractDocumentAssetNames as extractLocalAssetNames };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
// Gateway asset bytes arrive over IPC as { $b64: base64 } (see R1 host test
// "gateway asset bytes decode without Buffer and render inline"); the Node
// Uint8Array shape only exists in-process. Normalize at this boundary with
// browser-only codecs so no Buffer global is ever needed.
function decodeAssetBytes(bytes: unknown): Uint8Array | null {
  if (bytes instanceof Uint8Array) return bytes;
  if (typeof bytes === "object" && bytes !== null) {
    const b64 = (bytes as { $b64?: unknown }).$b64;
    if (typeof b64 === "string") {
      const binary = atob(b64);
      const out = new Uint8Array(binary.length);
      for (let n = 0; n < binary.length; n++) out[n] = binary.charCodeAt(n);
      return out;
    }
  }
  return null;
}
function readyAssetDataUrl(bytes: unknown, contentType: string): string | null {
  if (typeof bytes === "object" && bytes !== null && !(bytes instanceof Uint8Array)) {
    const b64 = (bytes as { $b64?: unknown }).$b64;
    if (typeof b64 === "string") return "data:" + contentType + ";base64," + b64;
    return null;
  }
  const raw = decodeAssetBytes(bytes);
  if (!raw) return null;
  return "data:" + contentType + ";base64," + bytesToBase64(raw);
}
// prosemirror-markdown speaks snake_case node/mark names; the Tiptap schema
// speaks camelCase. Remap both directions like the original markdown bridge.
const ALIASES: Readonly<Record<string, string>> = {
  code_block: "codeBlock",
  horizontal_rule: "horizontalRule",
  ordered_list: "orderedList",
  bullet_list: "bulletList",
  list_item: "listItem",
  hard_break: "hardBreak",
  em: "italic",
  strong: "bold",
};
const serializer = new MarkdownSerializer(
  Object.fromEntries(Object.entries(defaultMarkdownSerializer.nodes).map(([key, value]) => [ALIASES[key] ?? key, value])),
  Object.fromEntries(Object.entries(defaultMarkdownSerializer.marks).map(([key, value]) => [ALIASES[key] ?? key, value])),
);

export interface NativeDocumentMarkdownProps {
  readonly source: string;
  readonly editable: boolean;
  readonly assets: readonly DocumentAsset[] | null;
  readonly onChange: (source: string) => void;
  readonly onBlur: () => void;
  readonly onRetryAsset: (name: string) => void;
  readonly onEditAttempt?: (kind: "focus" | "key" | "pointer") => void;
  readonly editorHandle?: { current: NativeDocumentHandle | null };
}

export interface NativeDocumentHandle {
  getMarkdown(): string;
  setText(text: string): void;
  focus(): void;
}

export function NativeDocumentMarkdown(props: NativeDocumentMarkdownProps) {
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const urls = useMemo(() => {
    const entries = new Map<string, string>();
    for (const asset of props.assets ?? []) {
      if (asset.status === "ready") {
        const url = readyAssetDataUrl(asset.bytes, asset.contentType);
        if (url) entries.set(asset.name, url);
      }
    }
    return entries;
  }, [props.assets]);
  
  const image = useMemo(() => Node.create({
    name: "image",
    inline: true,
    group: "inline",
    atom: true,
    addAttributes() {
      return { src: { default: "" }, alt: { default: "" }, title: { default: null } };
    },
    parseHTML() {
      return [{ tag: "img" }];
    },
    renderHTML({ node }) {
      const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
      return ["img", { src, alt, "data-document-image": "", "data-rte-image-src": src }];
    },
  }), []);
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), image],
    editable: props.editable,
    onUpdate: ({ editor: current }) => onChangeRef.current(serializer.serialize(current.state.doc)),
    editorProps: {
      attributes: { "aria-label": "Document body", role: "textbox", "aria-multiline": "true" },
    },
  }, []);
  useEffect(() => {
    if (!editor) return;
    const tokens = Object.fromEntries(Object.entries(defaultMarkdownParser.tokens).map(([key, spec]) => [key, {
      ...spec,
      ...(spec.node ? { node: ALIASES[spec.node] ?? spec.node } : {}),
      ...(spec.block ? { block: ALIASES[spec.block] ?? spec.block } : {}),
      ...(spec.mark ? { mark: ALIASES[spec.mark] ?? spec.mark } : {}),
    }]));
    const parser = new MarkdownParser(editor.schema, defaultMarkdownParser.tokenizer, tokens);
    editor.commands.setContent(parser.parse(props.source).toJSON(), { emitUpdate: false });
  }, [editor]);
  useEffect(() => {
    editor?.setEditable(props.editable, false);
  }, [editor, props.editable]);
  useEffect(() => {
    if (!editor || !props.editorHandle) return;
    props.editorHandle.current = {
      getMarkdown: () => serializer.serialize(editor.state.doc),
      setText: (text: string) => {
        const para = editor.state.schema.nodes.paragraph.create(
          null,
          editor.state.schema.text(text),
        );
        editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, para));
      },
      focus: () => editor.commands.focus(),
    };
    return () => {
      if (props.editorHandle) props.editorHandle.current = null;
    };
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    const nodes: { readonly src: string; readonly alt: string }[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") {
        nodes.push({
          src: typeof node.attrs.src === "string" ? node.attrs.src : "",
          alt: typeof node.attrs.alt === "string" ? node.attrs.alt : "",
        });
      }
    });
    const imgs = editor.view.dom.querySelectorAll("img");
    imgs.forEach((img, index) => {
      const info = nodes[index];
      if (!info) return;
      const name = documentAssetName(info.src);
      const asset = name ? (props.assets ?? []).find((item) => item.name === name) : undefined;
      img.setAttribute("data-document-image", "");
      img.setAttribute("data-rte-image-src", info.src);
      img.setAttribute("data-asset-status", asset?.status ?? "loading");
      if (asset?.status === "ready") {
        const url = name ? urls.get(name) : undefined;
        if (url) img.setAttribute("src", url); else img.removeAttribute("src");
        img.setAttribute("alt", info.alt);
        img.removeAttribute("aria-label");
        img.removeAttribute("aria-busy");
        img.removeAttribute("data-rte-image-blocked");
        (img as HTMLImageElement).onclick = null;
        return;
      }
      if (props.assets === null || asset === undefined) {
        img.removeAttribute("src");
        img.setAttribute("alt", "");
        img.setAttribute("aria-label", info.alt);
        img.removeAttribute("data-rte-image-blocked");
        img.setAttribute("aria-busy", "true");
        (img as HTMLImageElement).onclick = null;
        return;
      }
      img.removeAttribute("src");
      img.setAttribute("alt", info.alt);
      img.removeAttribute("aria-label");
      img.removeAttribute("aria-busy");
      img.setAttribute("data-rte-image-blocked", "");
      (img as HTMLImageElement).onclick = name && (asset.status === "failed" || asset.status === "missing")
        ? () => props.onRetryAsset(name)
        : null;
    });
  });
  return (
    <div
      className="library-document-body"
      data-document-body
      dir="auto"
      spellCheck={false}
      onFocus={() => props.onEditAttempt?.("focus")}
      onKeyDown={() => props.onEditAttempt?.("key")}
      onPointerDown={() => props.onEditAttempt?.("pointer")}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Element && event.currentTarget.contains(next)) return;
        props.onBlur();
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
