#!/usr/bin/env node
/**
 * Single entry point for the Cloudflare Workers demo.
 *
 * One script does everything frictionless-demos need:
 *   1. Make sure `.dev.vars` has POLI_PAGE_API_KEY (prompt if missing).
 *   2. Spawn `wrangler dev` (output piped through to the user's terminal).
 *   3. Wait for the worker port to come up, then auto-open the report URL
 *      in the user's default browser.
 *   4. Forward Ctrl-C to wrangler so quitting cleans up properly.
 *
 * Replaces the old predev/dev split. The user runs `pnpm run dev` (or
 * `pnpm demo:edge` from the SDK root) and the demo is open in their
 * browser within seconds — no `.dev.vars` to remember, no second curl
 * step, no separate "open this URL" instruction.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { c, getApiKey } from '../../_shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEV_VARS = resolve(__dirname, '.dev.vars');
const PORT = 8787;
const URL = `http://localhost:${PORT}`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Ensure .dev.vars has the API key
// ─────────────────────────────────────────────────────────────────────────────
const existing = existsSync(DEV_VARS) ? readFileSync(DEV_VARS, 'utf-8') : '';
const alreadyHasKey = /^\s*POLI_PAGE_API_KEY\s*=\s*\S+/m.test(existing);

if (!alreadyHasKey) {
	// Prefer the shell env if the user already has it set; otherwise prompt.
	const key = process.env.POLI_PAGE_API_KEY ?? (await getApiKey());
	const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n');
	writeFileSync(DEV_VARS, (needsLeadingNewline ? '\n' : '') + `POLI_PAGE_API_KEY=${key}\n`, {
		flag: 'a',
	});
	console.log(`  ${c.green('✔')} wrote ${c.cyan('.dev.vars')}.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Spawn wrangler dev (inherit stdio so the user sees wrangler's output)
// ─────────────────────────────────────────────────────────────────────────────
console.log(c.dim('  starting wrangler...\n'));

const wrangler = spawn('wrangler', ['dev', '--port', String(PORT)], {
	stdio: 'inherit',
	shell: platform() === 'win32',
});

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
