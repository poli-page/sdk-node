import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ISOMORPHIC_SOURCES = [
	'../src/index.ts',
	'../src/internal/http.ts',
	'../src/types.ts',
	'../src/error.ts',
];

describe('main entry is isomorphic', () => {
	for (const relativePath of ISOMORPHIC_SOURCES) {
		it(`${relativePath} contains no \`node:*\` imports`, () => {
			const source = readFileSync(resolve(__dirname, relativePath), 'utf-8');
			expect(source).not.toMatch(/from\s+['"]node:/);
		});
	}
});
