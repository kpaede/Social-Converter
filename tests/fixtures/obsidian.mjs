export class Notice {}
export function requestUrl() { throw new Error('Unexpected network request'); }
export class PluginSettingTab {}
export class Setting {}
export class WorkspaceLeaf {}
export class TFile {
 constructor(path) { this.path = path; this.basename = path; this.extension = path.split('.').pop(); }
}
export class Component {
 constructor() { this.cleanups = []; this.children = []; }
 register(fn) { this.cleanups.push(fn); }
 registerEvent(reference) { this.register(() => reference.off()); }
 registerDomEvent(el, event, fn, options) {
  el.addEventListener(event, fn, options);
  this.register(() => el.removeEventListener(event, fn, options));
 }
 addChild(child) { this.children.push(child); return child; }
 removeChild(child) { child.unload(); this.children = this.children.filter((item) => item !== child); return child; }
 unload() { this.children.forEach((child) => child.unload()); this.cleanups.forEach((fn) => fn()); }
}
export class ItemView extends Component {
 constructor(leaf) { super(); this.app = leaf.app; this.contentEl = document.body.createDiv({ cls: 'test-view' }); }
 async setState() {}
 getState() { return {}; }
}
export const MarkdownRenderer = {
 async render(app, content, staging) {
  staging.innerHTML = content === 'PDF slide'
   ? '<p>Before the PDF.</p><span class="internal-embed pdf-embed" src="test.pdf"></span><p>After the PDF.</p>'
   : '<h1>Heading</h1><p>' + content + ' <strong>bold</strong></p>';
 },
};
export async function loadPdfJs() {
 return { getDocument: () => ({ promise: Promise.resolve({
  numPages: 1,
  getPage: async () => ({
   getViewport: ({ scale }) => ({ width: 800 * scale, height: 600 * scale }),
   render: ({ canvas, canvasContext: ctx }) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, canvas.width / 5, canvas.height / 5);
    ctx.fillStyle = '#00f'; ctx.fillRect(canvas.width * 0.8, canvas.height * 0.8, canvas.width / 5, canvas.height / 5);
    return { promise: Promise.resolve() };
   },
  }),
  destroy: async () => {},
 }) }) };
}
