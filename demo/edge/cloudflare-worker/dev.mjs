#!/usr/bin/env node
/**
 * Single entry point for the Cloudflare Workers demo.
 *
 * One script does everything frictionless-demos need:
 *   1. Resolve POLI_PAGE_API_KEY from process.env, then `demo/.env` —
 *      prompts the user (and saves to `demo/.env`) if neither has it.
 *      All of that logic lives in `demo/_shared.mjs` so it stays in sync
 *      with the Node demos.
 *   2. Spawn `wrangler dev`, passing the key as a CLI binding
 *      (`--var POLI_PAGE_API_KEY:$key`) so the Worker sees it as
 *      `env.POLI_PAGE_API_KEY` without us having to drop a `.dev.vars`
 *      file alongside the Worker.
 *   3. Wait for the Worker port to come up, then auto-open the report URL
 *      in the user's default browser.
 *   4. Forward Ctrl-C to wrangler so quitting cleans up properly.
 *
 * Trade-off worth knowing: passing the key via `--var` means the value
 * is visible in `ps` while wrangler runs. Acceptable for `pp_test_*`
 * keys against develop; never use this approach for `pp_live_*` keys.
 * Production deploys use `wrangler secret put POLI_PAGE_API_KEY`.
 */

import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { platform } from 'node:os';

import { c, ensureApiKey, resolveBaseUrl } from '../../_shared.mjs';

const PORT = 8787;
const URL = `http://localhost:${PORT}`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Resolve the API key (env → demo/.env → prompt-and-persist) and baseUrl
// ─────────────────────────────────────────────────────────────────────────────
const apiKey = await ensureApiKey();
const baseUrl = resolveBaseUrl();

// ─────────────────────────────────────────────────────────────────────────────
// 2. Spawn `wrangler dev` with the key + baseUrl passed as CLI bindings
// ─────────────────────────────────────────────────────────────────────────────
console.log(c.dim('  starting wrangler...\n'));

const wrangler = spawn(
	'wrangler',
	[
		'dev',
		'--port', String(PORT),
		'--var', `POLI_PAGE_API_KEY:${apiKey}`,
		'--var', `POLI_PAGE_BASE_URL:${baseUrl}`,
	],
	{ stdio: 'inherit', shell: platform() === 'win32' },
);

wrangler.on('error', (err) => {
	console.error(`\n  ${c.red('✗')} failed to start wrangler: ${err.message}\n`);
	process.exit(1);
});

wrangler.on('exit', (code) => process.exit(code ?? 0));

// Forward Ctrl-C / SIGTERM to the child so it shuts down cleanly.
process.on('SIGINT', () => wrangler.kill('SIGINT'));
process.on('SIGTERM', () => wrangler.kill('SIGTERM'));

// ─────────────────────────────────────────────────────────────────────────────
// 3. Wait for the port, then auto-open the browser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Poll a TCP port until it accepts a connection. Cheap (no HTTP request,
 * so we don't trigger a render before wrangler is fully up).
 */
function waitForPort(port, host = 'localhost', timeoutMs = 30_000) {
	return new Promise((resolveReady, rejectReady) => {
		const started = Date.now();
		const tryOnce = () => {
			const sock = connect(port, host);
			sock.once('connect', () => {
				sock.end();
				resolveReady();
			});
			sock.once('error', () => {
				sock.destroy();
				if (Date.now() - started > timeoutMs) {
					return rejectReady(new Error(`timed out waiting for port ${port}`));
				}
				setTimeout(tryOnce, 250);
			});
		};
		tryOnce();
	});
}

try {
	await waitForPort(PORT);
} catch (err) {
	console.error(`\n  ${c.yellow('⚠')} ${err.message} — open ${c.cyan(URL)} manually.\n`);
	// Don't exit — wrangler is still running.
}

const opener =
	platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
const openerArgs = platform() === 'win32' ? ['', URL] : [URL];

spawn(opener, openerArgs, {
	stdio: 'ignore',
	detached: true,
	shell: platform() === 'win32',
}).unref();

console.log(`\n  ${c.green('✔')} opened ${c.cyan(URL)} in your browser`);
console.log(c.dim('  press Ctrl-C to stop\n'));
