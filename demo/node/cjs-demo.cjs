// @ts-check
/**
 * @poli-page/sdk — Node.js CommonJS demo
 *
 * Run:  POLI_PAGE_API_KEY=pp_test_... npm run demo:cjs
 *
 * Same walkthrough as `esm-demo.mjs`, written for CommonJS consumers.
 * Uses the `getting-started/welcome/1.0.0` template that's auto-provisioned
 * in every Poli Page org, so this works out of the box with any fresh API
 * key — no project setup needed. Outputs go to `output-cjs/` so they don't
 * clobber the ESM run's files.
 *
 * What's different from the ESM demo:
 *   - `require(...)` instead of `import ... from ...`
 *   - The async work is wrapped in an IIFE because CommonJS does NOT
 *     support top-level `await` (only ESM modules do).
 *
 * Note: thumbnails are available against stored documents via
 * client.documents.thumbnails() — that requires Starter+ tier. See README.
 */

const { PoliPage, PoliPageError } = require('@poli-page/sdk');
const { renderToFile } = require('@poli-page/sdk/node');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

const OUT_DIR = 'output-cjs';
mkdirSync(OUT_DIR, { recursive: true });

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

// CommonJS has no top-level await — wrap the demo flow in an async IIFE.
// The shared helpers are ESM, so we load them via dynamic `import()` here:
// CJS can't statically `require` ESM, but it can `await import()` from inside
// an async function.
(async () => {
	const { c, step, ensureApiKey, fileLink, resolveBaseUrl } = await import('../_shared.mjs');

	// Resolve the API key — process.env wins, then `demo/.env`, then prompt.
	// On a fresh prompt the pasted key is saved to `demo/.env` automatically.
	const apiKey = await ensureApiKey();

	const client = new PoliPage({
		apiKey,
		baseUrl: resolveBaseUrl(),
		onRequest: (e) => console.log(c.cyan('  →'), c.dim(`${e.method} ${e.url} (attempt ${e.attempt})`)),
		onResponse: (e) => console.log(c.green('  ←'), c.dim(`${e.status} in ${e.durationMs}ms ${e.requestId ?? ''}`)),
		onRetry: (e) => console.log(c.yellow('  ↻'), c.dim(`retrying after ${e.delayMs}ms: ${e.reason.code}`)),
	});

	const TOTAL_STEPS = 10;

	// ─────────────────────────────────────────────────────────────────────────
	// 1. render.pdf() — fetch PDF bytes into memory
	//    Use when: small documents, you need the bytes synchronously.
	// ─────────────────────────────────────────────────────────────────────────
	step(1, TOTAL_STEPS, 'render.pdf() — PDF bytes in memory');
	const pdf = await client.render.pdf(projectInput);
	const renderPath = join(OUT_DIR, 'render.pdf');
	writeFileSync(renderPath, pdf);
	console.log(`  ${pdf.byteLength} bytes, magic: ${c.bold(new TextDecoder().decode(pdf.subarray(0, 4)))}`);
	console.log(`  ${c.dim('open:')} ${fileLink(renderPath)}`);

	// ─────────────────────────────────────────────────────────────────────────
	// 2. render.pdfStream() — get a ReadableStream of PDF bytes
	//    Use when: large documents, piping somewhere. Memory-bounded.
	// ─────────────────────────────────────────────────────────────────────────
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

	// ─────────────────────────────────────────────────────────────────────────
	// 3. renderToFile() — render straight to disk (Node only sub-export)
	//    Use when: you just want a PDF on the filesystem. Built on renderStream.
	// ─────────────────────────────────────────────────────────────────────────
	step(3, TOTAL_STEPS, 'renderToFile() — render straight to disk (Node)');
	const filePath = join(OUT_DIR, 'file.pdf');
	await renderToFile(client, projectInput, filePath);
	console.log(`  wrote ${filePath}`);
	console.log(`  ${c.dim('open:')} ${fileLink(filePath)}`);

	// ─────────────────────────────────────────────────────────────────────────
	// 4. render.preview() — paginated HTML for an editor / review UI
	//    Returns { html, totalPages, environment }. Engine returns HTML in-memory
	//    without storing a document. Useful for editors and snapshot tests.
	// ─────────────────────────────────────────────────────────────────────────
	step(4, TOTAL_STEPS, 'render.preview() — paginated HTML');
	const renderPreview = await client.render.preview(projectInput);
	const renderPreviewPath = join(OUT_DIR, 'render_preview.html');
	writeFileSync(renderPreviewPath, renderPreview.html);
	console.log(`  ${c.bold(renderPreview.totalPages)} page(s), ${renderPreview.html.length} chars, env=${renderPreview.environment}`);
	console.log(`  ${c.dim('open:')} ${fileLink(renderPreviewPath)}`);

	// ─────────────────────────────────────────────────────────────────────────
	// 5. render.document() — store the document server-side, return its descriptor
	//    Use when: you want the document persisted for later (preview, thumbnails,
	//    re-download) without auto-fetching bytes. Persist `documentId` in your DB.
	// ─────────────────────────────────────────────────────────────────────────
	step(5, TOTAL_STEPS, 'render.document() — store the document, return the descriptor');
	const doc = await client.render.document(projectInput);
	console.log(`  ${c.dim('documentId:')} ${c.bold(doc.documentId)}`);
	console.log(`  ${c.dim('pageCount:')} ${doc.pageCount}  ${c.dim('sizeBytes:')} ${doc.sizeBytes}`);

	// ─────────────────────────────────────────────────────────────────────────
	// 6. documents.get(id) — refresh the descriptor (fresh presigned URL)
	//    Use when: the presigned URL on the original descriptor has expired
	//    (~15-minute TTL) and you need a new one. Same shape as render.document().
	// ─────────────────────────────────────────────────────────────────────────
	step(6, TOTAL_STEPS, 'documents.get(id) — refresh descriptor');
	const fetched = await client.documents.get(doc.documentId);
	console.log(`  ${c.dim('refreshed presigned URL valid until:')} ${fetched.expiresAt}`);

	// ─────────────────────────────────────────────────────────────────────────
	// 7. documents.thumbnails(id, options) — per-page PNG images
	//    Tier-gated: Free returns 403 THUMBNAILS_NOT_AVAILABLE. Demo soft-skips
	//    on that code so the script stays useful on Free keys.
	// ─────────────────────────────────────────────────────────────────────────
	step(7, TOTAL_STEPS, 'documents.thumbnails(id) — page images (Starter+ tier)');
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
		// Tier-gated: Free keys are rejected with 402 PAYMENT_REQUIRED or 403
		// FORBIDDEN / THUMBNAILS_NOT_AVAILABLE depending on the gating layer.
		// Soft-skip any of those so the demo keeps running on Free.
		if (
			err instanceof PoliPageError
			&& (err.code === 'THUMBNAILS_NOT_AVAILABLE' || err.status === 402 || err.status === 403)
		) {
			console.log(`  ${c.yellow('skipped')} — ${err.code} (HTTP ${err.status}) — Starter+ tier feature`);
		} else {
			throw err;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// 8. documents.preview(id) — stored document's paginated HTML (no engine work)
	//    Use when: rendering a review UI over a stored document, snapshot tests.
	//    Returns { html, pageCount }. Open the HTML file in any browser.
	// ─────────────────────────────────────────────────────────────────────────
	step(8, TOTAL_STEPS, 'documents.preview(id) — stored document HTML (no engine work)');
	const preview = await client.documents.preview(doc.documentId);
	const previewPath = join(OUT_DIR, 'documents_preview.html');
	writeFileSync(previewPath, preview.html);
	console.log(`  ${c.bold(preview.pageCount)} page(s), ${preview.html.length} chars`);
	console.log(`  ${c.dim('open:')} ${fileLink(previewPath)}`);

	// ─────────────────────────────────────────────────────────────────────────
	// 9. documents.delete(id) — soft-delete the stored document
	// ─────────────────────────────────────────────────────────────────────────
	step(9, TOTAL_STEPS, 'documents.delete(id) — soft-delete');
	await client.documents.delete(doc.documentId);
	console.log(`  ${c.green('✔')} deleted ${doc.documentId}`);

	// ─────────────────────────────────────────────────────────────────────────
	// 10. Error handling — DELIBERATELY trigger a failure, then catch it.
	// ─────────────────────────────────────────────────────────────────────────
	step(10, TOTAL_STEPS, 'error handling — DEMO ONLY (we trigger an error on purpose)');
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
})().catch((err) => {
	console.error('\n' + (process.stdout.isTTY ? '\x1b[31m✗\x1b[0m' : '✗'), 'FAILED:', err);
	process.exit(1);
});
