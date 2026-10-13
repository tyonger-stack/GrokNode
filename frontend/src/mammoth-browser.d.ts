// Ambient declaration for mammoth's prebuilt browser bundle.
//
// This file is deliberately a **script**: it has no top-level import or export.
// `declare module` inside a module file is an augmentation of an already-existing
// module and is silently ignored when the target does not exist — which is why
// this cannot live next to the other globals in ./env.d.ts.
//
// mammoth ships types for its main entry (mammoth → lib/index.js) but not for
// mammoth/mammoth.browser.js, and that browser entry is the only one that
// accepts `{ arrayBuffer }`; the Node entry takes `{ path }` or `{ fs }`. See
// recovered/features/conversation/workspace/docx-convert.ts for which one this
// project uses and why the choice is explicit rather than left to bundler field
// resolution.
//
// Only the surface docx-convert.ts touches is declared, so an upstream signature
// change fails typecheck instead of arriving as an `any` that silences it.

declare module "mammoth/mammoth.browser.js" {
  export interface MammothMessage {
    type: string;
    message: string;
  }

  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>;

  // The bundle is UMD. Depending on how the bundler interops a CommonJS module,
  // the namespace arrives either as the module's own exports or wrapped as
  // `default`; docx-convert.ts handles both, so both are typed.
  const browser: { convertToHtml: typeof convertToHtml };
  export default browser;
}