import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
	},
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.js', 'vitest.config.ts', 'tests/*.ts'],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/consistent-type-imports': 'error',
			'@typescript-eslint/no-floating-promises': 'error',
		},
	},
	{
		files: ['tests/**/*.ts'],
		rules: {
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			// vitest's vi.spyOn() / matcher patterns extract methods; false positives without this.
			'@typescript-eslint/unbound-method': 'off',
		},
	},
);
