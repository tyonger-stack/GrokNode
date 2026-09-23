import type { BotTemplateBridge, BotTemplateManualContents, BotTemplatePreview, BotTemplateRecord } from "../../../source/shared/bot-template";
import styles from "./bot-template.css?inline";

interface TemplateDesktop {
  readonly botTemplates: BotTemplateBridge;
  onDeepLink(listener: (value: unknown) => void): () => void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const child = document.createElementNS(svg.namespaceURI, "path");
  child.setAttribute("d", path);
  svg.append(child);
  return svg;
}

function button(label: string, className: string, action: () => void, path?: string): HTMLButtonElement {
  const node = element("button", className, path === undefined ? label : undefined);
  node.type = "button";
  node.setAttribute("aria-label", label);
  node.addEventListener("click", action);
  if (path !== undefined) node.append(icon(path));
  return node;
}

function avatar(template: BotTemplateRecord): SVGSVGElement {
  const svg = icon(template.shape === "teardrop" ? "M12 1C10 3 3 10 3 15a9 9 0 0 0 18 0C21 10 14 3 12 1Z" : "M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22Z");
  svg.classList.add("bt-avatar");
  svg.setAttribute("stroke", "none");
  svg.setAttribute("fill", template.color ?? "currentColor");
  const eyes = document.createElementNS(svg.namespaceURI, "path");
  eyes.setAttribute("d", "M10 12l.7 2.2M16 11l.7 2.2");
  eyes.setAttribute("stroke", "var(--bt-detail)");
  eyes.setAttribute("stroke-width", "1.8");
  svg.append(eyes);
  return svg;
}

const SECTIONS = [
  ["instructions", "指令", "此 Bot 的工作方式", "填写此 Bot 的核心指令、工作边界和回答方式。"],
  ["memory", "记忆", "它已知的信息", "每行填写一条它应长期记住的信息。"],
  ["skills", "技能", "它可以运行的操作手册", "粘贴本地 SKILL.md 内容，或用自然语言描述它应掌握的操作手册。"],
  ["routines", "例行任务", "自动运行的任务", "每行一项，格式如：0 9 * * 1-5 | 工作日早上检查待办。"],
  ["integrations", "集成", "它可以使用的工具", "填写需要使用的本地工具或集成；导入不会自动安装云端插件。"],
] as const;

function details(template: BotTemplateRecord): { readonly node: HTMLElement; collect(): BotTemplateManualContents } {
  const area = element("section", "bt-details");
  const tabs = element("div", "bt-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Bot 模板详情");
  const content = element("div", "bt-content");
  content.id = "grok-template-content";
  content.setAttribute("role", "tabpanel");
  content.tabIndex = 0;
  const items: HTMLButtonElement[] = [];
  const editors = new Map<string, HTMLTextAreaElement>();
  const select = (index: number): void => {
    const section = SECTIONS[index];
    if (section === undefined) return;
    items.forEach((item, i) => { item.setAttribute("aria-selected", String(i === index)); item.tabIndex = i === index ? 0 : -1; });
    content.setAttribute("aria-labelledby", "grok-template-" + section[0]);
    editors.forEach((editor, id) => { editor.classList.toggle("active", id === section[0]); });
    editors.get(section[0])?.focus();
  };
  SECTIONS.forEach(([id, label, subtitle, placeholder], index) => {
    const editor = element("textarea", "bt-editor");
    editor.value = id === "instructions" ? template.description : "";
    editor.placeholder = placeholder;
    editor.setAttribute("aria-label", label);
    editors.set(id, editor);
    content.append(editor);
    const tab = button(label, "bt-tab", () => select(index));
    tab.id = "grok-template-" + id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", content.id);
    tab.append(element("span", "", subtitle));
    tab.addEventListener("keydown", event => {
      const next = event.key === "Home" ? 0 : event.key === "End" ? SECTIONS.length - 1
        : event.key === "ArrowDown" || event.key === "ArrowRight" ? (index + 1) % SECTIONS.length
        : event.key === "ArrowUp" || event.key === "ArrowLeft" ? (index + SECTIONS.length - 1) % SECTIONS.length : null;
      if (next === null) return;
      event.preventDefault(); select(next); items[next]?.focus();
    });
    items.push(tab); tabs.append(tab);
  });
  select(0);
  area.append(tabs, content);
  return {
    node: area,
    collect: () => ({
      instructions: editors.get("instructions")?.value ?? "",
      memory: editors.get("memory")?.value ?? "",
      skills: editors.get("skills")?.value ?? "",
      routines: editors.get("routines")?.value ?? "",
      integrations: editors.get("integrations")?.value ?? ""
    })
  };
}

function openPreview(bridge: BotTemplateBridge, templateId: string): { close(): boolean } {
  const dialog = element("dialog", "grok-template");
  dialog.setAttribute("aria-label", "导入 Bot");
  const style = element("style", ""); style.textContent = styles;
  const header = element("header", "");
  const body = element("div", "bt-scroll");
  const status = element("p", "bt-status");
  status.setAttribute("aria-live", "polite");
  let pending = false;
  let preview: BotTemplatePreview | null = null;
  const close = (): boolean => { if (pending) return false; dialog.close(); return true; };
  const back = button("返回", "bt-icon", close, "m14 5-7 7 7 7");
  const dismiss = button("关闭", "bt-icon", close, "m5 5 14 14M19 5 5 19");
  const share = button("复制分享链接", "bt-icon", () => {
    const url = preview?.template.sourceUrl;
    if (url === undefined) return;
    void navigator.clipboard.writeText(url).then(() => { status.textContent = "已复制分享链接"; }, () => { status.textContent = "无法复制链接：" + url; });
  }, "M12 16V2m-5 5 5-5 5 5M5 12v9h14v-9");
  share.disabled = true;
  header.append(back, element("span", "bt-spacer"), share, dismiss);
  dialog.append(style, header, body);
  dialog.addEventListener("cancel", event => { if (pending) event.preventDefault(); });
  dialog.addEventListener("close", () => { dialog.remove(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  const render = (snapshot: BotTemplatePreview): void => {
    const template = snapshot.template;
    const templateDetails = details(template);
    const hero = element("section", "bt-hero");
    const row = element("div", "bt-title-row");
    const title = element("h1", "", template.name);
    const confirm = button("导入 Bot", "bt-import", () => {
      if (pending) return;
      const contents = templateDetails.collect();
      if (contents.instructions.trim().length === 0) {
        status.setAttribute("role", "alert");
        status.textContent = "请先填写指令，再导入 Bot。";
        return;
      }
      pending = true; confirm.disabled = true; back.disabled = true; dismiss.disabled = true;
      confirm.textContent = "正在导入…"; status.textContent = ""; status.setAttribute("role", "status");
      void bridge.import(snapshot.previewId, contents).then(() => { pending = false; dialog.close(); }, (error: unknown) => {
        pending = false; confirm.disabled = false; back.disabled = false; dismiss.disabled = false;
        confirm.textContent = "重试导入"; status.setAttribute("role", "alert");
        status.textContent = "导入失败：" + (error instanceof Error ? error.message : String(error));
      });
    });
    row.append(title, confirm);
    hero.append(avatar(template), row, element("p", "bt-author", template.author === null ? "创建者未公开" : "由 " + template.author + " 创建"), element("p", "bt-description", template.description));
    body.replaceChildren(
      hero,
      templateDetails.node,
      element("p", "bt-note", "公开分享页未提供完整详情。请逐项补全后本地导入；集成内容只作为本地配置，不会自动安装云端插件。"),
      status
    );
  };
  const openManual = (reason: string): void => {
    preview = null;
    share.disabled = true;
    const manualRecord: BotTemplateRecord = { templateId, sourceUrl: "https://x.ai/bot/" + encodeURIComponent(templateId), name: "", description: "", author: null, color: null, shape: null };
    const templateDetails = details(manualRecord);
    const nameInput = element("input", "bt-name");
    nameInput.type = "text";
    nameInput.maxLength = 120;
    nameInput.placeholder = "例如 dr eggbot";
    nameInput.setAttribute("aria-label", "Bot 名称");
    const confirm = button("导入 Bot", "bt-import", () => {
      if (pending) return;
      const name = nameInput.value.trim();
      const contents = templateDetails.collect();
      if (name.length === 0 || contents.instructions.trim().length === 0) {
        status.setAttribute("role", "alert");
        status.textContent = name.length === 0 ? "请先填写 Bot 名称，再导入。" : "请先填写指令，再导入 Bot。";
        return;
      }
      pending = true; confirm.disabled = true; back.disabled = true; dismiss.disabled = true;
      confirm.textContent = "正在导入…"; status.textContent = ""; status.setAttribute("role", "status");
      void bridge.previewManual(templateId, name)
        .then(snapshot => bridge.import(snapshot.previewId, contents))
        .then(() => { pending = false; dialog.close(); }, (error: unknown) => {
          pending = false; confirm.disabled = false; back.disabled = false; dismiss.disabled = false;
          confirm.textContent = "重试导入"; status.setAttribute("role", "alert");
          status.textContent = "导入失败：" + (error instanceof Error ? error.message : String(error));
        });
    });
    const row = element("div", "bt-title-row");
    row.append(nameInput, confirm);
    const hero = element("section", "bt-hero");
    hero.append(row);
    status.setAttribute("role", "alert");
    status.textContent = "无法读取公开模板：" + reason + "。请手动填写名称与内容后本地导入。";
    body.replaceChildren(
      hero,
      templateDetails.node,
      element("p", "bt-note", "手动导入只写入本地配置；集成内容不会自动安装云端插件。网络恢复后可用下方按钮重新读取公开分享页。"),
      button("重试读取公开页", "bt-tab", () => { void load(); }),
      status
    );
    nameInput.focus();
  };
  const load = async (): Promise<void> => {
    const loading = element("div", "bt-loading");
    const message = element("p", "bt-status", "正在读取 Bot 模板…"); message.setAttribute("role", "status");
    loading.append(message); body.replaceChildren(loading);
    let watchdog: number | undefined;
    try {
      const result = await Promise.race([
        bridge.preview(templateId),
        new Promise<never>((_resolve, reject) => { watchdog = window.setTimeout(() => reject(new Error("读取公开模板超时，已切换到手动填写。")), 26_000); }),
      ]);
      if (!dialog.isConnected) return;
      preview = result; share.disabled = false; render(result);
    } catch (error) {
      if (!dialog.isConnected) return;
      openManual(error instanceof Error ? error.message : String(error));
    } finally {
      if (watchdog !== undefined) window.clearTimeout(watchdog);
    }
  };
  void load();
  return { close };
}

export function installBotTemplatePreview(desktop: TemplateDesktop): () => void {
  let active: ReturnType<typeof openPreview> | null = null;
  const unsubscribe = desktop.onDeepLink(value => {
    if (typeof value !== "object" || value === null || !("route" in value) || value.route !== "bot-template"
      || !("templateId" in value) || typeof value.templateId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.templateId)) return;
    if (active !== null && !active.close()) return;
    active = openPreview(desktop.botTemplates, value.templateId);
  });
  return () => { unsubscribe(); active?.close(); };
}
