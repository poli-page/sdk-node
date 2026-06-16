import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
	define: {
		__SDK_VERSION__: JSON.stringify(pkg.version),
	},
	test: {
		include: ['tests/**/*.test.ts'],
		exclude: ['tests/integration/**'],
		globals: true,
		typecheck: {
			enabled: true,
			include: ['tests/**/*.test-d.ts'],
		},
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.d.ts'],
			reporter: ['text', 'lcov', 'json-summary'],
			reportsDirectory: './coverage',
		},
	},
});
