// @ts-check
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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as readline from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
// API key resolution
// ─────────────────────────────────────────────────────────────────────────────

// Single canonical location — `.env` at the repo root, one level above
// this file. Every demo (Node ESM, Node CJS, Cloudflare Worker) reads
// from here, and the prompt persists pasted keys here too.
const __dirname = dirname(fileURLToPath(import.meta.url));
export const ENV_FILE = resolve(__dirname, '..', '.env');

/**
 * Parse a `KEY=value` env-style file. Skips blank lines and `# comments`,
 * trims whitespace, and strips surrounding single or double quotes. Last
 * occurrence of a key wins. Dependency-free.
 */
function readEnvFile(path) {
	if (!existsSync(path)) return {};
	const result = {};
	for (const rawLine of readFileSync(path, 'utf-8').split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		result[key] = value;
	}
	return result;
}

/**
 * Append `KEY=value` to a file, creating the file if it doesn't exist and
 * adding a leading newline if the existing content doesn't end with one.
 * Naive — does not de-duplicate. If the file already had `KEY=`, both
 * lines remain; the parser's last-wins rule means the appended one takes
 * precedence on subsequent reads.
 */
function appendToEnvFile(path, key, value) {
	const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
	const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n');
	writeFileSync(path, (needsLeadingNewline ? '\n' : '') + `${key}=${value}\n`, { flag: 'a' });
}

/**
 * Resolve the Poli Page base URL for the demo. Resolution order:
 *
 *   1. `process.env.POLI_PAGE_BASE_URL` (host shell — wins for CI).
 *   2. `demo/.env` parsed `POLI_PAGE_BASE_URL`.
 *   3. Default: `https://api-develop.poli.page` (the develop environment).
 *
 * Never prompts — the default is fine for everyone.
 */
export function resolveBaseUrl() {
	if (process.env.POLI_PAGE_BASE_URL) return process.env.POLI_PAGE_BASE_URL;
	const fromFile = readEnvFile(ENV_FILE).POLI_PAGE_BASE_URL;
	if (fromFile) return fromFile;
	return 'https://api-develop.poli.page';
}

/**
 * Make sure we have a POLI_PAGE_API_KEY for the demo. Resolution order:
 *
 *   1. `process.env.POLI_PAGE_API_KEY` (host shell — wins for CI).
 *   2. `demo/.env` (the canonical project file — survives across runs).
 *   3. Interactive prompt; on a successful paste, the key is appended to
 *      `demo/.env` so future runs skip this step.
 *
 * Exits the process with a friendly error if the user pastes something
 * that doesn't start with `pp_test_`.
 */
export async function ensureApiKey() {
	if (process.env.POLI_PAGE_API_KEY) return process.env.POLI_PAGE_API_KEY;

	const fromFile = readEnvFile(ENV_FILE).POLI_PAGE_API_KEY;
	if (fromFile) {
		console.log(c.dim(`  using POLI_PAGE_API_KEY from ${ENV_FILE}`));
		return fromFile;
	}

	const rule = c.dim('  ─────────────────────────────────────────────────────────────────────');
	console.log('');
	console.log(rule);
	console.log(c.bold(c.yellow('   No POLI_PAGE_API_KEY found.')));
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
	console.log('   Paste it below — we\'ll save it to ' + c.cyan('.env') + ' (repo root) so');
	console.log('   future runs pick it up automatically. (You can also set');
	console.log('   ' + c.dim('POLI_PAGE_API_KEY') + ' in your shell — that wins over the file.)');
	console.log('');

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const key = (await rl.question(c.bold('   Paste your pp_test_* key') + ' (or Ctrl-C to cancel): ')).trim();
	rl.close();

	if (!key.startsWith('pp_test_')) {
		console.error('\n  ' + c.red('✗') + ' Expected a key starting with `pp_test_`. Aborting.\n');
		process.exit(1);
	}

	appendToEnvFile(ENV_FILE, 'POLI_PAGE_API_KEY', key);
	console.log(`  ${c.green('✔')} saved to ${c.cyan(ENV_FILE)}\n`);
	return key;
}
