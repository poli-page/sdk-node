import { PoliPageError } from './error.js';
import type { RenderInput } from './types.js';

/**
 * Internal handle injected into render functions. The `request` callable
 * encapsulates the SDK's transport layer (retry, idempotency, hooks, auth,
 * timeouts) so render functions only deal with body construction and
 * response shape.
 *
 * @internal
 */
export interface RenderContext {
	request(
		path: string,
		body: object,
		signal?: AbortSignal,
		idempotencyKey?: string,
	): Promise<Response>;
}

/**
 * Implementation of `client.render.pdf`. Wired by `createRenderNamespace`
 * and not intended for direct caller use.
 */
export async function renderPdf(ctx: RenderContext, input: RenderInput): Promise<Uint8Array> {
	const stream = await renderPdfStreamInternal(ctx, input);
	return collectStream(stream);
}

/**
 * Implementation of `client.render.pdfStream`. Wired by `createRenderNamespace`
 * and not intended for direct caller use.
 *
 * Render a PDF and return a `ReadableStream` of its bytes. Use when piping
 * directly to a destination (HTTP response, S3 upload, file) without
 * buffering the full PDF in memory.
 */
export function renderPdfStream(
	ctx: RenderContext,
	input: RenderInput,
): Promise<ReadableStream<Uint8Array>> {
	return renderPdfStreamInternal(ctx, input);
}

/**
 * Strip caller-only fields (`signal`, `idempotencyKey`) and POST to
 * `/v1/render/pdf`. Validates the response content-type before returning
 * the body. Shared between `renderPdf` (buffered) and `renderPdfStream`
 * (streamed) — both call this and then handle the body differently.
 */
async function renderPdfStreamInternal(
	ctx: RenderContext,
	input: RenderInput,
): Promise<ReadableStream<Uint8Array>> {
	const { signal, idempotencyKey, ...wireBody } = input;
	const response = await ctx.request('/v1/render/pdf', wireBody, signal, idempotencyKey);
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('application/pdf')) {
		const requestId = response.headers.get('x-request-id') ?? undefined;
		throw new PoliPageError(
			`Expected application/pdf response, got ${contentType || 'no content-type'}`,
			'INTERNAL_ERROR',
			response.status,
			requestId,
		);
	}
	if (!response.body) {
		throw new PoliPageError('Response has no body', 'INTERNAL_ERROR', response.status);
	}
	return response.body as ReadableStream<Uint8Array>;
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			chunks.push(value);
			total += value.length;
		}
	} finally {
		reader.releaseLock();
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}
