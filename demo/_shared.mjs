/**
 * Shared helpers for the @poli-page/sdk Node demos.
 *
 * Loaded by:
 *   - esm-demo.mjs via static `import` (straightforward Node ESM).
 *   - cjs-demo.cjs via dynamic `await import('./_shared.mjs')` from inside
 *     its async IIFE. CommonJS can't statically import ESM, but it can
 *     dynamically import it as long as the call site is inside an async
 *     function — which our IIFE provides.
 *
 * Authored as ESM because:
 *   - the package.json sets `"type": "module"`, so .mjs is the natural fit;
 *   - keeping the helper as ESM avoids the named-imports-from-CJS pitfalls
 *     that Node's interop heuristics sometimes get wrong.
 */

import { resolve } from 'node:path';
import * as readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// ANSI colors (no dependency)
// ─────────────────────────────────────────────────────────────────────────────

// Disable colors when stdout isn't a TTY (e.g. piped to a file) and respect
// the conventional NO_COLOR env var. `pnpm demo > log.txt` stays clean.
export const useColor = process.stdout.isTTY && process.env.NO_COLOR !== '1';

const ansi = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
	bold: ansi('1'),
	dim: ansi('2'),
	red: ansi('31'),
	green: ansi('32'),
	yellow: ansi('33'),
	cyan: ansi('36'),
};

/** Print a numbered section banner: `[2/6] preview() — ...` in bold cyan. */
export const step = (n, total, name) =>
	console.log('\n' + c.cyan(c.bold(`[${n}/${total}] ${name}`)));

/**
 * Format a path as a clickable `file://` URL. Modern terminals (macOS
 * Terminal, iTerm2, VS Code, Warp, Windows Terminal) recognize these and
 * let the user open the file with cmd-click / ctrl-click.
 */
export const fileLink = (relPath) => c.cyan(pathToFileURL(resolve(relPath)).href);

// ─────────────────────────────────────────────────────────────────────────────
// API key prompt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read POLI_PAGE_API_KEY from the environment, or prompt the user with
 * detailed instructions on where to find/create one. Returns the key as
 * a string. Exits the process with a friendly error if the user pastes
 * something that doesn't start with `pp_test_`.
 */
export async function getApiKey() {
	if (process.env.POLI_PAGE_API_KEY) return process.env.POLI_PAGE_API_KEY;

	const rule = c.dim('  ─────────────────────────────────────────────────────────────────────');
	console.log('');
	console.log(rule);
	console.log(c.bold(c.yellow('   No POLI_PAGE_API_KEY found in your environment.')));
	console.log(rule);
	console.log('');
	console.log('   This demo needs a develop-environment test key (' + c.cyan('pp_test_*') + ') to');
	console.log('   talk to the Poli Page API. Test keys never bill or send real');
	console.log('   documents.');
	console.log('');
	console.log(c.bold('   How to get one:'));
	console.log('     1. Sign in at ' + c.cyan('https://app-develop.poli.page'));
	console.log('     2. Go to your organization\'s API keys page:');
	console.log('          ' + c.cyan('https://app-develop.poli.page/orgs/{YOUR_ORG}/keys'));
	console.log(c.dim('        (replace {YOUR_ORG} with your org slug — visible in the'));
	console.log(c.dim('         dashboard URL when you\'re inside your organization)'));
	console.log('     3. Click "Create key", choose the ' + c.bold('develop') + ' environment, copy');
	console.log('        the value (starts with ' + c.cyan('pp_test_') + ').');
	console.log('');
	console.log('   You can paste it below to run the demo just this once, or set');
	console.log('   it as an env var so future runs pick it up automatically:');
	console.log('');
	console.log(c.dim('     export POLI_PAGE_API_KEY=pp_test_...'));
	console.log('');

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const key = (await rl.question(c.bold('   Paste your pp_test_* key') + ' (or Ctrl-C to cancel): ')).trim();
	rl.close();

	if (!key.startsWith('pp_test_')) {
		console.error('\n  ' + c.red('✗') + ' Expected a key starting with `pp_test_`. Aborting.\n');
		process.exit(1);
	}
	console.log('');
	return key;
}
