import { createCardPreview, setCardFontScale } from '../../src/ui/card-preview.ts';
import { renderCardToPng } from '../../src/utils/png-export.ts';
import { SocialConverterView } from '../../src/ui/social-converter-view.ts';
import { DEFAULT_SETTINGS } from '../../src/settings.ts';
import { Component, TFile } from 'obsidian';

window.activeDocument = document;
const proto = HTMLElement.prototype;
proto.instanceOf = function (cls) { return this instanceof cls; };
proto.createEl = function (tag, options = {}) {
 const element = this.ownerDocument.createElement(tag);
 if (options.cls) element.className = options.cls;
 if (options.text) element.textContent = options.text;
 for (const key of ['type', 'value']) if (options[key]) element[key] = options[key];
 for (const [key, value] of Object.entries(options.attr || {})) element.setAttribute(key, value);
 this.appendChild(element); return element;
};
proto.createDiv = function (options) { return this.createEl('div', options); };
proto.createSpan = function (options) { return this.createEl('span', options); };
proto.empty = function () { this.replaceChildren(); };
proto.addClass = function (name) { this.classList.add(name); };
proto.hasClass = function (name) { return this.classList.contains(name); };
proto.toggleClass = function (name, enabled) { this.classList.toggle(name, enabled); };
proto.setCssProps = function (properties) { for (const [key, value] of Object.entries(properties)) this.style.setProperty(key, value); };

const results = [];
function assert(condition, label) { if (!condition) throw new Error(label); results.push(label); }
const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
function font(frame, selector = 'p') { return parseFloat(frame.contentWindow.getComputedStyle(frame.contentDocument.querySelector(selector)).fontSize); }
async function makeCard(content, { mode = 'light', scale = 100, width = 1080, height = 1350, themeCss = '' } = {}) {
 const item = document.body.createDiv();
 const host = item.createDiv({ cls: 'social-converter__image' });
 host.style.width = '400px'; host.style.aspectRatio = `${width}/${height}`;
 const staging = document.createElement('div'); staging.innerHTML = content;
 const component = new Component();
 const frame = await createCardPreview(host, staging, { width, height, colorMode: mode, fontScale: scale, themeCss, component, isCurrent: () => true });
 return { host, frame, component };
}
async function pixels(frame, width = 1080, height = 1350) {
 const blob = await renderCardToPng(frame, width, height);
 const bitmap = await createImageBitmap(blob);
 assert(bitmap.width === width && bitmap.height === height, `PNG dimensions ${width} × ${height}`);
 const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
 const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
 return { data: canvas.toDataURL(), at: (x, y) => [...ctx.getImageData(x, y, 1, 1).data] };
}

async function run() {
 document.body.className = 'theme-light';
 const dark = await makeCard('<h1>Heading</h1><p>Text</p>', { mode: 'dark' });
 const light = await makeCard('<h1>Heading</h1><p>Text</p>');
 const darkPng = await pixels(dark.frame); const lightPng = await pixels(light.frame);
 assert(darkPng.at(0, 0)[0] < 50 && lightPng.at(0, 0)[0] > 240, 'PNG mode is independent of host mode');
 document.body.className = 'theme-dark';
 assert((await pixels(light.frame)).at(0, 0)[0] > 240, 'Light export remains light in dark host');
 const initial = await pixels(dark.frame);
 dark.host.style.width = '230px'; await wait();
 assert((await pixels(dark.frame)).data === initial.data, 'Sidebar resizing leaves PNG identical');
 const themed = await makeCard('<h1>Heading</h1><p>Text <strong>bold</strong></p>', { themeCss: 'body { --font-text-size:20px; --h1-size:42px; }' });
 setCardFontScale(themed.frame, 150);
 assert(font(themed.frame) === 30 && font(themed.frame, 'h1') === 63 && font(themed.frame, 'strong') === 30, 'Theme typography scales evenly');
 setCardFontScale(themed.frame, 100);
 assert(font(themed.frame) === 20 && font(themed.frame, 'h1') === 42, 'Repeated scaling uses original template sizes');
 const long = await makeCard('<p>' + 'Text '.repeat(1500) + '</p>');
 assert(font(long.frame) === font(light.frame) && long.frame.dataset.overflow === 'true', 'Long text warns without shrinking');
 const story = await makeCard('<p>Story</p>', { height: 1920 }); await pixels(story.frame, 1080, 1920);

 const file = new TFile('Test.md'); const pdf = new TFile('test.pdf');
 const other = new TFile('Other.md'); const third = new TFile('Third.md');
 const originalSource = ['One', 'Two', 'Three', 'Four', 'PDF slide', 'Six', 'Seven'].join('\n\n---\n\n');
 const sources = new Map([[file, originalSource], [other, 'Other note'], [third, 'Third note']]);
 const readDelays = new Map();
 let activeFile = file;
 const emitter = () => {
  const handlers = new Map();
  return { on(event, fn) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); return { off: () => handlers.get(event).delete(fn) }; },
   emit(event, value) { for (const fn of handlers.get(event) ?? []) fn(value); } };
 };
 const workspaceEvents = emitter(); const vaultEvents = emitter();
 const openFile = (note) => { activeFile = note; workspaceEvents.emit('file-open', note); };
 const waitUntil = async (predicate) => { for (let n = 0; n < 100; n++) { if (predicate()) return; await wait(); } throw new Error('View update timeout'); };
 const app = {
  workspace: { ...workspaceEvents, requestSaveLayout() {}, getActiveFile: () => activeFile }, customCss: { theme: '', themes: {} },
  vault: { ...vaultEvents, getAbstractFileByPath: (path) => [file, other, third].find((note) => note.path === path), cachedRead: async (note) => { if (readDelays.has(note)) await readDelays.get(note); return sources.get(note); }, readBinary: async () => new ArrayBuffer(0) },
  metadataCache: { getFirstLinkpathDest: () => pdf },
 };
 let view;
 const plugin = { settings: { ...DEFAULT_SETTINGS }, saveSettings: async () => view.refresh() };
 view = new SocialConverterView({ app }, plugin);
 await view.onOpen();
 await view.setState({ file: file.path, platform: 'instagram', colorMode: 'light' }, { history: false });
 const frames = () => [...view.contentEl.querySelectorAll('iframe')];
 const field = (label) => view.contentEl.querySelector(`input[aria-label="${label} (%)"]`);
 const change = async (label, value) => { const input = field(label); input.value = value; input.dispatchEvent(new Event('change')); await wait(); };
 assert(frames().length === 7, 'Seven slides rendered');
 const item = view.contentEl.querySelectorAll('.social-converter__gallery-item')[4];
 assert(item.firstElementChild.classList.contains('social-converter__font-size'), 'Font control sits above its slide');
 await change('Global font size', 150);
 assert(frames().every((frame) => font(frame) === 24), 'Global setting updates all slides');
 await change('Slide 5 font size', 120);
 assert(font(frames()[4]) === 19.2 && font(frames()[3]) === 24, 'Slide override only changes chosen slide');
 await change('Global font size', 200);
 assert(font(frames()[4]) === 19.2 && font(frames()[3]) === 32, 'Slide override survives global changes');
 const state = view.getState(); const restored = new SocialConverterView({ app }, plugin);
 await restored.setState(state, { history: false });
 assert(font(restored.contentEl.querySelectorAll('iframe')[4]) === 19.2, 'Workspace restores slide override');
 restored.unload(); restored.contentEl.remove();
 const reset = item.querySelector('button'); reset.click();
 assert(font(frames()[4]) === 32 && reset.disabled, 'Reset restores global inheritance');
 await change('Global font size', 100);
 const pdfFrame = frames()[4]; const doc = pdfFrame.contentDocument;
 const image = doc.querySelector('img.social-converter__pdf-page');
 assert(image?.naturalWidth > 0, 'PDF becomes a decoded static image');
 const bounds = image.getBoundingClientRect(); const capture = doc.querySelector('.social-converter-card-capture').getBoundingClientRect();
 assert(bounds.left >= 0 && bounds.right <= capture.right && bounds.top >= 0 && bounds.bottom <= capture.bottom, 'Full PDF image fits inside slide');
 assert(Math.abs(bounds.width / bounds.height - image.naturalWidth / image.naturalHeight) < 0.01, 'PDF aspect ratio preserved');
 const pdfPng = await pixels(pdfFrame);
 const inset = 5; const factor = 1080 / 480;
 const topLeft = pdfPng.at(Math.round((bounds.left + inset) * factor), Math.round((bounds.top + inset) * factor));
 const bottomRight = pdfPng.at(Math.round((bounds.right - inset) * factor), Math.round((bounds.bottom - inset) * factor));
 assert(topLeft[0] > 240 && topLeft[2] < 20 && bottomRight[2] > 240 && bottomRight[0] < 20, 'PNG includes both opposite PDF corners');
 const embedded = await makeCard('<p>Before media.</p><span class="internal-embed image-embed" style="width:100px;height:60px;overflow:hidden"><img src="' + image.src + '" width="1200" height="200" style="object-fit:cover;clip-path:inset(0 50% 0 0)"></span><p>After media.</p>');
 const embeddedImage = embedded.frame.contentDocument.querySelector('img');
 const embeddedBounds = embeddedImage.getBoundingClientRect();
 const wrapperBounds = embeddedImage.parentElement.getBoundingClientRect();
 assert(embeddedBounds.height > 60 && embeddedBounds.top >= wrapperBounds.top && embeddedBounds.bottom <= wrapperBounds.bottom && embeddedBounds.left >= wrapperBounds.left && embeddedBounds.right <= wrapperBounds.right, 'Fixed embed containers expand to contain the whole image');
 assert(Math.abs(embeddedBounds.width / embeddedBounds.height - image.naturalWidth / image.naturalHeight) < 0.01, 'Conflicting image dimensions preserve intrinsic aspect ratio');
 const linked = await makeCard('<p><a href="#"><img src="' + image.src + '"></a></p>');
 assert(linked.frame.contentDocument.querySelector('img').getBoundingClientRect().width > 100, 'Linked images use their containing block width');
 const multiple = await makeCard('<p>Before media.</p><span class="image-embed"><img src="' + image.src + '"></span><span class="image-embed"><img src="' + image.src + '"></span><p>After media.</p>');
 assert(multiple.frame.dataset.overflow === 'false' && font(multiple.frame) === 16, 'Multiple images share available space without shrinking text');
 await change('Slide 5 font size', 160);
 assert(pdfFrame.dataset.overflow === 'false' && font(pdfFrame) === 25.6, 'Media fits remaining space while text size stays fixed');
 assert(pdfFrame === frames()[4], 'Font changes preserve iframe identity');

 const renderedNote = (note, count) => view.contentEl.querySelector('.social-converter__filename')?.textContent === note.basename && frames().length === count && view.contentEl.querySelector('.social-converter__zip');
 openFile(other); await waitUntil(() => renderedNote(other, 1));
 assert(view.getState().file === other.path && frames()[0].contentDocument.body.textContent.includes('Other note'), 'Converter follows the active Markdown note');
 await change('Slide 1 font size', 150);
 openFile(file); await waitUntil(() => renderedNote(file, 7));
 assert(font(frames()[4]) === 25.6 && font(frames()[0]) === 16, 'Returning to a note restores its own slide font sizes');
 sources.set(file, 'Edited note'); vaultEvents.emit('modify', file);
 await waitUntil(() => renderedNote(file, 1));
 assert(frames()[0].contentDocument.body.textContent.includes('Edited note'), 'Edits refresh the current note');
 sources.set(file, originalSource);
 let releaseRead; readDelays.set(other, new Promise((resolve) => { releaseRead = resolve; }));
 openFile(other); openFile(third); await waitUntil(() => renderedNote(third, 1));
 releaseRead(); readDelays.delete(other); await wait();
 assert(view.getState().file === third.path && frames()[0].contentDocument.body.textContent.includes('Third note'), 'Late reads cannot replace the latest active note');
 openFile(other); await waitUntil(() => renderedNote(other, 1));
 assert(font(frames()[0]) === 24, 'Each note retains its own font override');
 const workspaceState = view.getState();
 const followRestored = new SocialConverterView({ app }, plugin);
 await followRestored.setState({ ...workspaceState, file: file.path, slideFontScales: { 4: 160 } }, { history: false });
 assert(followRestored.getState().file === other.path && font(followRestored.contentEl.querySelector('iframe')) === 24, 'Restored converter follows the active note instead of a stale saved file');
 followRestored.unload(); followRestored.contentEl.remove();
 openFile(pdf); await wait();
 assert(view.getState().file === other.path, 'Opening a PDF keeps the last Markdown note');
 openFile(file); await waitUntil(() => renderedNote(file, 7));
 view.contentEl.style.cssText = 'position:fixed;left:20px;top:20px;width:540px;height:600px;overflow:auto;background:white;z-index:1000;';
 const fifthInput = field('Slide 5 font size');
 fifthInput.scrollIntoView({ block: 'center' }); await wait();
 fifthInput.focus({ preventScroll: true }); fifthInput.value = '140';
 window.__interactionFixture = { view, input: fifthInput, frame: frames()[4], beforeTop: view.contentEl.scrollTop, font };
 window.__regressionResults = { results };
}
run().catch((error) => { window.__regressionResults = { results, error: error.stack || String(error) }; });
