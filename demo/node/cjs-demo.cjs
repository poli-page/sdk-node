// @ts-check
/**
 * @poli-page/sdk — Node.js CommonJS demo
 *
 * Run:  POLI_PAGE_API_KEY=pp_sandbox_x npm run demo:cjs
 *
 * Same walkthrough as `esm-demo.mjs`, written for CommonJS consumers.
 * Renders the `welcome` template of the `getting-started` project, which
 * every organization gets in its `sandbox` environment: use a sandbox key
 * (`pp_sandbox_…`) of an organization whose `getting-started` project is
 * untouched. A `live` key gets 404 PROJECT_NOT_IN_ENVIRONMENT. Outputs go to
 * `output-cjs/` so they don't clobber the ESM run's files.
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

// getting-started/welcome is published into every organization's
// sandbox environment when the organization is created.
const projectInput = {
	project: 'getting-started',
	template: 'welcome',
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

	const TOTAL_STEPS = 9;

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
	// 4. render.document() — store the document server-side, return its descriptor
	//    Use when: you want the document persisted for later (preview, thumbnails,
	//    re-download) without auto-fetching bytes. Persist `documentId` in your DB.
	// ─────────────────────────────────────────────────────────────────────────
	step(4, TOTAL_STEPS, 'render.document() — store the document, return the descriptor');
	const doc = await client.render.document(projectInput);
	console.log(`  ${c.dim('documentId:')} ${c.bold(doc.documentId)}`);
	console.log(`  ${c.dim('pageCount:')} ${doc.pageCount}  ${c.dim('sizeBytes:')} ${doc.sizeBytes}`);

	// ─────────────────────────────────────────────────────────────────────────
	// 5. documents.get(id) — refresh the descriptor (fresh presigned URL)
	//    Use when: the presigned URL on the original descriptor has expired
	//    (~15-minute TTL) and you need a new one. Same shape as render.document().
	// ─────────────────────────────────────────────────────────────────────────
	step(5, TOTAL_STEPS, 'documents.get(id) — refresh descriptor');
	const fetched = await client.documents.get(doc.documentId);
	console.log(`  ${c.dim('refreshed presigned URL valid until:')} ${fetched.expiresAt}`);

	// ─────────────────────────────────────────────────────────────────────────
	// 6. documents.thumbnails(id, options) — per-page PNG images
	//    Tier-gated: Free returns 403 THUMBNAILS_NOT_AVAILABLE. Demo soft-skips
	//    on that code so the script stays useful on Free keys.
	// ─────────────────────────────────────────────────────────────────────────
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

	// ─────────────────────────────────────────────────────────────────────────
	// 7. documents.preview(id) — stored document's paginated HTML (no engine work)
	//    Use when: rendering a review UI over a stored document, snapshot tests.
	//    Returns { html, pageCount }. Open the HTML file in any browser.
	// ─────────────────────────────────────────────────────────────────────────
	step(7, TOTAL_STEPS, 'documents.preview(id) — stored document HTML (no engine work)');
	const preview = await client.documents.preview(doc.documentId);
	const previewPath = join(OUT_DIR, 'documents_preview.html');
	writeFileSync(previewPath, preview.html);
	console.log(`  ${c.bold(preview.pageCount)} page(s), ${preview.html.length} chars`);
	console.log(`  ${c.dim('open:')} ${fileLink(previewPath)}`);

	// ─────────────────────────────────────────────────────────────────────────
	// 8. documents.delete(id) — soft-delete the stored document
	// ─────────────────────────────────────────────────────────────────────────
	step(8, TOTAL_STEPS, 'documents.delete(id) — soft-delete');
	await client.documents.delete(doc.documentId);
	console.log(`  ${c.green('✔')} deleted ${doc.documentId}`);

	// ─────────────────────────────────────────────────────────────────────────
	// 9. not-found — DELIBERATELY trigger a 404 TEMPLATE_NOT_FOUND, then catch it.
	// ─────────────────────────────────────────────────────────────────────────
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
})().catch((err) => {
	console.error('\n' + (process.stdout.isTTY ? '\x1b[31m✗\x1b[0m' : '✗'), 'FAILED:', err);
	process.exit(1);
});
