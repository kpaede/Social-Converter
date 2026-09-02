import { ItemView, loadPdfJs, MarkdownRenderer, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { createBlueskyThread, extractInstagramBlocks } from '../utils/content';
import { exportCardAsPng, exportPngZip, renderCardToPng } from '../utils/png-export';
import type SocialConverterPlugin from '../main';

export const VIEW_TYPE_SOCIAL_CONVERTER = 'social-converter-view';
type Platform = 'bluesky' | 'instagram';
type CardFormat = 'post' | 'story';
type ColorMode = 'light' | 'dark';
interface ThemeManager {
	theme: string;
	themes: Record<string, { name?: string }>;
}
interface PdfViewport { width: number; height: number; }
interface PdfPage {
	getViewport(options: { scale: number }): PdfViewport;
	render(options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void> };
}
interface PdfDocument {
	numPages: number;
	getPage(page: number): Promise<PdfPage>;
	destroy(): Promise<void>;
}
interface PdfJsApi {
	getDocument(options: { data: Uint8Array }): { promise: Promise<PdfDocument> };
}

export class SocialConverterView extends ItemView {
	private file: TFile | null = null;
	private source = '';
	private platform: Platform = 'bluesky';
	private format: CardFormat = 'post';
	private colorMode: ColorMode = activeDocument.body.hasClass('theme-dark') ? 'dark' : 'light';
	private selectedTheme = '';
	private readonly themeCssCache = new Map<string, string>();
	private readonly pdfPreviewCache = new Map<string, string>();

	constructor(leaf: WorkspaceLeaf, private readonly plugin: SocialConverterPlugin) { super(leaf); }
	getViewType(): string { return VIEW_TYPE_SOCIAL_CONVERTER; }
	getDisplayText(): string { return 'Social converter'; }
	getIcon(): string { return 'share-2'; }

	async setState(state: { file?: string }, result: { history: boolean }): Promise<void> {
		await super.setState(state, result);
		const candidate = state.file ? this.app.vault.getAbstractFileByPath(state.file) : null;
		this.file = candidate instanceof TFile ? candidate : null;
		await this.refreshSource();
	}

	async onOpen(): Promise<void> {
		this.registerEvent(this.app.vault.on('modify', (file) => { if (file === this.file) void this.refreshSource(); }));
		await this.refreshSource();
	}

	async refresh(): Promise<void> { await this.renderView(); }

	private async refreshSource(): Promise<void> {
		if (this.file) this.source = await this.app.vault.cachedRead(this.file);
		await this.renderView();
	}

	private async renderView(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('social-converter');
		if (!this.file) {
			root.createDiv({ cls: 'social-converter__empty', text: 'Open a Markdown note, then open Social Converter.' });
			return;
		}
		const header = root.createDiv({ cls: 'social-converter__header' });
		const title = header.createDiv();
		title.createEl('h2', { text: 'Social converter' });
		title.createDiv({ cls: 'social-converter__filename', text: this.file.basename });
		const tabs = header.createDiv({ cls: 'social-converter__tabs' });
		this.addTab(tabs, 'bluesky', 'Bluesky');
		this.addTab(tabs, 'instagram', 'Instagram');
		const content = root.createDiv({ cls: 'social-converter__content' });
		if (this.platform === 'bluesky') this.renderBluesky(content);
		else await this.renderInstagram(content);
	}

	private addTab(container: HTMLElement, platform: Platform, label: string): void {
		const button = container.createEl('button', { cls: 'social-converter__tab', text: label });
		button.toggleClass('is-active', platform === this.platform);
		button.addEventListener('click', () => { this.platform = platform; void this.renderView(); });
	}

	private renderBluesky(container: HTMLElement): void {
		const { blueskyMaxLength, blueskySeparator } = this.plugin.settings;
		const fragments = createBlueskyThread(this.source, blueskyMaxLength, blueskySeparator);
		const intro = container.createDiv({ cls: 'social-converter__intro' });
		intro.createEl('h3', { text: `Thread · ${fragments.length} ${fragments.length === 1 ? 'post' : 'posts'}` });
		intro.createEl('p', { text: `Each post stays within ${blueskyMaxLength} characters, including its number.` });
		if (!fragments.length) {
			container.createDiv({ cls: 'social-converter__empty', text: 'This note contains no shareable text.' });
			return;
		}
		const list = container.createDiv({ cls: 'social-converter__fragments' });
		for (const [index, fragment] of fragments.entries()) {
			const card = list.createDiv({ cls: 'social-converter__fragment' });
			const meta = card.createDiv({ cls: 'social-converter__fragment-meta' });
			meta.createSpan({ text: `Post ${index + 1}` });
			meta.createSpan({ text: `${fragment.length}/${blueskyMaxLength}` });
			card.createEl('p', { text: fragment });
			const copy = card.createEl('button', { text: 'Copy' });
			copy.addEventListener('click', () => { void this.copyFragment(fragment, index); });
		}
	}

	private async renderInstagram(container: HTMLElement): Promise<void> {
		const blocks = extractInstagramBlocks(this.source);
		const intro = container.createDiv({ cls: 'social-converter__intro' });
		intro.createEl('h3', { text: `Instagram · ${blocks.length} ${blocks.length === 1 ? 'card' : 'cards'}` });
		intro.createEl('p', { text: 'Slides are separated by --- on its own line, with an empty line before and after.' });
		const switcher = intro.createDiv({ cls: 'social-converter__format-switcher' });
		for (const key of ['post', 'story'] as CardFormat[]) {
			const format = this.getFormat(key);
			const button = switcher.createEl('button', { text: format.label });
			button.toggleClass('is-active', key === this.format);
			button.addEventListener('click', () => { this.format = key; void this.renderView(); });
		}
		const appearance = intro.createDiv({ cls: 'social-converter__appearance' });
		const themeSelect = appearance.createEl('select', { attr: { 'aria-label': 'Preview theme' } });
		themeSelect.createEl('option', { text: 'Current theme', value: '' });
		for (const [id, name] of this.getInstalledThemes()) themeSelect.createEl('option', { text: name, value: id });
		themeSelect.value = this.selectedTheme;
		themeSelect.addEventListener('change', () => { this.selectedTheme = themeSelect.value; void this.renderView(); });
		const modeSwitcher = appearance.createDiv({ cls: 'social-converter__mode-switcher' });
		for (const mode of ['light', 'dark'] as ColorMode[]) {
			const button = modeSwitcher.createEl('button', { text: mode[0]?.toUpperCase() + mode.slice(1) });
			button.toggleClass('is-active', mode === this.colorMode);
			button.addEventListener('click', () => { this.colorMode = mode; void this.renderView(); });
		}
		if (!blocks.length) {
			container.createDiv({ cls: 'social-converter__empty', text: 'This note contains no slide content.' });
			return;
		}
		const gallery = container.createDiv({ cls: 'social-converter__gallery' });
		const renderedCards: HTMLElement[] = [];
		for (const [index, block] of blocks.entries()) {
			const item = gallery.createDiv({ cls: 'social-converter__gallery-item' });
			const density = this.getTextDensity(block.content);
			const card = item.createDiv({ cls: `social-converter__image social-converter__image--${this.format}` });
			const format = this.getFormat(this.format);
			const dimensions: Record<string, string> = { 'aspect-ratio': `${format.width} / ${format.height}` };
			card.setCssProps(dimensions);
			const staging = item.createDiv({ cls: 'social-converter__staging' });
			await MarkdownRenderer.render(this.app, block.content, staging, this.file?.path ?? '', this);
			await this.replacePdfEmbeds(staging);
			const capture = await this.createIsolatedCard(card, staging, density);
			staging.remove();
			renderedCards.push(capture);
			if (block.content.length > 700) {
				item.createDiv({ cls: 'social-converter__warning', text: 'This card contains a lot of text. Consider splitting it into another card.' });
			}
			const actions = item.createDiv({ cls: 'social-converter__image-actions' });
			const exportButton = actions.createEl('button', { text: 'Save image' });
			exportButton.addEventListener('click', () => {
				void this.exportCard(capture, exportButton, format, index);
			});
			const copyButton = actions.createEl('button', { text: 'Copy image' });
			copyButton.addEventListener('click', () => { void this.copyImage(capture, copyButton, format); });
		}
		const zipButton = container.createEl('button', { cls: 'mod-cta social-converter__zip', text: `Save all ${this.format} cards as ZIP` });
		zipButton.addEventListener('click', () => { void this.exportAllCards(renderedCards, zipButton); });
	}

	private getTextDensity(content: string): 'short' | 'medium' | 'long' | 'dense' {
		const length = content.replace(/\s+/g, ' ').trim().length;
		if (length <= 140) return 'short';
		if (length <= 320) return 'medium';
		if (length <= 550) return 'long';
		return 'dense';
	}

	private async createIsolatedCard(card: HTMLElement, staging: HTMLElement, density: 'short' | 'medium' | 'long' | 'dense'): Promise<HTMLElement> {
		const frame = card.createEl('iframe', { cls: 'social-converter__theme-frame', attr: { title: 'Instagram card preview' } });
		const themeId = this.selectedTheme || this.getThemeManager()?.theme || '';
		const themeCss = themeId ? await this.readThemeCss(themeId) : null;
		const isolatedCss = `
			:root { ${this.getBaselineVariables()} }
			${themeCss ?? ''}
			html, body { box-sizing: border-box; width: 100%; height: 100%; margin: 0; overflow: hidden; background: var(--background-primary); color: var(--text-normal); }
			body { container-type: inline-size; }
			.social-converter-card-capture { box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; overflow: hidden; background: var(--background-primary); color: var(--text-normal); font-family: var(--font-text-theme, var(--font-text)); }
			.social-converter__image-content { box-sizing: border-box; width: 100%; max-height: 100%; overflow: hidden; padding: 10%; }
			.density-short .social-converter__image-content { font-size: clamp(24px, 7.2cqw, 48px); }
			.density-medium .social-converter__image-content { font-size: clamp(21px, 5.6cqw, 38px); }
			.density-long .social-converter__image-content { font-size: clamp(18px, 4.4cqw, 30px); }
			.density-dense .social-converter__image-content { font-size: clamp(15px, 3.5cqw, 24px); }
			.social-converter__image-content > :first-child { margin-top: 0; }
			.social-converter__image-content > :last-child { margin-bottom: 0; }
			.social-converter__image-content :is(.internal-embed, .image-embed, .media-embed, .file-embed) { box-sizing: border-box !important; display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; max-width: 100% !important; max-height: 52cqh !important; margin-inline: auto !important; overflow: hidden !important; font-size: clamp(12px, 2.6cqw, 18px) !important; }
			.social-converter__image-content :is(img, video, canvas) { display: block !important; width: auto !important; height: auto !important; max-width: 100% !important; max-height: 52cqh !important; margin-inline: auto !important; object-fit: contain !important; }
			.social-converter__image-content :is(svg) { max-width: 100% !important; max-height: 52cqh !important; }
			.social-converter__image-content :is(.pdf-embed, .media-embed):has(iframe),
			.social-converter__image-content iframe { display: block !important; width: 100% !important; min-width: 0 !important; height: 46cqh !important; max-height: 46cqh !important; border: 0 !important; }
			.social-converter__image-content :is(.markdown-embed, .internal-embed):not(.image-embed):not(.media-embed) { align-items: flex-start !important; justify-content: flex-start !important; overflow: auto !important; }
			.social-converter__image-content :is(.markdown-embed-content, .markdown-embed-content > .markdown-preview-view) { box-sizing: border-box !important; width: 100% !important; max-height: 48cqh !important; overflow: hidden !important; font-size: clamp(12px, 2.6cqw, 18px) !important; }
		`;
		const safeCss = isolatedCss.replace(/<\/style/gi, '<\\/style');
		const loaded = new Promise<void>((resolve) => {
			frame.addEventListener('load', () => resolve(), { once: true });
		});
		frame.setAttribute('srcdoc', `<!doctype html><html><head><meta charset="utf-8"><style>${safeCss}</style></head><body class="theme-${this.colorMode}"></body></html>`);
		await loaded;
		const frameDocument = frame.contentDocument;
		if (!frameDocument) throw new Error('Could not create isolated theme preview');
		const capture = frameDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div');
		capture.className = `social-converter-card-capture density-${density}`;
		const markdown = frameDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div');
		markdown.className = 'markdown-rendered markdown-preview-view social-converter__image-content';
		for (const child of Array.from(staging.childNodes)) markdown.appendChild(frameDocument.importNode(child, true));
		capture.appendChild(markdown);
		frameDocument.body.appendChild(capture);
		await frameDocument.fonts.ready;
		return frame;
	}

	private getBaselineVariables(): string {
		const style = getComputedStyle(activeDocument.body);
		return Array.from(style)
			.filter((property) => property.startsWith('--'))
			.map((property) => `${property}: ${style.getPropertyValue(property)};`)
			.join(' ');
	}

	private async replacePdfEmbeds(container: HTMLElement): Promise<void> {
		const candidates = Array.from(container.querySelectorAll<HTMLElement>('.internal-embed, .pdf-embed'));
		const embeds = candidates.filter((element) => {
			const reference = element.getAttribute('src') ?? element.getAttribute('data-href') ?? '';
			return /\.pdf(?:#|$)/i.test(reference) && !element.parentElement?.closest('.internal-embed[src*=".pdf" i]');
		});
		for (const embed of embeds) {
			const reference = embed.getAttribute('src') ?? embed.getAttribute('data-href') ?? '';
			try {
				const preview = await this.renderPdfPreview(reference);
				const image = activeDocument.createElementNS('http://www.w3.org/1999/xhtml', 'img');
				image.setAttribute('src', preview);
				image.setAttribute('alt', `PDF preview: ${reference}`);
				image.className = 'social-converter__pdf-page';
				embed.replaceWith(image);
			} catch (error) {
				console.error(`Social Converter could not render PDF: ${reference}`, error);
				const fallback = activeDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div');
				fallback.className = 'social-converter__pdf-fallback';
				fallback.textContent = `PDF: ${reference.split('#')[0] ?? reference}`;
				embed.replaceWith(fallback);
			}
		}
	}

	private async renderPdfPreview(reference: string): Promise<string> {
		const [linkPath = '', fragment = ''] = reference.split('#', 2);
		const pageNumber = Math.max(1, Number.parseInt(fragment.match(/(?:^|&)page=(\d+)/i)?.[1] ?? '1', 10));
		const sourcePath = this.file?.path ?? '';
		const pdfFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
		if (!(pdfFile instanceof TFile) || pdfFile.extension.toLowerCase() !== 'pdf') throw new Error(`PDF file not found: ${linkPath}`);
		const cacheKey = `${pdfFile.path}#page=${pageNumber}`;
		const cached = this.pdfPreviewCache.get(cacheKey);
		if (cached) return cached;

		const pdfJs = await loadPdfJs() as unknown as PdfJsApi;
		const bytes = new Uint8Array(await this.app.vault.readBinary(pdfFile));
		const loadingTask = pdfJs.getDocument({ data: bytes });
		const document = await loadingTask.promise;
		try {
			const page = await document.getPage(Math.min(pageNumber, document.numPages));
			const initial = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({ scale: Math.min(3, 1400 / initial.width) });
			const canvas = activeDocument.body.createEl('canvas', { cls: 'social-converter__pdf-render-canvas' });
			try {
				canvas.width = Math.ceil(viewport.width);
				canvas.height = Math.ceil(viewport.height);
				const context = canvas.getContext('2d');
				if (!context) throw new Error('Canvas is unavailable');
				await page.render({ canvas, canvasContext: context, viewport }).promise;
				const dataUrl = canvas.toDataURL('image/png');
				this.pdfPreviewCache.set(cacheKey, dataUrl);
				return dataUrl;
			} finally {
				canvas.remove();
			}
		} finally {
			await document.destroy();
		}
	}

	private async readThemeCss(themeId: string): Promise<string | null> {
		const cached = this.themeCssCache.get(themeId);
		if (cached !== undefined) return cached;
		const directory = `${this.app.vault.configDir}/themes/${themeId}`;
		try {
			let css = await this.app.vault.adapter.read(`${directory}/theme.css`);
			css = css.replace(/data:\s+(?=[\w.+-]+\/)/gi, 'data:');
			css = css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote: string, rawUrl: string) => {
				const resource = rawUrl.trim();
				if (/^(?:data:|https?:|app:|blob:|#)/i.test(resource)) return match;
				const normalized = resource.replace(/^\.\//, '');
				return `url("${this.app.vault.adapter.getResourcePath(`${directory}/${normalized}`)}")`;
			});
			this.themeCssCache.set(themeId, css);
			return css;
		} catch (error) {
			console.error(`Social Converter could not read theme: ${themeId}`, error);
			return null;
		}
	}


	private getThemeManager(): ThemeManager | null {
		const candidate = (this.app as unknown as { customCss?: ThemeManager }).customCss;
		return candidate?.themes ? candidate : null;
	}

	private getInstalledThemes(): Array<[string, string]> {
		const themes = this.getThemeManager()?.themes ?? {};
		return Object.entries(themes)
			.map(([id, manifest]): [string, string] => [id, manifest.name || id])
			.sort((a, b) => a[1].localeCompare(b[1]));
	}

	private getFormat(format: CardFormat): { width: number; height: number; label: string } {
		const settings = this.plugin.settings;
		const width = format === 'post' ? settings.postWidth : settings.storyWidth;
		const height = format === 'post' ? settings.postHeight : settings.storyHeight;
		const divisor = this.greatestCommonDivisor(width, height);
		const name = format === 'post' ? 'Post' : 'Story';
		return { width, height, label: `${name} · ${width / divisor}:${height / divisor}` };
	}

	private greatestCommonDivisor(first: number, second: number): number {
		let a = first;
		let b = second;
		while (b !== 0) [a, b] = [b, a % b];
		return a;
	}

	private async copyFragment(fragment: string, index: number): Promise<void> {
		await navigator.clipboard.writeText(fragment);
		new Notice(`Post ${index + 1} copied`);
	}

	private async exportCard(card: HTMLElement, button: HTMLButtonElement, format: { width: number; height: number }, index: number): Promise<void> {
		button.disabled = true;
		try {
			const basename = (this.file?.basename || 'social').replace(/[\\/:*?"<>|]/g, '-').trim() || 'social';
			await exportCardAsPng(card, format.width, format.height, `${basename}-${this.format}-${String(index + 1).padStart(2, '0')}.png`);
		} finally {
			button.disabled = false;
		}
	}

	private async copyImage(card: HTMLElement, button: HTMLButtonElement, format: { width: number; height: number }): Promise<void> {
		button.disabled = true;
		try {
			const png = await renderCardToPng(card, format.width, format.height);
			if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
				new Notice('Image clipboard is not available on this device.');
				return;
			}
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
			new Notice('Image copied');
		} catch (error) {
			console.error('Social Converter image copy failed', error);
			new Notice('Image copy failed. See the developer console for details.');
		} finally {
			button.disabled = false;
		}
	}

	private async exportAllCards(cards: HTMLElement[], button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		const originalText = button.textContent;
		try {
			const format = this.getFormat(this.format);
			const basename = this.getSafeBasename();
			const files: Array<{ filename: string; png: Blob }> = [];
			for (const [index, card] of cards.entries()) {
				button.setText(`Rendering ${index + 1} of ${cards.length}…`);
				files.push({
					filename: `${basename}-${this.format}-${String(index + 1).padStart(2, '0')}.png`,
					png: await renderCardToPng(card, format.width, format.height),
				});
			}
			await exportPngZip(files, `${basename}-${this.format}.zip`);
			new Notice(`${cards.length} PNGs saved as ZIP`);
		} catch (error) {
			console.error('Social Converter ZIP export failed', error);
			new Notice('Zip export failed. See the developer console for details.');
		} finally {
			button.disabled = false;
			button.setText(originalText);
		}
	}

	private getSafeBasename(): string {
		return (this.file?.basename || 'social').replace(/[\\/:*?"<>|]/g, '-').trim() || 'social';
	}
}
