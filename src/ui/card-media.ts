// Set both dimensions from the intrinsic ratio instead of combining a theme's
// fixed embed dimensions with independent max-width/max-height constraints.
export function fitCardImages(markdown: HTMLElement, capture: HTMLElement): void {
	const view = markdown.ownerDocument.defaultView;
	if (!view) return;
	const images = Array.from(markdown.querySelectorAll('img')).filter((image) => image.naturalWidth && image.naturalHeight);
	const sizes = images.map((image) => {
		let parent = image.parentElement ?? markdown;
		while (!parent.clientWidth && parent.parentElement && parent !== markdown) parent = parent.parentElement;
		const parentStyle = view.getComputedStyle(parent);
		const contentStyle = view.getComputedStyle(markdown);
		const contentWidth = markdown.clientWidth - Number.parseFloat(contentStyle.paddingLeft) - Number.parseFloat(contentStyle.paddingRight);
		const availableWidth = Math.min(contentWidth, parent.clientWidth - Number.parseFloat(parentStyle.paddingLeft) - Number.parseFloat(parentStyle.paddingRight));
		const requestedWidth = Number.parseFloat(image.getAttribute('width') ?? '');
		const ratio = image.naturalWidth / image.naturalHeight;
		const width = Math.max(1, Math.min(availableWidth, Number.isFinite(requestedWidth) && requestedWidth > 0 ? requestedWidth : availableWidth));
		const height = Math.min(width / ratio, capture.clientHeight * 0.52);
		return { image, width: height * ratio, height };
	});
	const apply = (factor: number) => {
		for (const { image, width, height } of sizes) {
			image.style.setProperty('width', `${width * factor}px`, 'important');
			image.style.setProperty('height', `${height * factor}px`, 'important');
		}
	};
	apply(1);
	const mediaHeight = sizes.reduce((sum, { height }) => sum + height, 0);
	const textHeight = markdown.getBoundingClientRect().height - mediaHeight;
	const availableHeight = capture.clientHeight - textHeight - 1;
	// Only media adapts to the remaining space. Text keeps the chosen font size.
	if (mediaHeight > availableHeight && availableHeight > 0) apply(availableHeight / mediaHeight);
}
