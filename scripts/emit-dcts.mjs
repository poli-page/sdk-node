#!/usr/bin/env node
/**
 * Emit `.d.cts` / `.d.cts.map` siblings for every `.d.ts` / `.d.ts.map` file
 * produced by `tsc -p tsconfig.build.json` in `dist/`.
 *
 * Background:
 * - `tsup`'s built-in DTS bundler does not emit `.d.ts.map` declaration maps.
 * - We replaced it with `tsc --emitDeclarationOnly --declarationMap` which
 *   emits per-source `.d.ts` + `.d.ts.map`, but only the `.d.ts` flavour.
 * - For Node16-from-CJS type resolution (validated by `attw --profile node16`)
 *   we need `.d.cts` siblings as well. TypeScript's `nodenext` module
 *   resolution treats `import './types.js'` inside a `.d.cts` file as resolving
 *   to `./types.d.cts` first, so we just need a complete `.d.cts` mirror of
 *   the `.d.ts` tree — the contents are identical because `tsc` already wrote
 *   ESM-style relative imports with `.js` extensions, which resolve correctly
 *   in both `.d.ts` and `.d.cts` siblings.
 *
 * For each `.d.ts.map`, we also rewrite its `file` field from `*.d.ts` to
 * `*.d.cts` so the map's self-description matches its sibling.
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = new URL('../dist/', import.meta.url);

/** @param {URL} dir */
async function walk(dir) {
	/** @type {string[]} */
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
		if (entry.isDirectory()) {
			out.push(...(await walk(child)));
		} else {
			// fileURLToPath produces a proper Windows path (D:\...) — child.pathname
			// returns /D:/... which fs APIs misinterpret on Windows.
			out.push(fileURLToPath(child));
		}
	}
	return out;
}

const files = await walk(DIST);

let copied = 0;
for (const file of files) {
	if (file.endsWith('.d.ts')) {
		const cts = file.replace(/\.d\.ts$/, '.d.cts');
		const contents = await readFile(file, 'utf8');
		// Rewrite sourceMappingURL comment to point at the `.d.cts.map` sibling.
		const rewritten = contents.replace(
			/\/\/# sourceMappingURL=([^\s]+)\.d\.ts\.map\s*$/m,
			'//# sourceMappingURL=$1.d.cts.map',
		);
		await writeFile(cts, rewritten);
		copied += 1;
	} else if (file.endsWith('.d.ts.map')) {
		const ctsMap = file.replace(/\.d\.ts\.map$/, '.d.cts.map');
		const raw = await readFile(file, 'utf8');
		const json = JSON.parse(raw);
		if (typeof json.file === 'string') {
			json.file = json.file.replace(/\.d\.ts$/, '.d.cts');
		}
		await writeFile(ctsMap, JSON.stringify(json));
		copied += 1;
	}
}

console.log(`emit-dcts: wrote ${copied} files`);
