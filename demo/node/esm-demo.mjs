/**
 * @poli-page/sdk — Node.js ESM demo
 *
 * Run:  POLI_PAGE_API_KEY=pp_test_... pnpm run demo:esm
 *
 * Walks through every public method of the SDK and writes the results to
 * `output-esm/`. Open the generated files to confirm everything works:
 *
 *   - output-esm/render.pdf   (from client.render.pdf())
 *   - output-esm/stream.pdf   (from client.render.pdfStream())
 *   - output-esm/file.pdf     (from renderToFile())
 *   - output-esm/preview.html (from client.render.preview())
 *
 * Note: thumbnails are available against stored documents via
 * client.documents.thumbnails() — that requires Starter+ tier. See README.
 */

import { PoliPage, PoliPageError } from '@poli-page/sdk';
import { renderToFile } from '@poli-page/sdk/node';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, step, ensureApiKey, fileLink } from '../_shared.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = 'output-esm';
mkdirSync(OUT_DIR, { recursive: true });

// Resolve the API key — process.env wins, then `demo/.env`, then prompt.
// On a fresh prompt the pasted key is saved to `demo/.env` automatically.
const apiKey = await ensureApiKey();

// One realistic template, used by every method below.
//
// `demo/templates/invoice/` is a copy of the showcase invoice from the platform
// repo (`poli-page/showcase/templates/invoice/`). Treat it as a known-good
// production-grade template — it exercises the engine's full feature set:
// Tailwind utilities, format-responsive variants (`a5-portrait:text-...`),
// `@if`/`@for` control flow, function calls (`formatDate(...)`,
// `formatMoney(...)`), and `poli-*` chrome elements (`poli-header`,
// `poli-footer`, `poli-page-numbers`, `poli-icon`).
//
// invoice.json's top-level shape is `{ locale, data }` — the SDK takes those
// as separate sibling fields on the input.
const TEMPLATE_DIR = resolve(__dirname, '..', 'templates', 'invoice');
const templateHtml = readFileSync(join(TEMPLATE_DIR, 'invoice.html'), 'utf-8');
const { locale, data } = JSON.parse(readFileSync(join(TEMPLATE_DIR, 'invoice.json'), 'utf-8'));

const input = {
	template: templateHtml,
	data,
	locale,
};

// The client is a single object you create once and reuse for every call.
// Hooks are optional — they let you observe HTTP traffic without coupling
// to a logging library. They never block or change request behavior.
const client = new PoliPage({
	apiKey,
	baseUrl: 'https://api-develop.poli.page',
	onRequest: (e) => console.log(c.cyan('  →'), c.dim(`${e.method} ${e.url} (attempt ${e.attempt})`)),
	onResponse: (e) => console.log(c.green('  ←'), c.dim(`${e.status} in ${e.durationMs}ms ${e.requestId ?? ''}`)),
	onRetry: (e) => console.log(c.yellow('  ↻'), c.dim(`retrying after ${e.delayMs}ms: ${e.reason.code}`)),
});

const TOTAL_STEPS = 5;

// ─────────────────────────────────────────────────────────────────────────────
// 1. render.pdf() — fetch PDF bytes into memory
//    Use when: small documents, you need the bytes synchronously (return from
//    an HTTP handler, attach to an email, hash for a signature).
// ─────────────────────────────────────────────────────────────────────────────
step(1, TOTAL_STEPS, 'render.pdf() — PDF bytes in memory');
const pdf = await client.render.pdf(input);
const renderPath = join(OUT_DIR, 'render.pdf');
writeFileSync(renderPath, pdf);
console.log(`  ${pdf.byteLength} bytes, magic: ${c.bold(new TextDecoder().decode(pdf.subarray(0, 4)))}`);
console.log(`  ${c.dim('open:')} ${fileLink(renderPath)}`);

// ─────────────────────────────────────────────────────────────────────────────
// 2. render.pdfStream() — get a ReadableStream of PDF bytes
//    Use when: large documents, piping to S3 / an HTTP response / a transformer.
//    Memory-bounded — never holds the whole PDF in RAM.
// ─────────────────────────────────────────────────────────────────────────────
step(2, TOTAL_STEPS, 'render.pdfStream() — ReadableStream of PDF bytes');
const stream = await client.render.pdfStream(input);
const chunks = [];
let total = 0;
for await (const chunk of stream) {
	chunks.push(chunk);
	total += chunk.length;
}
const streamBytes = new Uint8Array(total);
let offset = 0;
for (const chunk of chunks) {
	streamBytes.set(chunk, offset);
	offset += chunk.length;
}
const streamPath = join(OUT_DIR, 'stream.pdf');
writeFileSync(streamPath, streamBytes);
console.log(`  ${total} bytes streamed`);
console.log(`  ${c.dim('open:')} ${fileLink(streamPath)}`);

// ─────────────────────────────────────────────────────────────────────────────
// 3. renderToFile() — render straight to disk (Node only)
//    Use when: you just want a PDF on the filesystem. Built on renderStream,
//    so memory usage stays bounded regardless of document size.
//    Note: imported from `@poli-page/sdk/node` — this helper is not part of
//    the isomorphic main entry because it needs Node's `fs` API.
// ─────────────────────────────────────────────────────────────────────────────
step(3, TOTAL_STEPS, 'renderToFile() — render straight to disk (Node)');
const filePath = join(OUT_DIR, 'file.pdf');
await renderToFile(client, input, filePath);
console.log(`  wrote ${filePath}`);
console.log(`  ${c.dim('open:')} ${fileLink(filePath)}`);

// ─────────────────────────────────────────────────────────────────────────────
// 4. render.preview() — get the engine's HTML output (no PDF rasterization)
//    Use when: debugging templates, building a live editor, snapshot tests
//    in CI. Much faster than render.pdf() because it skips headless Chromium.
//    Returns { html, totalPages }. Open the HTML file in any browser.
// ─────────────────────────────────────────────────────────────────────────────
step(4, TOTAL_STEPS, 'render.preview() — engine HTML output (no PDF rasterization)');
const preview = await client.render.preview(input);
const previewPath = join(OUT_DIR, 'preview.html');
writeFileSync(previewPath, preview.html);
console.log(`  ${c.bold(preview.totalPages)} page(s), ${preview.html.length} chars`);
console.log(`  ${c.dim('open:')} ${fileLink(previewPath)}`);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Error handling — DELIBERATELY trigger a failure, then catch it.
//    Every failure — API errors, network failures, timeouts, caller aborts —
//    surfaces as `PoliPageError`. Inspect `code`, `status`, `requestId`, or
//    use the predicate helpers (isAuthError, isRateLimitError, isRetryable…).
// ─────────────────────────────────────────────────────────────────────────────
step(5, TOTAL_STEPS, 'error handling — DEMO ONLY (we trigger an error on purpose)');
console.log(c.yellow('  ⚠  This step is intentional — the SDK is about to throw, but the'));
console.log(c.yellow('     demo will catch and inspect it. ') + c.bold('The demo is NOT crashing.'));
console.log(c.dim('     (We send an empty template, expecting the API to return 400.)'));
console.log('');
try {
	// Intentionally invalid: empty template + empty data triggers 400.
	await client.render.pdf({ template: '', data: {} });
	console.log('  ' + c.red('✗ unexpected: the call succeeded but should have failed'));
} catch (err) {
	if (err instanceof PoliPageError) {
		console.log(`  ${c.green('✔')} Error caught successfully. PoliPageError exposed:`);
		console.log('     ', {
			code: err.code,
			status: err.status,
			requestId: err.requestId,
			isAuthError: err.isAuthError(),
			isRetryable: err.isRetryable(),
		});
	} else {
		throw err;
	}
}

console.log(`\n${c.green('✔')} ${c.bold('All steps completed.')} Inspect output in ${fileLink(OUT_DIR)}\n`);
