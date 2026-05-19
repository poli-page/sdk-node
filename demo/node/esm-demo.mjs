// @ts-check
/**
 * @poli-page/sdk — Node.js ESM demo
 *
 * Run:  POLI_PAGE_API_KEY=pp_test_... pnpm run demo:esm
 *
 * Walks through every public method of the SDK and writes the results to
 * `output-esm/`. Uses the `getting-started/welcome/1.0.0` template that's
 * auto-provisioned in every Poli Page org, so this works out of the box
 * with any fresh API key — no project setup needed.
 *
 * Open the generated files to confirm everything works:
 *
 *   - output-esm/render.pdf   (from client.render.pdf())
 *   - output-esm/stream.pdf   (from client.render.pdfStream())
 *   - output-esm/file.pdf     (from renderToFile())
 *   - output-esm/preview.html (from client.documents.preview(id), after
 *                              storing the document via client.render.document())
 *
 * Note: thumbnails are available against stored documents via
 * client.documents.thumbnails() — that requires Starter+ tier. See README.
 */

import { PoliPage, PoliPageError } from '@poli-page/sdk';
import { renderToFile } from '@poli-page/sdk/node';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { c, step, ensureApiKey, fileLink, resolveBaseUrl } from '../_shared.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

const OUT_DIR = 'output-esm';
mkdirSync(OUT_DIR, { recursive: true });

// Resolve the API key — process.env wins, then `demo/.env`, then prompt.
// On a fresh prompt the pasted key is saved to `demo/.env` automatically.
const apiKey = await ensureApiKey();

// Every render call uses project mode — required by render.pdf/pdfStream/
// renderToFile/document. getting-started/welcome is auto-provisioned in
// every org, so this works out of the box for any newcomer with a fresh
// API key.
const projectInput = {
	project: 'getting-started',
	template: 'welcome',
	version: '1.0.0',
	data: { name: 'SDK Demo' },
};

// The client is a single object you create once and reuse for every call.
// Hooks are optional — they let you observe HTTP traffic without coupling
// to a logging library. They never block or change request behavior.
const client = new PoliPage({
	apiKey,
	baseUrl: resolveBaseUrl(),
	onRequest: (e) => console.log(c.cyan('  →'), c.dim(`${e.method} ${e.url} (attempt ${e.attempt})`)),
	onResponse: (e) => console.log(c.green('  ←'), c.dim(`${e.status} in ${e.durationMs}ms ${e.requestId ?? ''}`)),
	onRetry: (e) => console.log(c.yellow('  ↻'), c.dim(`retrying after ${e.delayMs}ms: ${e.reason.code}`)),
});

const TOTAL_STEPS = 6;

// ─────────────────────────────────────────────────────────────────────────────
// 1. render.pdf() — fetch PDF bytes into memory
//    Use when: small documents, you need the bytes synchronously (return from
//    an HTTP handler, attach to an email, hash for a signature).
// ─────────────────────────────────────────────────────────────────────────────
step(1, TOTAL_STEPS, 'render.pdf() — PDF bytes in memory');
const pdf = await client.render.pdf(projectInput);
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
const stream = await client.render.pdfStream(projectInput);
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
await renderToFile(client, projectInput, filePath);
console.log(`  wrote ${filePath}`);
console.log(`  ${c.dim('open:')} ${fileLink(filePath)}`);

// ─────────────────────────────────────────────────────────────────────────────
// 4. render.document() — render and store the document, return its descriptor
//    Use when: you want the document persisted server-side for later access
//    (preview, thumbnails, re-download) without auto-fetching the PDF bytes.
//    Returns a DocumentDescriptor — persist `documentId` in your DB.
// ─────────────────────────────────────────────────────────────────────────────
step(4, TOTAL_STEPS, 'render.document() — store the document, return the descriptor');
const doc = await client.render.document(projectInput);
console.log(`  ${c.dim('documentId:')} ${c.bold(doc.documentId)}`);

// ─────────────────────────────────────────────────────────────────────────────
// 5. documents.preview(id) — get the stored document's paginated HTML
//    Use when: rendering a live editor over a stored document, building a
//    review UI, snapshot tests in CI. No counter increments — the engine
//    performs no work on this call. Returns { html, pageCount }.
// ─────────────────────────────────────────────────────────────────────────────
step(5, TOTAL_STEPS, 'documents.preview(id) — stored document HTML (no engine work)');
const preview = await client.documents.preview(doc.documentId);
const previewPath = join(OUT_DIR, 'preview.html');
writeFileSync(previewPath, preview.html);
console.log(`  ${c.bold(preview.pageCount)} page(s), ${preview.html.length} chars`);
console.log(`  ${c.dim('open:')} ${fileLink(previewPath)}`);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Error handling — DELIBERATELY trigger a failure, then catch it.
//    Every failure — API errors, network failures, timeouts, caller aborts —
//    surfaces as `PoliPageError`. Inspect `code`, `status`, `requestId`, or
//    use the predicate helpers (isAuthError, isRateLimitError, isRetryable…).
// ─────────────────────────────────────────────────────────────────────────────
step(6, TOTAL_STEPS, 'error handling — DEMO ONLY (we trigger an error on purpose)');
console.log(c.yellow('  ⚠  This step is intentional — the SDK is about to throw, but the'));
console.log(c.yellow('     demo will catch and inspect it. ') + c.bold('The demo is NOT crashing.'));
console.log(c.dim('     (We send an invalid version string, expecting the API to return 400 INVALID_VERSION_FORMAT.)'));
console.log('');
try {
	// Intentionally invalid: version 'banana' triggers INVALID_VERSION_FORMAT (400).
	await client.render.pdf({ project: 'getting-started', template: 'welcome', version: 'banana', data: {} });
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
