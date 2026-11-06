import { Component, ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { createBlueskyThread, extractInstagramBlocks } from '../utils/content';
import { exportCardAsPng, exportPngZip, renderCardToPng } from '../utils/png-export';
import { createCardPreview, setCardFontScale, type ColorMode } from './card-preview';
import { normalizeFontScale } from '../settings';
import { addFontSizeControl, type FontSizeControl } from './font-size-control';
import { PdfPreviews } from '../utils/pdf-previews';
import { ThemeStyles } from './theme-styles';
import type SocialConverterPlugin from '../main';

export const VIEW_TYPE_SOCIAL_CONVERTER = 'social-converter-view';
type Platform = 'bluesky' | 'instagram';
type CardFormat = 'post' | 'story';
interface ConverterState {
	file?: string;
	colorMode?: ColorMode;
	selectedTheme?: string;
	format?: CardFormat;
	platform?: Platform;
	slideFontScales?: Record<string, number>;
	noteFontScales?: Record<string, Record<string, number>>;
}
export class SocialConverterView extends ItemView {
	private file: TFile | null = null;
	private source = '';
	private sourceVersion = 0;
	private readonly noteFontScales = new Map<TFile, Record<string, number>>();
	private platform: Platform = 'bluesky';
	private format: CardFormat = 'post';
	private colorMode: ColorMode = activeDocument.body.hasClass('theme-dark') ? 'dark' : 'light';
	private selectedTheme = '';
	private slideFontScales: Record<string, number> = {};
	private renderComponent: Component | null = null;
	private renderVersion = 0;
	private layoutSettingsKey = '';
	private globalFontControl: FontSizeControl | null = null;
	private readonly cardPreviews = new Map<number, HTMLIFrameElement>();
	private readonly fontControls = new Map<number, { control: FontSizeControl; reset: HTMLButtonElement }>();
	private readonly themes: ThemeStyles;
	private readonly pdfPreviews: PdfPreviews;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: SocialConverterPlugin) {
		super(leaf);
		this.themes = new ThemeStyles(this.app);
		this.pdfPreviews = new PdfPreviews(this.app);
	}
	getViewType(): string { return VIEW_TYPE_SOCIAL_CONVERTER; }
	getDisplayText(): string { return 'Social converter'; }
	getIcon(): string { return 'share-2'; }

	async setState(state: ConverterState, result: { history: boolean }): Promise<void> {
		await super.setState(state, result);
		if (state.noteFontScales) {
			for (const [path, scales] of Object.entries(state.noteFontScales)) {
				const note = this.app.vault.getAbstractFileByPath(path);
				if (note instanceof TFile && note.extension === 'md') this.noteFontScales.set(note, this.normalizeSlideFontScales(scales));
			}
		}
		const savedFile = state.file ? this.app.vault.getAbstractFileByPath(state.file) : null;
		if (savedFile instanceof TFile && state.slideFontScales) this.noteFontScales.set(savedFile, this.normalizeSlideFontScales(state.slideFontScales));
		const activeFile = this.app.workspace.getActiveFile();
		const candidate = activeFile instanceof TFile && activeFile.extension === 'md' ? activeFile : savedFile;
		this.selectFile(candidate instanceof TFile && candidate.extension === 'md' ? candidate : null);
		if (state.colorMode === 'dark' || state.colorMode === 'light') this.colorMode = state.colorMode;
		if (typeof state.selectedTheme === 'string') this.selectedTheme = state.selectedTheme;
		if (state.format === 'post' || state.format === 'story') this.format = state.format;
		if (state.platform === 'instagram' || state.platform === 'bluesky') this.platform = state.platform;
		await this.refreshSource();
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), file: this.file?.path, colorMode: this.colorMode, selectedTheme: this.selectedTheme,
			format: this.format, platform: this.platform, slideFontScales: { ...this.slideFontScales },
			noteFontScales: Object.fromEntries(Array.from(this.noteFontScales, ([file, scales]) => [file.path, { ...scales }])) };
	}

	private normalizeSlideFontScales(scales: Record<string, number>): Record<string, number> {
		return Object.fromEntries(Object.entries(scales)
			.filter(([key, value]) => /^\d+$/.test(key) && typeof value === 'number')
			.map(([key, value]) => [key, normalizeFontScale(value)]));
	}

	private selectFile(file: TFile | null): void {
		if (file !== this.file) ++this.renderVersion;
		this.file = file;
		this.slideFontScales = file ? this.noteFontScales.get(file) ?? {} : {};
		if (file) this.noteFontScales.set(file, this.slideFontScales);
	}

	async onOpen(): Promise<void> {
		this.registerEvent(this.app.workspace.on('file-open', (file) => {
			if (!(file instanceof TFile) || file.extension !== 'md' || file === this.file) return;
			this.selectFile(file);
			void this.refreshSource();
		}));
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile instanceof TFile && activeFile.extension === 'md') this.selectFile(activeFile);
		this.registerEvent(this.app.vault.on('modify', (file) => { if (file === this.file) void this.refreshSource(); }));
		await this.refreshSource();
	}

	async refresh(): Promise<void> {
		if (this.platform === 'instagram' && this.layoutSettingsKey === this.getLayoutSettingsKey()) this.updateFontSizes();
		else await this.renderView();
	}

	private getLayoutSettingsKey(): string {
		return JSON.stringify({ ...this.plugin.settings, fontScale: undefined });
	}

	private updateFontSizes(): void {
		const globalScale = this.plugin.settings.fontScale;
		this.globalFontControl?.setValue(globalScale);
		for (const [index, frame] of this.cardPreviews) setCardFontScale(frame, this.slideFontScales[index] ?? globalScale);
		for (const [index, { control, reset }] of this.fontControls) {
			control.setValue(this.slideFontScales[index] ?? globalScale);
			reset.disabled = this.slideFontScales[index] === undefined;
		}
		this.app.workspace.requestSaveLayout();
	}

	private async refreshSource(): Promise<void> {
		const file = this.file;
		const version = ++this.sourceVersion;
		const source = file ? await this.app.vault.cachedRead(file) : '';
		if (file !== this.file || version !== this.sourceVersion) return;
		this.source = source;
		await this.renderView();
	}

	private async renderView(): Promise<void> {
		const version = ++this.renderVersion;
		this.layoutSettingsKey = this.getLayoutSettingsKey();
		this.cardPreviews.clear();
		this.fontControls.clear();
		this.globalFontControl = null;
		if (this.renderComponent) this.removeChild(this.renderComponent);
		const component = new Component();
		this.addChild(component);
		this.renderComponent = component;
		this.app.workspace.requestSaveLayout();
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
		else await this.renderInstagram(content, component, version);
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

	private async renderInstagram(container: HTMLElement, component: Component, version: number): Promise<void> {
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
		for (const [id, name] of this.themes.getInstalledThemes()) themeSelect.createEl('option', { text: name, value: id });
		themeSelect.value = this.selectedTheme;
		themeSelect.addEventListener('change', () => { this.selectedTheme = themeSelect.value; void this.renderView(); });
		const modeSwitcher = appearance.createDiv({ cls: 'social-converter__mode-switcher' });
		for (const mode of ['light', 'dark'] as ColorMode[]) {
			const button = modeSwitcher.createEl('button', { text: mode[0]?.toUpperCase() + mode.slice(1) });
			button.toggleClass('is-active', mode === this.colorMode);
			button.addEventListener('click', () => { this.colorMode = mode; void this.renderView(); });
		}
		this.globalFontControl = addFontSizeControl(intro, 'Global font size', this.plugin.settings.fontScale, (value) => {
			this.plugin.settings.fontScale = value;
			this.updateFontSizes();
			void this.plugin.saveSettings();
		});
		intro.createEl('p', { text: '100% uses the selected theme’s font sizes. Slides use the global size unless you override them. Text never resizes automatically.' });
		if (!blocks.length) {
			container.createDiv({ cls: 'social-converter__empty', text: 'This note contains no slide content.' });
			return;
		}
		const gallery = container.createDiv({ cls: 'social-converter__gallery' });
		const renderedCards: HTMLElement[] = [];
		for (const [index, block] of blocks.entries()) {
			const item = gallery.createDiv({ cls: 'social-converter__gallery-item' });
			const sizeControl = addFontSizeControl(item, `Slide ${index + 1} font size`, this.slideFontScales[index] ?? this.plugin.settings.fontScale, (value) => {
				this.slideFontScales[index] = value;
				this.updateFontSizes();
			});
			const reset = sizeControl.container.createEl('button', { text: 'Use global size' });
			reset.disabled = this.slideFontScales[index] === undefined;
			reset.addEventListener('click', () => { delete this.slideFontScales[index]; this.updateFontSizes(); });
			this.fontControls.set(index, { control: sizeControl, reset });
			const card = item.createDiv({ cls: `social-converter__image social-converter__image--${this.format}` });
			const format = this.getFormat(this.format);
			const dimensions: Record<string, string> = { 'aspect-ratio': `${format.width} / ${format.height}` };
			card.setCssProps(dimensions);
			const staging = item.createDiv({ cls: 'social-converter__staging' });
			await MarkdownRenderer.render(this.app, block.content, staging, this.file?.path ?? '', component);
			if (version !== this.renderVersion) return;
			await this.pdfPreviews.replaceEmbeds(staging, this.file?.path ?? '');
			if (version !== this.renderVersion) return;
			const themeId = this.selectedTheme || this.themes.currentTheme;
			const themeCss = themeId ? await this.themes.read(themeId) : '';
			if (version !== this.renderVersion) return;
			const capture = await createCardPreview(card, staging, {
				...format, colorMode: this.colorMode, themeCss: themeCss ?? '',
				fontScale: this.slideFontScales[index] ?? this.plugin.settings.fontScale,
				component, isCurrent: () => version === this.renderVersion,
			});
			if (version !== this.renderVersion) return;
			staging.remove();
			renderedCards.push(capture);
			this.cardPreviews.set(index, capture);
			setCardFontScale(capture, this.slideFontScales[index] ?? this.plugin.settings.fontScale);
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
