import { App, PluginSettingTab, Setting } from 'obsidian';
import type SocialConverterPlugin from './main';

export interface SocialConverterSettings {
	postWidth: number;
	postHeight: number;
	storyWidth: number;
	storyHeight: number;
	blueskyMaxLength: number;
	blueskySeparator: string;
}

export const DEFAULT_SETTINGS: SocialConverterSettings = {
	postWidth: 1080,
	postHeight: 1350,
	storyWidth: 1080,
	storyHeight: 1920,
	blueskyMaxLength: 300,
	blueskySeparator: '/',
};

export class SocialConverterSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly socialPlugin: SocialConverterPlugin) { super(app, socialPlugin); }

	display(): void {
		this.containerEl.empty();
		new Setting(this.containerEl).setName('Instagram image sizes').setHeading();
		this.addNumber('Post width', 'PNG width in pixels.', 'postWidth', 1080);
		this.addNumber('Post height', 'PNG height in pixels.', 'postHeight', 1350);
		this.addNumber('Story width', 'PNG width in pixels.', 'storyWidth', 1080);
		this.addNumber('Story height', 'PNG height in pixels.', 'storyHeight', 1920);
		new Setting(this.containerEl).setName('Bluesky').setHeading();
		this.addNumber('Maximum post length', 'Includes the numbering suffix. Bluesky currently permits up to 300 characters.', 'blueskyMaxLength', 300, 20, 300);
		new Setting(this.containerEl)
			.setName('Number separator')
			.setDesc('Text placed before the post number, for example “/” produces “/1”.')
			.addText((text) => text
				.setValue(this.socialPlugin.settings.blueskySeparator)
				.onChange(async (value) => {
					this.socialPlugin.settings.blueskySeparator = value.trim() || '/';
					await this.socialPlugin.saveSettings();
				}));
	}

	private addNumber(name: string, description: string, key: 'postWidth' | 'postHeight' | 'storyWidth' | 'storyHeight' | 'blueskyMaxLength', fallback: number, min = 100, max = 5000): void {
		new Setting(this.containerEl).setName(name).setDesc(description).addText((text) => {
			text.inputEl.type = 'number';
			text.inputEl.min = String(min);
			text.inputEl.max = String(max);
			text.setValue(String(this.socialPlugin.settings[key])).onChange(async (value) => {
				const parsed = Number.parseInt(value, 10);
				this.socialPlugin.settings[key] = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
				await this.socialPlugin.saveSettings();
			});
		});
	}
}
