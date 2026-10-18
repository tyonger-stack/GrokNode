/**
 * Port of official file-markdown document body.
 *
 * Evidence (0.18 pinned chunk — same recipe family as 0.71.2 FileMarkdown):
 *   index-UbX-y3il.js `Iwn` / `Bwn` / `Ewn`/`Cwn`
 *   Iwn root: sand-file-markdown sand-file-markdown--document +
 *     sand-78zum5 sand-dt5ytf sand-euugli sand-j0a0fe sand-1oot3zn
 *     sand-1wd3ewq sand-1jvydc1 sand-1dbl2gt
 *   Bwn page: sand-file-markdown-page sand-9f619 sand-c5f494 sand-8x9d4c
 *     sand-ack27t sand-13zrc24 sand-161sli9 sand-1tudf5h sand-1m2p0i2 sand-1hx0egp
 *   link: sand-l1v4ol sand-krqix3 sand-1sur9pj  (= 0.71 sand-10kc733 + same deco)
 *
 * 0.71.2 FileMarkdown (chunk-file-markdown-B4pMmTfY.js) keeps the same leaf
 * recipes; link accent token is sand-10kc733 (lifted below for parity).
 */
import { useMemo, type ReactNode } from "react";
import MarkdownIt from "markdown-it";

// @evidence 0.18 Iwn root class list (document mode)
const MARKDOWN_ROOT_CLASSES =
  "sand-file-markdown sand-file-markdown--document sand-78zum5 sand-dt5ytf sand-euugli sand-j0a0fe sand-1oot3zn sand-1wd3ewq sand-1jvydc1 sand-1dbl2gt";

// @evidence 0.18 Bwn page shell — classes resolve in pinned index-lCyB53CO.css
const MARKDOWN_PAGE_CLASSES =
  "sand-file-markdown-page sand-9f619 sand-c5f494 sand-8x9d4c sand-ack27t sand-13zrc24 sand-161sli9 sand-1tudf5h sand-1m2p0i2 sand-1hx0egp";

const LINK_CLASSES = "sand-l1v4ol sand-10kc733 sand-krqix3 sand-1sur9pj";
const LEAF = "sand-dj266r sand-at24cr";
const H1 = `${LEAF} sand-1wd3ewq sand-xzm5a7 sand-wn7fz2 sand-1p0p6hz sand-1shq6nw sand-1hi0czg`;
const H2 = `${LEAF} sand-1wd3ewq sand-xzm5a7 sand-wn7fz2 sand-1x419k1 sand-ylt984 sand-1deyeav`;
const H3 = `${LEAF} sand-1wd3ewq sand-xzm5a7 sand-wn7fz2 sand-19snzy6 sand-nc0k7y`;
const H4 = `${LEAF} sand-1wd3ewq sand-xzm5a7 sand-wn7fz2 sand-1e66mq1 sand-rv4cvt`;
const P = LEAF;
const STRONG = `${LEAF} sand-xzm5a7`;
const UL = `${LEAF} sand-43c9pm sand-1gycotm sand-taz4m5`;
const OL = `${LEAF} sand-43c9pm sand-1gycotm sand-3yw8vx`;
const LI = `${LEAF} sand-1xnkbjl`;
const CODE_INLINE = `${LEAF} sand-67nlm8 sand-1gojbwh sand-12oo3zp`;
const PRE = `${LEAF} sand-12ffz05 sand-1m31zm8 sand-ur7f20 sand-1ciwos8 sand-19aaqeu sand-1evy7pa`;
const BLOCKQUOTE = `${LEAF} sand-rxpjvj sand-yumdvf sand-1t7ytsu sand-72uvru sand-19aaqeu sand-11jd7i5 sand-7ru5ko`;
const HR = "sand-178xt8z sand-13fuv20 sand-2kampu sand-11pwa6s sand-1sy0etr sand-1b16gh4 sand-1mdx765 sand-8kmwxx";

function createMarkdownIt(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
  });

  md.renderer.rules.link_open = (tokens, index, options, _env, self) => {
    const token = tokens[index];
    token.attrSet("class", LINK_CLASSES);
    token.attrSet("rel", "noopener noreferrer");
    token.attrSet("target", "_blank");
    return self.renderToken(tokens, index, options);
  };

  const headingOpen = md.renderer.rules.heading_open
    ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const level = token.tag;
    const className = level === "h1" ? H1 : level === "h2" ? H2 : level === "h3" ? H3 : H4;
    token.attrJoin("class", className);
    return headingOpen(tokens, index, options, env, self);
  };

  const paragraphOpen = md.renderer.rules.paragraph_open
    ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.paragraph_open = (tokens, index, options, env, self) => {
    tokens[index].attrJoin("class", P);
    return paragraphOpen(tokens, index, options, env, self);
  };

  md.renderer.rules.strong_open = (tokens, index, options, _env, self) => {
    tokens[index].attrJoin("class", STRONG);
    return self.renderToken(tokens, index, options);
  };
  md.renderer.rules.em_open = (tokens, index, options, _env, self) => {
    tokens[index].attrJoin("class", LEAF);
    return self.renderToken(tokens, index, options);
  };

  const bulletOpen = md.renderer.rules.bullet_list_open
    ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.bullet_list_open = (tokens, index, options, env, self) => {
    tokens[index].attrJoin("class", UL);
    return bulletOpen(tokens, index, options, env, self);
  };

  const orderedOpen = md.renderer.rules.ordered_list_open
    ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.ordered_list_open = (tokens, index, options, env, self) => {
    tokens[index].attrJoin("class", OL);
    return orderedOpen(tokens, index, options, env, self);
  };

  const listItemOpen = md.renderer.rules.list_item_open
    ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.list_item_open = (tokens, index, options, env, self) => {
    tokens[index].attrJoin("class", LI);
    return listItemOpen(tokens, index, options, env, self);
  };

  const codeInline = md.renderer.rules.code_inline
    ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.code_inline = (tokens, index, options, env, self) => {
    tokens[index].attrJoin("class", CODE_INLINE);
    return codeInline(tokens, index, options, env, self);
  };

  const fence = md.renderer.rules.fence
    ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const rendered = fence(tokens, index, options, env, self);
    return rendered.replace("<pre>", `<pre class="${PRE}">`).replace("<code>", `<code class="${CODE_INLINE}">`);
  };

  const blockquoteOpen = md.renderer.rules.blockquote_open
    ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.blockquote_open = (tokens, index, options, env, self) => {
    tokens[index].attrJoin("class", BLOCKQUOTE);
    return blockquoteOpen(tokens, index, options, env, self);
  };

  md.renderer.rules.hr = (tokens, index, options, _env, self) => {
    tokens[index].attrJoin("class", HR);
    return self.renderToken(tokens, index, options);
  };

  return md;
}

const markdownIt = createMarkdownIt();

export interface FileMarkdownProps {
  readonly text: string;
}

/** Official `Iwn`/`Bwn` document shell around rendered markdown. */
export function FileMarkdown({ text }: FileMarkdownProps): ReactNode {
  const html = useMemo(() => markdownIt.render(text), [text]);
  return (
    <div className={`sand-file-viewer__body sand-1iyjqo2 sand-2lwn1j`}>
      <div className={MARKDOWN_PAGE_CLASSES} dir="auto">
        <div className={MARKDOWN_ROOT_CLASSES} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

/** Lifted from 0.71.2 so link accent resolves when sand-10kc733 is absent in 0.18 CSS. */
export const FILE_MARKDOWN_LINK_ACCENT_CSS = `
.sand-10kc733:not(#\\#):not(#\\#):not(#\\#){color:var(--sand-text-accent-primary,var(--cursor-text-link))}
`.trim();
