import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		...tseslint.configs.disableTypeChecked,
		files: ['tests/**/*.mjs'],
		// Standalone Node runner and trusted DOM fixtures, outside the plugin runtime.
		rules: {
			...tseslint.configs.disableTypeChecked.rules,
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/prefer-window-timers': 'off',
			'obsidianmd/no-static-styles-assignment': 'off',
			'obsidianmd/rule-custom-message': 'off',
			'no-unsanitized/property': 'off',
			'@microsoft/sdl/no-inner-html': 'off',
		},
	},
);
