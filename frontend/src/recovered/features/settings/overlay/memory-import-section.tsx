import { useState, type ReactNode } from "react";
import { planMemoryImport, type MemoryImportPlan } from "../../../../../../source/host/runner/sand-memory";

export interface MemoryImportCopy {
  readonly title: string;
  readonly entryLabel: string;
  readonly pastePlaceholder: string;
  readonly pasteHint: string;
  readonly submitLabel: string;
  readonly cancelLabel: string;
}

export const MEMORY_IMPORT_COPY_IDS: Record<keyof MemoryImportCopy, string> = {
  title: "UwUr5z",
  entryLabel: "o7Nnn1",
  pastePlaceholder: "VVno4E",
  pasteHint: "YYxWO8",
  submitLabel: "eyN5TV",
  cancelLabel: "dEgA5A",
};

export const DEFAULT_MEMORY_IMPORT_COPY: MemoryImportCopy = {
  title: "Import Memory to Grok Bot",
  entryLabel: "Add memories",
  pastePlaceholder: "Paste your memory details here",
  pasteHint: "Paste the results below to add them to Grok Bot's memory",
  submitLabel: "Add to Memory",
  cancelLabel: "Cancel",
};

export interface MemoryImportPreview {
  readonly plan: MemoryImportPlan;
  readonly text: string;
  readonly kind: "paste" | "file";
  readonly fileName?: string;
}

export function previewMemoryImport(text: string, existingContents: readonly string[], source: { readonly kind?: "paste" | "file"; readonly fileName?: string } = {}): MemoryImportPreview {
  const kind = source.kind === "file" ? "file" : "paste";
  const existing = existingContents.map((content) => ({ content, createdAt: 0 }));
  return {
    plan: planMemoryImport({ kind, text, ...(source.fileName === undefined ? {} : { fileName: source.fileName }) }, existing),
    text,
    kind,
    ...(source.fileName === undefined ? {} : { fileName: source.fileName }),
  };
}

export function MemoryImportSection(props: {
  readonly copy?: Partial<MemoryImportCopy>;
  readonly existingContents?: readonly string[];
  readonly disabled?: boolean;
  readonly onImport: (
    items: readonly { readonly content: string; readonly kind: "profile" | "log" }[],
    preview: MemoryImportPreview,
  ) => void | Promise<void>;
  readonly onClose?: () => void;
}): ReactNode {
  const copy: MemoryImportCopy = { ...DEFAULT_MEMORY_IMPORT_COPY, ...props.copy };
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [staged, setStaged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = staged ? previewMemoryImport(text, props.existingContents ?? [], fileName == null ? { kind: "paste" } : { kind: "file", fileName }) : null;
  const readFile = (file: File | null): void => {
    if (file == null) return;
    void file.text().then((contents) => {
      setText(contents);
      setFileName(file.name);
      setStaged(false);
      setError(null);
    }, () => {
      setError("The file could not be read.");
    });
  };
  const submit = (): void => {
    if (pending) return;
    if (!(staged && preview != null)) {
      setError(null);
      setStaged(true);
      return;
    }
    const stagedPreview = preview;
    setPending(true);
    setError(null);
    void Promise.resolve(props.onImport(stagedPreview.plan.items, stagedPreview)).then(() => {
      setText("");
      setStaged(false);
    }, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => setPending(false));
  };
  return (
    <section className="sand-memory-import" aria-label={copy.title}>
      <h2 className="sand-memory-import-title">{copy.title}</h2>
      <p className="sand-memory-import-hint">{copy.pasteHint}</p>
      <label className="sand-memory-import-field">
        <span>{copy.entryLabel}</span>
        <textarea
          aria-label={copy.pastePlaceholder}
          disabled={props.disabled === true || pending}
          onChange={(event) => { setText(event.target.value); setFileName(null); setStaged(false); setError(null); }}
          placeholder={copy.pastePlaceholder}
          rows={5}
          value={text}
        />
      </label>
      {preview == null ? null : (
        <ul className="sand-memory-import-preview">
          {preview.plan.items.map((item) => <li key={item.content}><span>{item.content}</span></li>)}
          {preview.plan.duplicates.map((duplicate) => (
            <li className="sand-memory-import-duplicate" key={`dup:${duplicate}`}><span>{duplicate}</span></li>
          ))}
        </ul>
      )}
      {error == null ? null : <p className="sand-memory-import-error" role="alert">{error}</p>}
      <label className="sand-memory-import-file">
        <span>Choose file</span>
        <input
          accept=".md,.markdown,.txt,text/plain,text/markdown"
          aria-label="Choose file"
          disabled={props.disabled === true || pending}
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = "";
            readFile(file);
          }}
          type="file"
        />
      </label>
      <div className="sand-memory-import-actions">
        <button
          disabled={props.disabled === true || pending || text.trim() === ""}
          onClick={submit}
          type="button"
        >
          {copy.submitLabel}
        </button>
        {props.onClose == null ? null : <button onClick={props.onClose} type="button">{copy.cancelLabel}</button>}
      </div>
    </section>
  );
}
