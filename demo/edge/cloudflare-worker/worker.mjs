/**
 * @poli-page/sdk — Cloudflare Workers demo
 *
 * Proves the SDK's main entry is truly isomorphic — no `node:*` imports,
 * runs unmodified on Workers, Vercel Edge, Deno, and Bun.
 *
 * GET / returns an HTML report that exercises every SDK method (except
 * `renderToFile`, which is deliberately Node-only) and a deliberate error
 * step. One request = a tour of the whole public API.
 *
 * Run locally:
 *   pnpm run dev               # predev prompts for the API key if needed
 *   open http://localhost:8787 # in a browser
 */

import { PoliPage, PoliPageError } from '@poli-page/sdk';

// One template, used by every method below — same Tailwind-rich snippet
// the Node demos use, kept inline here so the worker stays a single file.
const input = {
	template: `<div class="p-8">
  <h1 class="text-3xl font-bold">{{ title }}</h1>
  <p class="mt-4">Rendered from a Cloudflare Worker — no node:* imports needed.</p>
</div>`,
	data: { title: 'Hello from the edge' },
};

export default {
	async fetch(request, env) {
		const client = new PoliPage({
			apiKey: env.POLI_PAGE_API_KEY,
			baseUrl: 'https://api-develop.poli.page',
		});

		// Run all five SDK paths in parallel. `allSettled` lets us collect
		// every outcome (success or failure) so the report shows what
		// happened on each step independently.
		const [renderRes, streamRes, previewRes, thumbsRes, errorRes] = await Promise.allSettled([
			client.render(input),
			collectStream(client.renderStream(input)),
			client.preview(input),
			client.thumbnails(input, { width: 400 }),
			// Step 6 is supposed to fail — empty template triggers a 400.
			// We invert the framing in the report: rejection is the success.
			client.render({ template: '', data: {} }),
		]);

		return new Response(reportHtml({ renderRes, streamRes, previewRes, thumbsRes, errorRes }), {
			headers: { 'content-type': 'text/html; charset=utf-8' },
		});
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

function reportHtml({ renderRes, streamRes, previewRes, thumbsRes, errorRes }) {
	// Step 1: render() → PDF bytes. Offer a download via data URI.
	const renderSection =
		renderRes.status === 'fulfilled'
			? `<p class="ok">✔ ${renderRes.value.byteLength} bytes</p>
       <a class="btn" download="render.pdf"
          href="data:application/pdf;base64,${toBase64(renderRes.value)}">Download render.pdf</a>`
			: `<p class="fail">✗ failed</p>${errorBlock(renderRes.reason)}`;

	// Step 2: renderStream() → same bytes, drained client-side via getReader().
	const streamSection =
		streamRes.status === 'fulfilled'
			? `<p class="ok">✔ ${streamRes.value.byteLength} bytes streamed and concatenated</p>
       <a class="btn" download="stream.pdf"
          href="data:application/pdf;base64,${toBase64(streamRes.value)}">Download stream.pdf</a>`
			: `<p class="fail">✗ failed</p>${errorBlock(streamRes.reason)}`;

	// Step 3: renderToFile is intentionally absent — Node-only sub-export.
	const fileSection = `<p class="skip">Skipped — <code>renderToFile</code> is exposed from
       <code>@poli-page/sdk/node</code> and uses <code>node:fs</code>. Workers don't have a
       filesystem; see the Node demo.</p>`;

	// Step 4: preview() → engine HTML output. Render it inside an iframe
	// via srcdoc so it stays sandboxed from the report page.
	const previewSection =
		previewRes.status === 'fulfilled'
			? `<p class="ok">✔ ${previewRes.value.totalPages} page(s),
       ${previewRes.value.html.length} chars of HTML</p>
       <iframe class="preview" sandbox srcdoc="${esc(previewRes.value.html)}"></iframe>`
			: `<p class="fail">✗ failed</p>${errorBlock(previewRes.reason)}`;

	// Step 5: thumbnails() → base64 page images. Embed each as <img>.
	const thumbsSection =
		thumbsRes.status === 'fulfilled'
			? `<p class="ok">✔ ${thumbsRes.value.length} thumbnail(s)</p>
       <div class="thumbs">${thumbsRes.value
				.map(
					(t) => `<figure>
         <img src="data:${esc(t.contentType)};base64,${esc(t.data)}" alt="page ${t.page}" />
         <figcaption>page ${t.page} (${t.width}×${t.height})</figcaption>
       </figure>`,
				)
				.join('')}</div>`
			: `<p class="fail">✗ failed</p>${errorBlock(thumbsRes.reason)}`;

	// Step 6: error handling. Inverted — the demo passes when the SDK throws
	// a PoliPageError on a deliberately invalid input.
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

  <h2>[1/6] render() — PDF bytes in memory</h2>
  ${renderSection}

  <h2>[2/6] renderStream() — ReadableStream of PDF bytes</h2>
  ${streamSection}

  <h2>[3/6] renderToFile() — Node only (skipped here)</h2>
  ${fileSection}

  <h2>[4/6] preview() — engine HTML output (no PDF rasterization)</h2>
  ${previewSection}

  <h2>[5/6] thumbnails() — base64-encoded page images</h2>
  ${thumbsSection}

  <h2>[6/6] error handling — DEMO ONLY (we trigger an error on purpose)</h2>
  <div class="intentional">
    <strong>This step is intentional.</strong> The SDK is sent an empty template,
    the API returns 400, and the SDK surfaces it as a <code>PoliPageError</code>.
    The demo passes when this error is caught.
  </div>
  ${errorSection}
</body>
</html>`;
}
