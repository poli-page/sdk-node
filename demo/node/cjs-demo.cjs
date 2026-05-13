// @ts-check
/**
 * @poli-page/sdk — Node.js CommonJS demo
 *
 * Run:  POLI_PAGE_API_KEY=pp_test_... pnpm run demo:cjs
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
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

const OUT_DIR = 'output-cjs';
mkdirSync(OUT_DIR, { recursive: true });

// For render.pdf/pdfStream/renderToFile — must use project mode.
// getting-started/welcome is auto-provisioned in every org, so this works
// out of the box for any newcomer with a fresh API key.
const projectInput = {
	project: 'getting-started',
	template: 'welcome',
	version: '1.0.0',
	data: { name: 'SDK Demo' },
};

// For render.preview — inline mode is allowed here. Use the local invoice
// template to show a realistic preview. The invoice template exercises the
// engine's full feature set: Tailwind utilities, format-responsive variants
// (`a5-portrait:text-...`), `@if`/`@for` control flow, function calls
// (`formatDate(...)`, `formatMoney(...)`), and `poli-*` chrome elements.
//
// invoice.json's top-level shape is `{ locale, data }` — the SDK takes those
// as separate sibling fields on the input.
const TEMPLATE_DIR = resolve(__dirname, '..', 'templates', 'invoice');
const inlineTemplateHtml = readFileSync(join(TEMPLATE_DIR, 'invoice.html'), 'utf-8');
const { locale, data: inlineData } = JSON.parse(readFileSync(join(TEMPLATE_DIR, 'invoice.json'), 'utf-8'));
const inlineInput = {
	template: inlineTemplateHtml,
	data: inlineData,
	locale,
};

// CommonJS has no top-level await — wrap the demo flow in an async IIFE.
// The shared helpers are ESM, so we load them via dynamic `import()` here:
// CJS can't statically `require` ESM, but it can `await import()` from inside
// an async function.
(async () => {
	const { c, step, ensureApiKey, fileLink } = await import('../_shared.mjs');

	// Resolve the API key — process.env wins, then `demo/.env`, then prompt.
	// On a fresh prompt the pasted key is saved to `demo/.env` automatically.
	const apiKey = await ensureApiKey();

	const client = new PoliPage({
		apiKey,
		baseUrl: 'https://api-develop.poli.page',
		onRequest: (e) => console.log(c.cyan('  →'), c.dim(`${e.method} ${e.url} (attempt ${e.attempt})`)),
		onResponse: (e) => console.log(c.green('  ←'), c.dim(`${e.status} in ${e.durationMs}ms ${e.requestId ?? ''}`)),
		onRetry: (e) => console.log(c.yellow('  ↻'), c.dim(`retrying after ${e.delayMs}ms: ${e.reason.code}`)),
	});

	const TOTAL_STEPS = 5;

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
	// 4. render.preview() — get the engine's HTML output (no PDF rasterization)
	//    Use when: debugging, live editors, snapshot tests. Much faster than render.pdf().
	// ─────────────────────────────────────────────────────────────────────────
	step(4, TOTAL_STEPS, 'render.preview() — engine HTML output (no PDF rasterization)');
	const preview = await client.render.preview(inlineInput);
	const previewPath = join(OUT_DIR, 'preview.html');
	writeFileSync(previewPath, preview.html);
	console.log(`  ${c.bold(preview.totalPages)} page(s), ${preview.html.length} chars`);
	console.log(`  ${c.dim('open:')} ${fileLink(previewPath)}`);

	// ─────────────────────────────────────────────────────────────────────────
	// 5. Error handling — DELIBERATELY trigger a failure, then catch it.
	// ─────────────────────────────────────────────────────────────────────────
	step(5, TOTAL_STEPS, 'error handling — DEMO ONLY (we trigger an error on purpose)');
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
