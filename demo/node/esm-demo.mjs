// @ts-check
/**
 * @poli-page/sdk — Node.js ESM demo
 *
 * Run:  POLI_PAGE_API_KEY=pp_sandbox_x npm run demo:esm
 *
 * Walks through every public method of the SDK and writes the results to
 * `output-esm/`. Renders the `welcome` template of the `getting-started`
 * project, which every organization gets in its `sandbox` environment: use a
 * sandbox key (`pp_sandbox_…`) of an organization whose `getting-started`
 * project is untouched. A `live` key gets 404 PROJECT_NOT_IN_ENVIRONMENT.
 *
 * Open the generated files to confirm everything works:
 *
 *   - output-esm/render.pdf               (client.render.pdf)
 *   - output-esm/stream.pdf               (client.render.pdfStream)
 *   - output-esm/file.pdf                 (renderToFile)
 *   - output-esm/documents_preview.html   (client.documents.preview, after storing)
 *   - output-esm/thumbs/page_<n>.png      (client.documents.thumbnails, Starter+ tier)
 *
 * Step 9 deliberately triggers a 404 to exercise the error-handling story —
 * the demo catches PoliPageError and prints the exposed fields. The script
 * does NOT crash there.
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

// getting-started/welcome is published into every organization's
// sandbox environment when the organization is created.
const projectInput = {
	project: 'getting-started',
	template: 'welcome',
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

const TOTAL_STEPS = 9;

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
console.log(`  ${c.dim('pageCount:')} ${doc.pageCount}  ${c.dim('sizeBytes:')} ${doc.sizeBytes}`);

// ─────────────────────────────────────────────────────────────────────────────
// 5. documents.get(id) — refresh the descriptor (fresh presigned URL)
//    Use when: the presigned URL on the original descriptor has expired
//    (~15-minute TTL) and you need a new one. Same shape as render.document().
// ─────────────────────────────────────────────────────────────────────────────
step(5, TOTAL_STEPS, 'documents.get(id) — refresh descriptor');
const fetched = await client.documents.get(doc.documentId);
console.log(`  ${c.dim('refreshed presigned URL valid until:')} ${fetched.expiresAt}`);

// ─────────────────────────────────────────────────────────────────────────────
// 6. documents.thumbnails(id, options) — per-page PNG images
//    Use when: building a thumbnail strip, document picker, OG image.
//    Tier-gated on the API side: Free returns 403 THUMBNAILS_NOT_AVAILABLE.
//    Demo soft-skips on that code so the script stays useful on Free keys.
// ─────────────────────────────────────────────────────────────────────────────
step(6, TOTAL_STEPS, 'documents.thumbnails(id) — page images (Starter+ tier)');
try {
	const thumbs = await client.documents.thumbnails(doc.documentId, { width: 320, format: 'png' });
	const thumbDir = join(OUT_DIR, 'thumbs');
	mkdirSync(thumbDir, { recursive: true });
	for (const thumb of thumbs) {
		const thumbPath = join(thumbDir, `page_${thumb.page}.png`);
		writeFileSync(thumbPath, Buffer.from(thumb.data, 'base64'));
		console.log(`  wrote page_${thumb.page}.png (${thumb.width}x${thumb.height})`);
	}
	console.log(`  ${c.dim('open:')} ${fileLink(thumbDir)}`);
} catch (err) {
	// Tier-gated: Free keys are rejected with 403 THUMBNAILS_NOT_AVAILABLE
	// (or 403 FORBIDDEN, depending on the gating layer).
	// Soft-skip any of those so the demo keeps running on Free.
	if (
		err instanceof PoliPageError
		&& (err.code === 'THUMBNAILS_NOT_AVAILABLE' || err.status === 403)
	) {
		console.log(`  ${c.yellow('skipped')} — ${err.code} (HTTP ${err.status}) — Starter+ tier feature`);
	} else {
		throw err;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. documents.preview(id) — get the stored document's paginated HTML
//    Use when: rendering a live editor over a stored document, building a
//    review UI, snapshot tests in CI. No counter increments — the engine
//    performs no work on this call. Returns { html, pageCount }.
// ─────────────────────────────────────────────────────────────────────────────
step(7, TOTAL_STEPS, 'documents.preview(id) — stored document HTML (no engine work)');
const preview = await client.documents.preview(doc.documentId);
const previewPath = join(OUT_DIR, 'documents_preview.html');
writeFileSync(previewPath, preview.html);
console.log(`  ${c.bold(preview.pageCount)} page(s), ${preview.html.length} chars`);
console.log(`  ${c.dim('open:')} ${fileLink(previewPath)}`);

// ─────────────────────────────────────────────────────────────────────────────
// 8. documents.delete(id) — soft-delete the stored document
//    Use when: cleaning up demo / test runs, GDPR-style erasure. The document
//    is hidden from subsequent reads; a repeated delete resolves too.
// ─────────────────────────────────────────────────────────────────────────────
step(8, TOTAL_STEPS, 'documents.delete(id) — soft-delete');
await client.documents.delete(doc.documentId);
console.log(`  ${c.green('✔')} deleted ${doc.documentId}`);

// ─────────────────────────────────────────────────────────────────────────────
// 9. not-found — DELIBERATELY trigger a 404 TEMPLATE_NOT_FOUND, then catch it.
//    Every failure — API errors, network failures, timeouts, caller aborts —
//    surfaces as `PoliPageError`. Inspect `code`, `status`, `requestId`, or
//    use the predicate helpers (isAuthError, isRateLimitError, isRetryable…).
// ─────────────────────────────────────────────────────────────────────────────
step(9, TOTAL_STEPS, 'not-found — DEMO ONLY (we trigger an error on purpose)');
console.log(c.yellow('  ⚠  This step is intentional — the SDK is about to throw, but the'));
console.log(c.yellow('     demo will catch and inspect it. ') + c.bold('The demo is NOT crashing.'));
console.log(c.dim('     (We render a template that does not exist, expecting the API to return 404 TEMPLATE_NOT_FOUND.)'));
console.log('');
try {
	// Intentionally invalid: an unknown template triggers TEMPLATE_NOT_FOUND (404).
	await client.render.pdf({ project: 'getting-started', template: 'does-not-exist', data: {} });
	console.log('  ' + c.red('✗ unexpected: the call succeeded but should have failed'));
} catch (err) {
	if (err instanceof PoliPageError && err.code === 'TEMPLATE_NOT_FOUND' && err.status === 404) {
		console.log(`  ${c.green('✔')} Error caught successfully. PoliPageError exposed:`);
		console.log('     ', {
			code: err.code,
			status: err.status,
			message: err.message,
			requestId: err.requestId,
		});
	} else {
		throw err;
	}
}

console.log(`\n${c.green('✔')} ${c.bold('All steps completed.')} Inspect output in ${fileLink(OUT_DIR)}\n`);
