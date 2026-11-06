import { MAX_FONT_SCALE, MIN_FONT_SCALE, normalizeFontScale } from '../settings';

export interface FontSizeControl {
	container: HTMLElement;
	setValue(value: number): void;
}

export function addFontSizeControl(container: HTMLElement, label: string, value: number, onChange: (value: number) => void): FontSizeControl {
	const control = container.createDiv({ cls: 'social-converter__font-size' });
	const field = control.createEl('label');
	field.createSpan({ text: label });
	const input = field.createEl('input', { type: 'number', value: String(value), attr: {
		min: String(MIN_FONT_SCALE), max: String(MAX_FONT_SCALE), step: '5', 'aria-label': `${label} (%)`,
	} });
	field.createSpan({ text: '%' });
	let committed = value;
	const commit = () => {
		const scale = normalizeFontScale(input.valueAsNumber);
		input.value = String(scale);
		if (scale === committed) return;
		committed = scale;
		onChange(scale);
	};
	input.addEventListener('change', commit);
	input.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		event.stopPropagation();
		commit();
	});
	return { container: control, setValue: (scale) => { input.value = String(scale); committed = scale; } };
}
