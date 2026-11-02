import { PoliPageError } from './error.js';
import { attachDownloadPdf, streamPresignedPdf } from './internal/download.js';
import type {
	DocumentDescriptor,
	RawDocumentDescriptor,
	RenderInput,
	RenderNamespace,
} from './types.js';

/**
 * The transport seam used by all namespace factories. Three named callables,
 * one per verb. Each delegates to PoliPage's `#request` method, which owns
 * auth, retry, idempotency, hooks, abort, and timeout. `json` reads a 2xx
 * answer that must be JSON (else `invalid_response`, reported to `onError`),
 * and `timeout` is the client's, which also bounds the presigned download.
 *
 * @internal
 */
export interface SdkContext {
	readonly timeout: number;
	json(response: Response): Promise<unknown>;
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
 * Build the `POST /v1/render` body from the seven documented fields only.
 * A JavaScript caller is not held to the types, and the API rejects unknown
 * fields with `400 VALIDATION_ERROR`, so nothing else the input carries
 * (`version`, `environment`, …) is sent. Unset optional fields stay
 * `undefined`, which `JSON.stringify` omits from the wire body.
 */
function buildRenderBody(input: RenderInput): object {
	const { project, template, data, metadata, format, orientation, locale } = input;
	return { project, template, data, metadata, format, orientation, locale };
}

/**
 * Implementation of `client.render.document`. Wired by `createRenderNamespace`
 * and not intended for direct caller use.
 *
 * POSTs to `/v1/render`, parses the JSON wire response into a
 * `DocumentDescriptor` with the `downloadPdf` helper attached. Per the
 * deployed API: every render produces a stored document.
 */
export async function renderDocument(
	ctx: SdkContext,
	input: RenderInput,
): Promise<DocumentDescriptor> {
	if (!input.project) {
		throw new PoliPageError('project is required', 'PROJECT_REQUIRED_FOR_DOCUMENT');
	}
	const response = await ctx.post(
		'/v1/render',
		buildRenderBody(input),
		input.signal,
		input.idempotencyKey,
	);
	const raw = (await ctx.json(response)) as RawDocumentDescriptor;
	return attachDownloadPdf(raw, ctx.timeout);
}

/**
 * Implementation of `client.render.pdf`. Wired by `createRenderNamespace`
 * and not intended for direct caller use.
 *
 * Performs `renderDocument` then fetches the resulting `presignedPdfUrl`
 * to return the bytes. Two HTTP calls under the hood; one call from the
 * caller's perspective. The client's `timeout` bounds the whole download.
 */
export async function renderPdf(
	ctx: SdkContext,
	input: RenderInput,
): Promise<Uint8Array> {
	const doc = await renderDocument(ctx, input);
	return doc.downloadPdf({ signal: input.signal });
}

/**
 * Implementation of `client.render.pdfStream`. Wired by `createRenderNamespace`
 * and not intended for direct caller use.
 *
 * Like `renderPdf` but returns the response body as a `ReadableStream`
 * instead of buffering. Use when piping directly to a destination
 * (HTTP response, S3 upload, file) without buffering. The client's
 * `timeout` is an idle timeout on the download: the wait for the first byte
 * (read before this resolves) and each wait for the next chunk. A
 * cancellation, a dropped connection or an idle timeout while the stream is
 * read errors it with `aborted` or `DOWNLOAD_FAILED`.
 */
export async function renderPdfStream(
	ctx: SdkContext,
	input: RenderInput,
): Promise<ReadableStream<Uint8Array>> {
	const doc = await renderDocument(ctx, input);
	return streamPresignedPdf(doc.presignedPdfUrl, ctx.timeout, input.signal);
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
		document: (input) => renderDocument(ctx, input),
	};
}
