import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { createPackage } from "@electron/asar";
import JSZip from "jszip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assets = ["pdf-WLgSwHwh.js", "pdf.worker.min-qwK7q_zL.mjs", "xlsx-CNerDvZX.js", "index-lCyB53CO.css", "cursor-icons-16-f_W_ogc-.woff2"];
const docx = new JSZip();
docx.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
docx.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
docx.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Preview DOCX body</w:t></w:r></w:p></w:body></w:document>');
const docxFixture = [...await docx.generateAsync({ type: "uint8array" })];

function pdfBytes() {
  const drawing = "0 0 0 rg 30 30 200 100 re f\n";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << >> /Contents 4 0 R >>", `<< /Length ${drawing.length} >>\nstream\n${drawing}endstream`];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return [...Buffer.from(pdf)];
}

const renderer = `
import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {LibraryFileViewer} from './frontend/src/recovered/features/library/file-viewer';
import {loadShippedPdfRuntime, resolveShippedViewerAsset, resolvePdfWorkerUrl} from './frontend/src/recovered/features/conversation/workspace/pdf-viewer';
import {loadShippedSpreadsheetRuntime} from './frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer';
import {buildRuntimeThemeCss} from './frontend/src/recovered/features/runtime-theme-token-installer';
const root = createRoot(document.getElementById('root'));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const wait = async (predicate) => { const end = performance.now() + 12000; while (!predicate()) { if (performance.now() > end) throw new Error('Preview timed out: ' + document.body.innerText); await new Promise(requestAnimationFrame); } };
const reads = [];
let downloads = 0;
const base = {isOpen:true, name:'original.pdf', source:'file:///home/box/original.pdf', onClose(){root.render(null)}, onDownload:async()=>{downloads++;return true}, readTextBytes:async(source)=>{reads.push(source);return {kind:'bytes',bytes:new TextEncoder().encode('Preview text body')}}, readPdfBytes:async(source)=>{reads.push(source);return {kind:'bytes',bytes:new Uint8Array(PDF_FIXTURE)}}, readDocxBytes:async(source)=>{reads.push(source);return {kind:'bytes',bytes:new Uint8Array(DOCX_FIXTURE)}}, readTableBytes:async(source)=>{reads.push(source);return {kind:'bytes',bytes:new TextEncoder().encode('Name,Count\\nOriginal,7\\n')}}};
window.runLoaders = async () => {
 const runtime = await loadShippedPdfRuntime();
 const doc = await runtime.getDocument({data:new Uint8Array(PDF_FIXTURE),isEvalSupported:false,disableAutoFetch:true}).promise;
 const page = await doc.getPage(1);
 check(doc.numPages===1 && page.getViewport({scale:1}).width===300,'PDF parser output');
 await doc.destroy();
 const table = await loadShippedSpreadsheetRuntime();
 const book = table.read(new TextEncoder().encode('Name,Count\\nOriginal,7'),{type:'array'});
 const rows = table.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
 check(rows[1][0]==='Original' && rows[1][1]===7,'CSV parser output');
 let oldImport;
 try { await import('/upstream/assets/pdf-WLgSwHwh.js'); oldImport='loaded'; } catch (error) { oldImport=String(error); }
 const urls = ['pdf-WLgSwHwh.js','pdf.worker.min-qwK7q_zL.mjs','xlsx-CNerDvZX.js'].map(name=>resolveShippedViewerAsset(name));
 check(resolveShippedViewerAsset('xlsx-CNerDvZX.js','http://127.0.0.1:1234/nested/index.html')==='http://127.0.0.1:1234/upstream/assets/xlsx-CNerDvZX.js','HTTP asset route');
 check(resolvePdfWorkerUrl(urls[0])===urls[1],'worker adjacent to actual runtime');
 check(resolvePdfWorkerUrl(undefined,document.baseURI)===urls[1],'worker honors explicit file base');
 return {baseURI:document.baseURI,urls,worker:runtime.GlobalWorkerOptions.workerSrc,pdf:{pages:1,width:300},csv:rows,oldImport};
};
window.showPreview = async (kind) => {
 await document.fonts.load('16px cursor-icons');
 const source = 'file:///home/box/original.'+kind;
 const name = 'original.'+kind;
 const props = {...base, kind, source, name};
 if(kind==='audio') {
  const bytes = new ArrayBuffer(1644), view = new DataView(bytes);
  const tag=(at,s)=>[...s].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
  tag(0,'RIFF');view.setUint32(4,1636,true);tag(8,'WAVE');tag(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);tag(36,'data');view.setUint32(40,1600,true);
  props.resolveMedia=async(locator)=>{reads.push(locator);return {kind:'audio',src:'data:audio/wav;base64,'+btoa(String.fromCharCode(...new Uint8Array(bytes)))}};
 }
 root.render(h(LibraryFileViewer,{...props,key:kind}));
 await wait(()=>document.querySelector('[role=dialog] h2')?.textContent===name);
 if(kind==='pdf') {
  await wait(()=>document.querySelector('.sand-pdf-page img')?.naturalWidth>0);
  const canvas=document.createElement('canvas');canvas.width=300;canvas.height=200;
  const context=canvas.getContext('2d');context.drawImage(document.querySelector('.sand-pdf-page img'),0,0,300,200);
  check(context.getImageData(100,100,1,1).data[0]===0,'PDF raster rectangle missing');
 }
 if(kind==='table') {
  await wait(()=>document.querySelector('td[data-cell]')?.textContent==='Original');
  check(getComputedStyle(document.querySelector('td[data-cell]')).color===(window.previewTheme==='dark'?'rgb(252, 252, 252)':'rgb(20, 20, 20)'),'table foreground CSS missing');
 }
 if(kind==='audio') { await wait(()=>document.querySelector('audio')?.readyState>=2 && !document.querySelector('[role=status]')); await document.querySelector('audio').play(); }
 if(kind==='docx') await wait(()=>document.querySelector('.sand-docx-viewer__body')?.textContent.includes('Preview DOCX body'));
 if(kind==='markdown'||kind==='text') await wait(()=>document.querySelector('[role=dialog]')?.textContent.includes('Preview text body'));
 const dialog=document.querySelector('[role=dialog]'), panel=dialog.querySelector('.sand-file-viewer__panel'), body=dialog.querySelector('.sand-file-viewer__body');
 check(dialog.querySelector('h2').textContent===name,'title preserved');
 check(getComputedStyle(dialog).position==='fixed','viewer overlay CSS missing');
 check(getComputedStyle(panel).display==='flex','viewer panel CSS missing');
 check(getComputedStyle(panel).color===(window.previewTheme==='dark'?'rgb(252, 252, 252)':'rgb(20, 20, 20)'),'viewer foreground CSS missing');
 check(panel.getBoundingClientRect().height>100 && body.getBoundingClientRect().height>0,'viewer layout collapsed');
 const close=dialog.querySelector('[aria-label="Close preview"]'), closeStyle=getComputedStyle(close);
 check(closeStyle.width==='36px' && closeStyle.height==='36px','official stage button dimensions');
 check(closeStyle.borderRadius==='9999px' && closeStyle.borderTopStyle==='solid','official elevated circle style');
 check(close.title==='关闭' && close.hasAttribute('data-stage-resting-focus'),'close tooltip and focus marker');
 check(close.querySelector('[data-icon-name="close"]')?.style.fontSize==='16px','official lg close glyph');
 check(document.fonts.check('16px cursor-icons'),'close icon font is loaded');
 if(kind==='pdf') check(getComputedStyle(document.querySelector('.sand-pdf-page__text')).position==='absolute','PDF text CSS missing');
 dialog.querySelector('[aria-label="Download file"]').click();
 await Promise.resolve();
 const rect=close.getBoundingClientRect();
 const result={kind,title:dialog.querySelector('h2').textContent,reads:[...reads],downloads,position:getComputedStyle(dialog).position,panelDisplay:getComputedStyle(panel).display,bodyHeight:body.getBoundingClientRect().height,bodyText:body.innerText,audioPlaying:kind==='audio'?!document.querySelector('audio').paused:undefined,close:{width:closeStyle.width,height:closeStyle.height,title:close.title,borderRadius:closeStyle.borderRadius,x:rect.x,y:rect.y,w:rect.width,h:rect.height}};
 window.closePreview=async()=>{close.click();await wait(()=>document.querySelector('[role=dialog]')==null);return true};
 return result;
};
window.setPreviewTheme=theme=>{let style=document.getElementById('qa-theme');if(!style){style=document.createElement('style');style.id='qa-theme';document.head.append(style)}style.textContent=buildRuntimeThemeCss(theme);window.previewTheme=theme};
window.closeButtonHover=()=>getComputedStyle(document.querySelector('[aria-label="Close preview"]')).backgroundImage;
`.replaceAll("PDF_FIXTURE", JSON.stringify(pdfBytes())).replaceAll("DOCX_FIXTURE", JSON.stringify(docxFixture));

test("pinned file viewers including DOCX and text render visible overlays from a packaged file renderer", { timeout: 90000 }, async () => {
  const evidence = process.env.R7C_EVIDENCE_DIR ?? await fs.mkdtemp(path.join(os.tmpdir(), "library-file-viewer-"));
  await fs.mkdir(evidence, { recursive: true });
  const stage = path.join(evidence, "stage");
  const rendererRoot = path.join(stage, "dist/renderer");
  await fs.mkdir(path.join(rendererRoot, "assets"), { recursive: true });
  const manifest = [];
  for (const name of assets) {
    const source = path.join(root, "src/app/dist/renderer/assets", name);
    const bytes = await fs.readFile(source);
    const target = path.join(rendererRoot, "assets", name);
    await fs.writeFile(target, bytes);
    manifest.push({ name, source, target, bytes: bytes.length, sha256: hash(bytes) });
  }
  const built = await build({ stdin: { contents: renderer, resolveDir: root, loader: "tsx" }, bundle: true, format: "esm", platform: "browser", outfile: path.join(rendererRoot, "assets/preview.js"), loader: { ".css": "empty" }, metafile: true });
  await fs.writeFile(path.join(evidence, "bundle-inputs.json"), JSON.stringify(built.metafile, null, 2));
  const stageButtonCss = await fs.readFile(path.join(root, "frontend/src/recovered/features/library/stage-icon-button.css"), "utf8");
  await fs.writeFile(path.join(rendererRoot, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./assets/index-lCyB53CO.css"><style>' + stageButtonCss + '</style></head><body><div id="root"></div><script type="module" src="./assets/preview.js"></script></body></html>');
  const archive = path.join(evidence, "app.asar");
  await createPackage(stage, archive);
  await fs.writeFile(path.join(evidence, "manifest.json"), JSON.stringify({ assets: manifest, archive: { path: archive, sha256: hash(await fs.readFile(archive)) } }, null, 2));
  const main = path.join(evidence, "main.cjs");
  await fs.writeFile(main, `
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
app.setPath('userData',${JSON.stringify(path.join(evidence, "userData"))});
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
let win;
const errors=[];
const timer=setTimeout(()=>{fs.writeFileSync(${JSON.stringify(path.join(evidence, "timeout.json"))},JSON.stringify(errors));app.exit(2)},45000);
app.whenReady().then(async()=>{
 try {
  win=new BrowserWindow({show:true,width:1024,height:768,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
  win.webContents.on('console-message',(_event,...args)=>errors.push(args.map(String).join(' ')));
  await win.loadFile(${JSON.stringify(path.join(archive, "dist/renderer/index.html"))});
  const loaders=await win.webContents.executeJavaScript('window.runLoaders()');
  const previews=[], darkPreviews=[];
  for(const theme of ['light','dark']) {
   await win.webContents.executeJavaScript('window.setPreviewTheme('+JSON.stringify(theme)+')');
   for(const kind of ['pdf','table','audio','docx','markdown','text']) {
   const preview=await win.webContents.executeJavaScript('window.showPreview('+JSON.stringify(kind)+')');
   (theme==='light'?previews:darkPreviews).push(preview);
   await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   fs.writeFileSync(${JSON.stringify(evidence)}+'/'+(theme==='light'?'':theme+'-')+kind+'.png',(await win.webContents.capturePage()).toPNG());
   win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(preview.close.x+preview.close.w/2),y:Math.round(preview.close.y+preview.close.h/2)});
   await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   const hover=await win.webContents.executeJavaScript('window.closeButtonHover()');
   if(hover==='none') throw new Error('stage close hover missing');
   preview.close.hoverImage=hover;
   fs.writeFileSync(${JSON.stringify(evidence)}+'/'+theme+'-'+kind+'-hover.png',(await win.webContents.capturePage()).toPNG());
   win.webContents.sendInputEvent({type:'mouseMove',x:0,y:0});
   await win.webContents.executeJavaScript('window.closePreview()');
   }
  }
  fs.writeFileSync(${JSON.stringify(path.join(evidence, "runtime.json"))},JSON.stringify({loaders,previews,darkPreviews,console:errors},null,2));
  clearTimeout(timer);win.destroy();app.exit(0);
 } catch(error) {fs.writeFileSync(${JSON.stringify(path.join(evidence, "failure.json"))},JSON.stringify({error:String(error),stack:error.stack,console:errors},null,2));clearTimeout(timer);win?.destroy();app.exit(1)}
});`);
  const electron = process.env.ELECTRON_BINARY ?? path.resolve(root, "../../grok-bot-0.18-reconstructed/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
  const log = [];
  const exit = await new Promise((resolve, reject) => {
    const child = spawn(electron, [main], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (bytes) => log.push(bytes));
    child.stderr.on("data", (bytes) => log.push(bytes));
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal, pid: child.pid }));
  });
  await fs.writeFile(path.join(evidence, "electron.log"), Buffer.concat(log));
  await fs.writeFile(path.join(evidence, "electron-exit.json"), JSON.stringify(exit));
  await fs.rm(path.join(evidence, "userData"), { recursive: true, force: true });
  assert.equal(exit.code, 0, `Electron preview failed; artifacts: ${evidence}`);
  const result = JSON.parse(await fs.readFile(path.join(evidence, "runtime.json"), "utf8"));
  assert.match(result.loaders.baseURI, /app\.asar\/dist\/renderer\/index\.html$/);
  assert.match(result.loaders.oldImport, /Failed|Error/);
  for (const url of result.loaders.urls) assert.match(url, /app\.asar\/dist\/renderer\/assets\//);
  assert.equal(result.previews.length, 6);
  assert.equal(result.darkPreviews.length, 6);
  assert.equal(result.previews[2].audioPlaying, true);
  console.log(JSON.stringify({ evidence, exit, result }));
});
