/**
 * @poli-page/sdk — Cloudflare Workers demo
 *
 * Proves the SDK's main entry is truly isomorphic — no `node:*` imports,
 * runs unmodified on Workers, Vercel Edge, Deno, and Bun.
 *
 * GET / returns an HTML report that exercises every SDK method, mirroring
 * the 10-step canonical demo in `demo/node/esm-demo.mjs`. Step 3 (the
 * filesystem helper `renderToFile`) is intentionally skipped — edge runtimes
 * have no filesystem — but the slot stays numbered so the report reads
 * parallel to the Node demos.
 *
 * Run locally:
 *   npm run dev                # predev prompts for the API key if needed
 *   open http://localhost:8787 # in a browser
 */

import { PoliPage, PoliPageError } from '@poli-page/sdk';

export default {
	async fetch(request, env) {
		const client = new PoliPage({
			apiKey: env.POLI_PAGE_API_KEY,
			baseUrl: env.POLI_PAGE_BASE_URL,
		});

		// Every render call uses project mode — required by render.pdf/
		// pdfStream/document. getting-started/welcome is auto-provisioned
		// in every org.
		const projectInput = {
			project: 'getting-started',
			template: 'welcome',
			version: '1.0.0',
			data: { name: 'Edge Demo' },
		};

		// First wave: run the independent SDK paths in parallel. `allSettled`
		// lets us collect every outcome (success or failure) so the report
		// shows what happened on each step independently.
		const [renderRes, streamRes, renderPreviewRes, docRes, errorRes] = await Promise.allSettled([
			client.render.pdf(projectInput),
			collectStream(client.render.pdfStream(projectInput)),
			client.render.preview(projectInput),
			client.render.document(projectInput),
			// Step 10 is supposed to fail — version 'banana' triggers INVALID_VERSION_FORMAT (400).
			// We invert the framing in the report: rejection is the success.
			client.render.pdf({ project: 'getting-started', template: 'welcome', version: 'banana', data: {} }),
		]);

		// Second wave: the documents.* steps need the id from render.document.
		// If render.document failed, every dependent step is recorded as a
		// skip with that reason. We run them sequentially (get → thumbnails →
		// preview → delete) so delete happens last and doesn't invalidate the
		// preceding reads.
		let getRes;
		let thumbsRes;
		let storedPreviewRes;
		let deleteRes;
		if (docRes.status === 'fulfilled') {
			const id = docRes.value.documentId;
			getRes = (await Promise.allSettled([client.documents.get(id)]))[0];
			thumbsRes = (await Promise.allSettled([
				client.documents.thumbnails(id, { width: 320, format: 'png' }),
			]))[0];
			storedPreviewRes = (await Promise.allSettled([client.documents.preview(id)]))[0];
			deleteRes = (await Promise.allSettled([client.documents.delete(id)]))[0];
		} else {
			const skip = { status: 'rejected', reason: new Error('skipped — render.document failed; no documentId') };
			getRes = skip;
			thumbsRes = skip;
			storedPreviewRes = skip;
			deleteRes = skip;
		}

		return new Response(
			reportHtml({
				renderRes,
				streamRes,
				renderPreviewRes,
				docRes,
				getRes,
				thumbsRes,
				storedPreviewRes,
				deleteRes,
				errorRes,
			}),
			{ headers: { 'content-type': 'text/html; charset=utf-8' } },
		);
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Drain a ReadableStream<Uint8Array> into a single Uint8Array. */
async function collectStream(streamPromise) {
	const stream = await streamPromise;
	const chunks = [];
	let total = 0;
	const reader = stream.getReader();
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.length;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/** Base64-encode a Uint8Array (Workers have `btoa` and `String.fromCharCode`). */
function toBase64(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

/** HTML-escape for safe interpolation in attributes and text content. */
function esc(s) {
	return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

/** Format a PoliPageError (or any error) as a small HTML block. */
function errorBlock(err) {
	if (err instanceof PoliPageError) {
		return `<dl class="kv">
  <dt>code</dt><dd>${esc(err.code)}</dd>
  <dt>status</dt><dd>${esc(err.status ?? '(none)')}</dd>
  <dt>requestId</dt><dd>${esc(err.requestId ?? '(none)')}</dd>
  <dt>message</dt><dd>${esc(err.message)}</dd>
  <dt>isAuthError()</dt><dd>${err.isAuthError()}</dd>
  <dt>isRetryable()</dt><dd>${err.isRetryable()}</dd>
</dl>`;
	}
	return `<pre class="err">${esc(err?.stack ?? err?.message ?? String(err))}</pre>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Report page
// ─────────────────────────────────────────────────────────────────────────────

function reportHtml({
	renderRes,
	streamRes,
	renderPreviewRes,
	docRes,
	getRes,
	thumbsRes,
	storedPreviewRes,
	deleteRes,
	errorRes,
}) {
	// Step 1: render.pdf() → PDF bytes. Offer a download via data URI.
	const renderSection =
		renderRes.status === 'fulfilled'
			? `<p class="ok">✔ ${renderRes.value.byteLength} bytes</p>
       <a class="btn" download="render.pdf"
          href="data:application/pdf;base64,${toBase64(renderRes.value)}">Download render.pdf</a>`
			: `<p class="fail">✗ failed</p>${errorBlock(renderRes.reason)}`;

	// Step 2: render.pdfStream() → same bytes, drained client-side via getReader().
	const streamSection =
		streamRes.status === 'fulfilled'
			? `<p class="ok">✔ ${streamRes.value.byteLength} bytes streamed and concatenated</p>
       <a class="btn" download="stream.pdf"
          href="data:application/pdf;base64,${toBase64(streamRes.value)}">Download stream.pdf</a>`
			: `<p class="fail">✗ failed</p>${errorBlock(streamRes.reason)}`;

	// Step 4: render.preview() → paginated HTML. Show in a sandboxed iframe.
	const renderPreviewSection =
		renderPreviewRes.status === 'fulfilled'
			? `<p class="ok">✔ ${renderPreviewRes.value.totalPages} page(s),
       ${renderPreviewRes.value.html.length} chars of HTML, env=${esc(renderPreviewRes.value.environment)}</p>
       <iframe class="preview" sandbox srcdoc="${esc(renderPreviewRes.value.html)}"></iframe>`
			: `<p class="fail">✗ failed</p>${errorBlock(renderPreviewRes.reason)}`;

	// Step 5: render.document() → stored document descriptor.
	const docSection =
		docRes.status === 'fulfilled'
			? `<p class="ok">✔ stored — <code>documentId: ${esc(docRes.value.documentId)}</code>,
       ${docRes.value.pageCount} page(s), ${docRes.value.sizeBytes} bytes</p>
       <a class="btn" href="${esc(docRes.value.presignedPdfUrl)}" target="_blank" rel="noopener">Open presigned PDF</a>`
			: `<p class="fail">✗ failed</p>${errorBlock(docRes.reason)}`;

	// Step 6: documents.get(id) → refreshed descriptor.
	const getSection =
		getRes.status === 'fulfilled'
			? `<p class="ok">✔ refreshed presigned URL valid until <code>${esc(getRes.value.expiresAt)}</code></p>`
			: `<p class="skip">✗ skipped or failed</p>${errorBlock(getRes.reason)}`;

	// Step 7: documents.thumbnails(id) → per-page PNGs. Tier-gated: Free keys
	// are rejected with 402 PAYMENT_REQUIRED or 403 FORBIDDEN /
	// THUMBNAILS_NOT_AVAILABLE depending on the gating layer.
	let thumbsSection;
	if (thumbsRes.status === 'fulfilled') {
		const figures = thumbsRes.value
			.map(
				(t) => `<figure>
          <img alt="page ${t.page}" src="data:${esc(t.contentType)};base64,${esc(t.data)}">
          <figcaption>page ${t.page} — ${t.width}×${t.height}</figcaption>
        </figure>`,
			)
			.join('');
		thumbsSection = `<p class="ok">✔ ${thumbsRes.value.length} thumbnail(s)</p>
       <div class="thumbs">${figures}</div>`;
	} else if (
		thumbsRes.reason instanceof PoliPageError
		&& (thumbsRes.reason.code === 'THUMBNAILS_NOT_AVAILABLE'
			|| thumbsRes.reason.status === 402
			|| thumbsRes.reason.status === 403)
	) {
		thumbsSection = `<p class="skip">skipped — ${esc(thumbsRes.reason.code)} (HTTP ${thumbsRes.reason.status}) — Starter+ tier feature</p>`;
	} else {
		thumbsSection = `<p class="fail">✗ failed</p>${errorBlock(thumbsRes.reason)}`;
	}

	// Step 8: documents.preview(id) → stored HTML preview.
	const storedPreviewSection =
		storedPreviewRes.status === 'fulfilled'
			? `<p class="ok">✔ ${storedPreviewRes.value.pageCount} page(s),
       ${storedPreviewRes.value.html.length} chars of HTML</p>
       <iframe class="preview" sandbox srcdoc="${esc(storedPreviewRes.value.html)}"></iframe>`
			: `<p class="fail">✗ failed</p>${errorBlock(storedPreviewRes.reason)}`;

	// Step 9: documents.delete(id) → void on success.
	const deleteSection =
		deleteRes.status === 'fulfilled'
			? `<p class="ok">✔ soft-deleted</p>`
			: `<p class="fail">✗ failed</p>${errorBlock(deleteRes.reason)}`;

	// Step 10: error handling. Inverted — the demo passes when the SDK throws
	// a PoliPageError for the deliberately invalid version string.
	const errorSection =
		errorRes.status === 'rejected' && errorRes.reason instanceof PoliPageError
			? `<p class="ok">✔ Error caught successfully — the SDK exposed:</p>
       ${errorBlock(errorRes.reason)}`
			: errorRes.status === 'rejected'
				? `<p class="fail">✗ Threw, but not a PoliPageError</p>${errorBlock(errorRes.reason)}`
				: `<p class="fail">✗ Unexpected: the call succeeded but should have failed.</p>`;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>@poli-page/sdk — Cloudflare Workers demo</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; padding-bottom: .25rem; border-bottom: 1px solid #e5e5e5; }
  .lede { color: #555; margin: 0 0 2rem; }
  .ok { color: #15803d; margin: .25rem 0; }
  .fail { color: #b91c1c; margin: .25rem 0; }
  .skip { color: #777; margin: .25rem 0; font-style: italic; }
  .btn { display: inline-block; padding: .35rem .7rem; margin-top: .25rem; background: #0f172a; color: #fff; border-radius: 4px; text-decoration: none; font-size: .85rem; }
  .btn:hover { background: #1e293b; }
  .preview { width: 100%; height: 600px; border: 1px solid #e5e5e5; border-radius: 4px; background: #f8f9fa; }
  .thumbs { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: .5rem; }
  .thumbs figure { margin: 0; text-align: center; }
  .thumbs img { max-width: 200px; border: 1px solid #e5e5e5; border-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .thumbs figcaption { font-size: .75rem; color: #777; margin-top: .25rem; }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; font-family: ui-monospace, monospace; font-size: .8rem; background: #f8f9fa; padding: .75rem; border-radius: 4px; }
  .kv dt { color: #777; }
  .kv dd { margin: 0; word-break: break-all; }
  .err { font-family: ui-monospace, monospace; font-size: .75rem; background: #fef2f2; color: #7f1d1d; padding: .75rem; border-radius: 4px; overflow-x: auto; }
  .intentional { background: #fefce8; border-left: 3px solid #eab308; padding: .5rem .75rem; margin: .5rem 0; font-size: .9rem; }
  .intentional strong { color: #854d0e; }
  code { font-family: ui-monospace, monospace; font-size: .85em; background: #f4f4f5; padding: .1rem .25rem; border-radius: 3px; }
</style>
</head>
<body>
  <h1>@poli-page/sdk — Cloudflare Workers demo</h1>
  <p class="lede">
    Every SDK method exercised from inside a Worker. No <code>nodejs_compat</code>
    flag, no <code>node:*</code> imports — the same code runs on Workers, Vercel
    Edge, Deno, and Bun.
  </p>

  <h2>[1/10] render.pdf() — PDF bytes in memory</h2>
  ${renderSection}

  <h2>[2/10] render.pdfStream() — ReadableStream of PDF bytes</h2>
  ${streamSection}

  <h2>[3/10] renderToFile() — skipped on edge runtimes</h2>
  <p class="skip">skipped — edge runtimes have no filesystem; renderToFile is a Node-only helper exported from <code>@poli-page/sdk/node</code>.</p>

  <h2>[4/10] render.preview() — paginated HTML</h2>
  ${renderPreviewSection}

  <h2>[5/10] render.document() — store the document, return the descriptor</h2>
  ${docSection}

  <h2>[6/10] documents.get(id) — refresh descriptor</h2>
  ${getSection}

  <h2>[7/10] documents.thumbnails(id) — page images (Starter+ tier)</h2>
  ${thumbsSection}

  <h2>[8/10] documents.preview(id) — stored document HTML (no engine work)</h2>
  ${storedPreviewSection}

  <h2>[9/10] documents.delete(id) — soft-delete</h2>
  ${deleteSection}

  <h2>[10/10] error handling — DEMO ONLY (we trigger an error on purpose)</h2>
  <div class="intentional">
    <strong>This step is intentional.</strong> The SDK is sent an invalid version
    string (<code>version: 'banana'</code>), the API returns 400
    <code>INVALID_VERSION_FORMAT</code>, and the SDK surfaces it as a
    <code>PoliPageError</code>. The demo passes when this error is caught.
  </div>
  ${errorSection}
</body>
</html>`;
}
