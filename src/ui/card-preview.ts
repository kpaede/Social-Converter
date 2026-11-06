import type { Component } from 'obsidian';
import { fitCardImages } from './card-media';

export type ColorMode = 'light' | 'dark';
export const CARD_LAYOUT_WIDTH = 480;

const fontSizeUpdaters = new WeakMap<HTMLIFrameElement, (scale: number) => void>();

export function setCardFontScale(frame: HTMLIFrameElement, scale: number): void {
	fontSizeUpdaters.get(frame)?.(scale);
}

interface CardPreviewOptions {
	width: number;
	height: number;
	colorMode: ColorMode;
	themeCss: string;
	fontScale: number;
	component: Component;
	isCurrent(): boolean;
}

// Re-evaluate Obsidian's original CSS in the chosen mode. Copying computed
// variables from the host would bake its current light/dark palette into cards.
async function installBaseStyles(source: Document, target: Document): Promise<void> {
	const links = Array.from(source.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
		.filter((link) => /(?:^|\/)app\.css(?:[?#]|$)/i.test(link.href));
	if (links.length) {
		await Promise.all(links.map((original) => new Promise<void>((resolve, reject) => {
			const link = target.createElement('link');
			link.rel = 'stylesheet';
			link.href = original.href;
			link.onload = () => resolve();
			link.onerror = () => reject(new Error('Could not load Obsidian preview styles'));
			target.head.appendChild(link);
		})));
		return;
	}
	// Some Obsidian environments embed the app stylesheet instead of linking it.
	for (const sheet of Array.from(source.styleSheets)) {
		try {
			const css = Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n');
			if (css.includes('.workspace-root') && css.includes('.theme-dark')) {
				const style = target.createElement('style');
				style.textContent = css;
				target.head.appendChild(style);
				return;
			}
		} catch { /* Unrelated third-party stylesheets may be inaccessible. */ }
	}
	throw new Error('Could not find Obsidian preview styles');
}

export async function createCardPreview(card: HTMLElement, staging: HTMLElement, options: CardPreviewOptions): Promise<HTMLIFrameElement> {
	const { colorMode, component } = options;
	const layoutHeight = CARD_LAYOUT_WIDTH * options.height / options.width;
	const frame = card.createEl('iframe', { cls: 'social-converter__theme-frame', attr: { title: 'Instagram card preview', tabindex: '-1' } });
	frame.setCssProps({ width: `${CARD_LAYOUT_WIDTH}px`, height: `${layoutHeight}px` });
	const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
	frame.srcdoc = `<!doctype html><html class="theme-${colorMode}"><head><meta charset="utf-8"></head><body class="theme-${colorMode}"></body></html>`;
	await loaded;
	const doc = frame.contentDocument;
	if (!doc) throw new Error('Could not create isolated theme preview');
	await installBaseStyles(card.ownerDocument, doc);
	const style = doc.createElement('style');
	style.textContent = `${options.themeCss}\n${CARD_CSS}`;
	doc.head.appendChild(style);
	doc.documentElement.style.setProperty('color-scheme', colorMode);
	// Preserve platform selectors without importing either host theme class.
	for (const name of Array.from(card.ownerDocument.body.classList)) {
		if (/^(?:is-|mod-)/.test(name)) doc.body.classList.add(name);
	}
	const capture = doc.createElement('div');
	capture.className = 'social-converter-card-capture';
	const markdown = doc.createElement('div');
	markdown.className = 'markdown-rendered markdown-preview-view social-converter__image-content';
	for (const child of Array.from(staging.childNodes)) markdown.appendChild(doc.importNode(child, true));
	capture.appendChild(markdown);
	doc.body.appendChild(capture);
	await doc.fonts.ready;
	// Read every original size before applying any changes, so inherited sizes
	// and px/rem headings all receive exactly one copy of the same multiplier.
	if (!options.isCurrent()) return frame;
	const view = doc.defaultView;
	const sizes = view ? [markdown, ...Array.from(markdown.querySelectorAll<HTMLElement>('*'))]
		.map((element) => ({ element, size: Number.parseFloat(view.getComputedStyle(element).fontSize) })) : [];
	const resize = () => frame.setCssProps({ transform: `scale(${card.clientWidth / CARD_LAYOUT_WIDTH})` });
	const observer = new ResizeObserver(resize);
	observer.observe(card);
	component.register(() => observer.disconnect());
	resize();
	const warning = card.parentElement?.createDiv({
		cls: 'social-converter__warning',
		text: 'Content exceeds this slide. Reduce its font size or split it into another slide before exporting.',
	});
	const checkOverflow = () => {
		if (!options.isCurrent()) return;
		const bounds = markdown.getBoundingClientRect();
		const captureBounds = capture.getBoundingClientRect();
		let overflows = markdown.scrollWidth > markdown.clientWidth + 1 || bounds.height > captureBounds.height + 1;
		for (const element of Array.from(markdown.querySelectorAll<HTMLElement>('*'))) {
			const childBounds = element.getBoundingClientRect();
			if (childBounds.bottom > captureBounds.bottom + 1 || childBounds.right > captureBounds.right + 1) overflows = true;
			if (element.clientHeight && element.scrollHeight > element.clientHeight + 1 && view?.getComputedStyle(element).overflowY === 'hidden') overflows = true;
		}
		if (warning) warning.hidden = !overflows;
		frame.dataset.overflow = String(overflows);
	};
	const updateMedia = () => { fitCardImages(markdown, capture); checkOverflow(); };
	fontSizeUpdaters.set(frame, (scale) => {
		for (const { element, size } of sizes) {
			if (Number.isFinite(size)) element.style.setProperty('font-size', `${size * scale / 100}px`, 'important');
		}
		updateMedia();
	});
	component.register(() => fontSizeUpdaters.delete(frame));
	component.registerDomEvent(doc, 'load', updateMedia, true);
	await Promise.all(Array.from(markdown.querySelectorAll('img')).map((image) => image.decode().catch(() => undefined)));
	if (!options.isCurrent()) return frame;
	setCardFontScale(frame, options.fontScale);
	const contentObserver = new ResizeObserver(checkOverflow);
	contentObserver.observe(markdown);
	component.register(() => contentObserver.disconnect());
	checkOverflow();
	return frame;
}

const CARD_CSS = `
	html, body { box-sizing: border-box; width: 100%; height: 100%; min-height: 0; margin: 0; padding: 0; overflow: hidden; background: var(--background-primary); color: var(--text-normal); }
	body { container-type: size; }
	.social-converter-card-capture { box-sizing: border-box; display: flex; align-items: safe center; justify-content: center; width: 100%; height: 100%; overflow: hidden; background: var(--background-primary); color: var(--text-normal); font-family: var(--font-text); }
	.social-converter__image-content.markdown-preview-view { box-sizing: border-box; flex: none; width: 100%; height: auto; min-height: 0; max-height: none; padding: 10%; overflow: visible; scrollbar-gutter: auto; overflow-wrap: anywhere; }
	.social-converter__image-content > :first-child { margin-top: 0; }
	.social-converter__image-content > :last-child { margin-bottom: 0; }
	.social-converter__image-content :is(.internal-embed, .image-embed, .media-embed, .file-embed) { box-sizing: border-box !important; display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; max-width: 100% !important; height: auto !important; min-width: 0 !important; min-height: 0 !important; max-height: none !important; margin-inline: auto !important; overflow: visible !important; }
	.social-converter__image-content img { display: block !important; min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important; margin-inline: auto !important; object-fit: contain !important; object-position: center !important; aspect-ratio: auto !important; clip-path: none !important; }
	.social-converter__image-content :is(video, canvas) { display: block !important; width: auto !important; height: auto !important; max-width: 100% !important; max-height: 52cqh !important; margin-inline: auto !important; object-fit: contain !important; }
	.social-converter__image-content svg { max-width: 100% !important; max-height: 52cqh !important; }
	.social-converter__image-content :is(.pdf-embed, .media-embed):has(iframe), .social-converter__image-content iframe { display: block !important; width: 100% !important; min-width: 0 !important; height: 46cqh !important; max-height: 46cqh !important; border: 0 !important; }
	.social-converter__image-content :is(.markdown-embed, .internal-embed):not(.image-embed):not(.media-embed) { align-items: flex-start !important; justify-content: flex-start !important; overflow: visible !important; max-height: none !important; }
	.social-converter__image-content :is(.markdown-embed-content, .markdown-embed-content > .markdown-preview-view) { box-sizing: border-box !important; width: 100% !important; height: auto !important; max-height: none !important; overflow: visible !important; }
`;
