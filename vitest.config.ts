import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
	define: {
		__SDK_VERSION__: JSON.stringify(pkg.version),
	},
	test: {
		include: ['tests/**/*.test.ts'],
		globals: true,
		typecheck: {
			enabled: true,
			include: ['tests/**/*.test-d.ts'],
		},
	},
});
