# Grok Node local extensions

## 1. Reference and identity
Preserve existing desktop surfaces. The user-supplied Bot import screenshot (2026-09-22) defines a full modal, top back/share/close controls, avatar and name, primary import button, description, divider, and five detail tabs. The extension runs inside the pinned renderer as real DOM.

## 2. Color
Reuse --cursor-bg-elevated, --cursor-bg-editor, --cursor-text-primary, --cursor-text-secondary, --cursor-border-secondary and --cursor-stroke-focused. Dark reference fallbacks: panel #181818, detail/selected #111111, primary #fafafa, secondary #aaa, border #3b3b3b. Light fallbacks follow system preference until app tokens are ready. Avatar accent comes from validated public template data.

## 3. Typography
Use the app font (--cursor-font-family-sans; system sans fallback). Preview scale: title 28px/1.2, body and tabs 18px/1.5, notes 14px/1.5. Instructions preserve newlines and wrap; CJK labels remain whole.

## 4. Spacing and layout
Base unit 4px. Modal inset 8px; radius 20px; maximum width 1240px; height viewport minus 16px. Header 64px, content gutter 56px, avatar 100px, section gap 32px. Details columns 280px/minmax(0,1fr), gap 32px. At 760px gutters are 24px and tabs wrap horizontally; at 440px gutters are 16px. Content scrolls inside the modal without horizontal overflow.

## 5. Primitives and states
Native dialog provides focus trapping, Escape and restoration. IconButton (back/share/close), PrimaryButton (ready/busy/error), DetailTab (selected/focused), ContentPanel (instructions/unavailable), and BotAvatar are reusable extension primitives. SVG icons and DOM text only. Template records are text, never executable HTML. Loading and errors share the shell with a retry button.

## 6. Interaction and motion
Opening a link displays a preview and creates nothing. Back, close and Escape cancel. Import disables while creating and retains its preview token for retry. Success focuses the created local Bot. Share copies the public link with feedback. No decorative animation.

## 7. Accessibility
Named dialog and controls. Tabs support arrows/Home/End and roving focus, linked to a labelled tabpanel. Visible focus outlines. Status uses aria-live; errors use role=alert. Buttons retain disabled semantics. Modal scrolls at narrow widths and increased zoom.

## 8. Data fidelity and QA
The HTML share page is only a summary. The authenticated GetGrokBotTemplateImportDetails endpoint supplies a download URL for the complete recipe. Until that recipe is fetched, show details as not loaded and disable import; absence from HTML does not mean an empty category. Keep instructions separate from the share description. Test dialog, cancellation, authorization failure, tabs and desktop/narrow viewports. Keep renderer inventory and checksum verification intact; append the extension only to the audited registry chunk.
