import { PoliPageError } from './error.js';
import type {
	DocumentDescriptor,
	PreviewResult,
	RawDocumentDescriptor,
	RenderInput,
	RenderNamespace,
} from './types.js';

/**
 * The transport seam used by all namespace factories. Three named callables,
 * one per verb. Each delegates to PoliPage's `#request` method, which owns
 * auth, retry, idempotency, hooks, abort, and timeout.
 *
 * @internal
 */
export interface SdkContext {
	post(
		path: string,
		body: object,
		signal?: AbortSignal,
		idempotencyKey?: string,
	): Promise<Response>;
	get(path: string, signal?: AbortSignal): Promise<Response>;
	delete(path: string, signal?: AbortSignal): Promise<Response>;
}

/**
 * Implementation of `client.render.pdf`. Wired by `createRenderNamespace`
 * and not intended for direct caller use.
 */
export async function renderPdf(ctx: SdkContext, input: RenderInput): Promise<Uint8Array> {
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
	ctx: SdkContext,
	input: RenderInput,
): Promise<ReadableStream<Uint8Array>> {
	return renderPdfStreamInternal(ctx, input);
}

/**
 * Implementation of `client.render.preview`. Wired by `createRenderNamespace`
 * and not intended for direct caller use.
 *
 * Calls `POST /v1/render/preview` and returns the parsed `PreviewResult`,
 * including optional `metadata` echo per spec §5.2.
 */
export async function renderPreview(
	ctx: SdkContext,
	input: RenderInput,
): Promise<PreviewResult> {
	const { signal, idempotencyKey, ...wireBody } = input;
	const response = await ctx.post('/v1/render/preview', wireBody, signal, idempotencyKey);
	return response.json() as Promise<PreviewResult>;
}

/**
 * Strip caller-only fields (`signal`, `idempotencyKey`) and POST to
 * `/v1/render/pdf`. Validates the response content-type before returning
 * the body. Shared between `renderPdf` (buffered) and `renderPdfStream`
 * (streamed) — both call this and then handle the body differently.
 */
async function renderPdfStreamInternal(
	ctx: SdkContext,
	input: RenderInput,
): Promise<ReadableStream<Uint8Array>> {
	const { signal, idempotencyKey, ...wireBody } = input;
	const response = await ctx.post('/v1/render/pdf', wireBody, signal, idempotencyKey);
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

/**
 * Attach the `downloadPdf` fluent helper to a raw wire descriptor. The
 * helper uses plain `fetch` against the presigned S3 URL — no SDK auth,
 * no retry, no idempotency. Errors are wrapped in `PoliPageError` for
 * consistency with the rest of the SDK.
 *
 * Duplicated identically in `src/documents.ts` to avoid a circular import
 * or a single-helper file.
 *
 * @internal
 */
function attachDownloadPdf(raw: RawDocumentDescriptor): DocumentDescriptor {
	return {
		...raw,
		async downloadPdf(options) {
			let response: Response;
			try {
				response = await fetch(raw.presignedPdfUrl, { signal: options?.signal });
			} catch (err) {
				throw new PoliPageError(
					(err as Error).message,
					'DOWNLOAD_FAILED',
				);
			}
			if (!response.ok) {
				throw new PoliPageError(
					`Failed to download PDF: ${response.status} ${response.statusText}`,
					'DOWNLOAD_FAILED',
					response.status,
				);
			}
			return new Uint8Array(await response.arrayBuffer());
		},
	};
}

/**
 * Implementation of `client.render.document`. Wired by `createRenderNamespace`
 * and not intended for direct caller use.
 *
 * POSTs to `/v1/render/document`, parses the JSON wire response, and attaches
 * the `downloadPdf` fluent helper before returning. Spec §5.3.
 */
export async function renderDocument(
	ctx: SdkContext,
	input: RenderInput,
): Promise<DocumentDescriptor> {
	const { signal, idempotencyKey, ...wireBody } = input;
	const response = await ctx.post('/v1/render/document', wireBody, signal, idempotencyKey);
	const raw = (await response.json()) as RawDocumentDescriptor;
	return attachDownloadPdf(raw);
}

/**
 * Build the object exposed as `client.render`. Each method captures the
 * provided `ctx` and forwards to the corresponding free function.
 *
 * @internal
 */
export function createRenderNamespace(ctx: SdkContext): RenderNamespace {
	return {
		pdf: (input) => renderPdf(ctx, input),
		pdfStream: (input) => renderPdfStream(ctx, input),
		preview: (input) => renderPreview(ctx, input),
		document: (input) => renderDocument(ctx, input),
	};
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
