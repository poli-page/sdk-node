import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
	entry: ['src/index.ts', 'src/node.ts'],
	format: ['esm', 'cjs'],
	// DTS is emitted by tsc (see `npm run build`) so we get `.d.ts.map`
	// declaration maps — tsup's rollup-based DTS bundler does not emit them.
	dts: false,
	clean: true,
	sourcemap: true,
	target: 'node20.18',
	platform: 'node',
	// Preserve `node:` prefix in imports/requires. tsup defaults to stripping it
	// via its built-in nodeProtocolPlugin; we want the modern, explicit form
	// in the emitted bundles to match the source.
	removeNodeProtocol: false,
	define: {
		__SDK_VERSION__: JSON.stringify(pkg.version),
	},
});
