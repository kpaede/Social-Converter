import type { App } from 'obsidian';

interface ThemeManager {
	theme: string;
	themes: Record<string, { name?: string }>;
}
export class ThemeStyles {
	private readonly cache = new Map<string, string>();

	constructor(private readonly app: App) {}

	get currentTheme(): string { return this.getThemeManager()?.theme ?? ''; }

	async read(themeId: string): Promise<string | null> {
		const cached = this.cache.get(themeId);
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
			this.cache.set(themeId, css);
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

	getInstalledThemes(): Array<[string, string]> {
		const themes = this.getThemeManager()?.themes ?? {};
		return Object.entries(themes)
			.map(([id, manifest]): [string, string] => [id, manifest.name || id])
			.sort((a, b) => a[1].localeCompare(b[1]));
	}

}
