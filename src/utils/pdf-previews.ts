import { loadPdfJs, TFile, type App } from 'obsidian';

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

export class PdfPreviews {
	private readonly cache = new Map<string, string>();

	constructor(private readonly app: App) {}

	async replaceEmbeds(container: HTMLElement, sourcePath: string): Promise<void> {
		const candidates = Array.from(container.querySelectorAll<HTMLElement>('.internal-embed, .pdf-embed'));
		const embeds = candidates.filter((element) => {
			const reference = element.getAttribute('src') ?? element.getAttribute('data-href') ?? '';
			return /\.pdf(?:#|$)/i.test(reference) && !element.parentElement?.closest('.internal-embed[src*=".pdf" i]');
		});
		for (const embed of embeds) {
			const reference = embed.getAttribute('src') ?? embed.getAttribute('data-href') ?? '';
			try {
				const preview = await this.renderPdfPreview(reference, sourcePath);
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

	private async renderPdfPreview(reference: string, sourcePath: string): Promise<string> {
		const [linkPath = '', fragment = ''] = reference.split('#', 2);
		const pageNumber = Math.max(1, Number.parseInt(fragment.match(/(?:^|&)page=(\d+)/i)?.[1] ?? '1', 10));
		const pdfFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
		if (!(pdfFile instanceof TFile) || pdfFile.extension.toLowerCase() !== 'pdf') throw new Error(`PDF file not found: ${linkPath}`);
		const cacheKey = `${pdfFile.path}#page=${pageNumber}`;
		const cached = this.cache.get(cacheKey);
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
				this.cache.set(cacheKey, dataUrl);
				return dataUrl;
			} finally {
				canvas.remove();
			}
		} finally {
			await document.destroy();
		}
	}

}
