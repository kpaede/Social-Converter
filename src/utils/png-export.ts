import { Notice, requestUrl } from 'obsidian';
import { toBlob } from 'html-to-image';
import { zipSync } from 'fflate';

export async function exportCardAsPng(source: HTMLElement, width: number, height: number, filename: string): Promise<void> {
	try {
		const png = await renderCardToPng(source, width, height);
		downloadBlob(png, filename);
		new Notice('PNG saved');
	} catch (error) {
		console.error('Social Converter PNG export failed', error);
		new Notice('PNG export failed. See the developer console for details.');
	}
}

export async function renderCardToPng(source: HTMLElement, width: number, height: number): Promise<Blob> {
	const restoredSources = await inlineImages(source);
	const snapshot = createExportSnapshot(source);
	try {
		await source.ownerDocument.fonts.ready;
		if (source.instanceOf(HTMLIFrameElement)) await source.contentDocument?.fonts.ready;
		const png = await toBlob(snapshot.node, {
			backgroundColor: getComputedStyle(snapshot.node).backgroundColor,
			canvasWidth: width,
			canvasHeight: height,
			cacheBust: true,
			includeQueryParams: true,
			pixelRatio: 1,
			fontEmbedCSS: snapshot.fontCss,
		});
		if (!png) throw new Error('PNG creation returned no data');
		return png;
	} finally {
		snapshot.cleanup();
		for (const restore of restoredSources) restore();
	}
}

interface ExportSnapshot {
	node: HTMLElement;
	fontCss: string;
	cleanup(): void;
}

function createExportSnapshot(source: HTMLElement): ExportSnapshot {
	if (!source.instanceOf(HTMLIFrameElement) || !source.contentDocument?.body) {
		return { node: source, fontCss: '', cleanup: () => undefined };
	}
	const frameDocument = source.contentDocument;
	const original = frameDocument.querySelector<HTMLElement>('.social-converter-card-capture') ?? frameDocument.body;
	const clone = original.cloneNode(true) as HTMLElement;
	freezeComputedStyles(original, clone, frameDocument.defaultView ?? window);
	const bounds = source.getBoundingClientRect();
	clone.style.setProperty('width', `${bounds.width}px`, 'important');
	clone.style.setProperty('height', `${bounds.height}px`, 'important');
	const mount = activeDocument.body.createDiv({ cls: 'social-converter__export-snapshot' });
	mount.appendChild(clone);
	return {
		node: clone,
		fontCss: collectFontFaces(frameDocument),
		cleanup: () => mount.remove(),
	};
}

function freezeComputedStyles(source: Element, target: Element, view: Window): void {
	const computed = view.getComputedStyle(source);
	const targetElement = target as HTMLElement;
	for (const property of Array.from(computed)) {
		targetElement.style.setProperty(property, computed.getPropertyValue(property), 'important');
	}
	target.removeAttribute('class');
	target.removeAttribute('id');
	const sourceChildren = Array.from(source.children);
	const targetChildren = Array.from(target.children);
	for (let index = 0; index < sourceChildren.length; index += 1) {
		const sourceChild = sourceChildren[index];
		const targetChild = targetChildren[index];
		if (sourceChild && targetChild) freezeComputedStyles(sourceChild, targetChild, view);
	}
}

function collectFontFaces(doc: Document): string {
	const rules: string[] = [];
	for (const sheet of Array.from(doc.styleSheets)) {
		try {
			for (const rule of Array.from(sheet.cssRules)) {
				if (rule.cssText.trimStart().startsWith('@font-face')) rules.push(rule.cssText);
			}
		} catch (error) {
			console.warn('Social Converter could not inspect a font stylesheet', error);
		}
	}
	return rules.join('\n');
}

export async function exportPngZip(files: Array<{ filename: string; png: Blob }>, filename: string): Promise<void> {
	const entries: Record<string, Uint8Array> = {};
	for (const file of files) entries[file.filename] = new Uint8Array(await file.png.arrayBuffer());
	const zip = zipSync(entries, { level: 6 });
	downloadBlob(new Blob([zip.buffer], { type: 'application/zip' }), filename);
}

async function inlineImages(root: HTMLElement): Promise<Array<() => void>> {
	const images = Array.from(root.querySelectorAll('img'));
	if (root.instanceOf(HTMLIFrameElement) && root.contentDocument) {
		images.push(...Array.from(root.contentDocument.querySelectorAll('img')));
	}
	return Promise.all(images.map(async (image) => {
		const original = image.getAttribute('src');
		const source = image.currentSrc || image.src;
		if (!source || source.startsWith('data:')) return () => undefined;
		try {
			image.src = await loadAsDataUrl(source);
			await image.decode().catch(() => undefined);
			return () => original === null ? image.removeAttribute('src') : image.setAttribute('src', original);
		} catch (error) {
			console.warn(`Social Converter could not inline image: ${source}`, error);
			return () => undefined;
		}
	}));
}

async function loadAsDataUrl(url: string): Promise<string> {
	const response = await requestUrl({ url });
	const contentType = response.headers['content-type']?.split(';')[0] || 'image/png';
	return arrayBufferToDataUrl(response.arrayBuffer, contentType);
}

function arrayBufferToDataUrl(buffer: ArrayBuffer, contentType: string): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return `data:${contentType};base64,${btoa(binary)}`;
}

function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = activeDocument.body.createEl('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.addClass('social-converter__download');
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
