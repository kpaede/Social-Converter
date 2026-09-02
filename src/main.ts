import { Plugin, TFile } from 'obsidian';
import { SocialConverterView, VIEW_TYPE_SOCIAL_CONVERTER } from './ui/social-converter-view';
import { DEFAULT_SETTINGS, SocialConverterSettings, SocialConverterSettingTab } from './settings';

export default class SocialConverterPlugin extends Plugin {
	settings: SocialConverterSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<SocialConverterSettings>);
		this.registerView(VIEW_TYPE_SOCIAL_CONVERTER, (leaf) => new SocialConverterView(leaf, this));
		this.addSettingTab(new SocialConverterSettingTab(this.app, this));
		this.addRibbonIcon('share-2', 'Open social converter', () => { void this.openConverter(); });
		this.addCommand({
			id: 'open-converter',
			name: 'Open converter',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!(file instanceof TFile) || file.extension !== 'md') return false;
				if (!checking) void this.openConverter(file);
				return true;
			},
		});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SOCIAL_CONVERTER)) {
			if (leaf.view instanceof SocialConverterView) void leaf.view.refresh();
		}
	}

	private async openConverter(file = this.app.workspace.getActiveFile()): Promise<void> {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SOCIAL_CONVERTER)[0];
		if (!leaf) leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_SOCIAL_CONVERTER, active: true, state: { file: file.path } });
		await this.app.workspace.revealLeaf(leaf);
	}
}
