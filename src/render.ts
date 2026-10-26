import { PoliPageError } from './error.js';
import type {
	DocumentDescriptor,
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
					err instanceof Error ? err.message : String(err),
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
		throw new PoliPageError(
			'project is required for render.document / render.pdf / render.pdfStream',
			'PROJECT_REQUIRED_FOR_DOCUMENT',
		);
	}
	const response = await ctx.post(
		'/v1/render',
		buildRenderBody(input),
		input.signal,
		input.idempotencyKey,
	);
	const raw = (await response.json()) as RawDocumentDescriptor;
	return attachDownloadPdf(raw);
}

/**
 * Implementation of `client.render.pdf`. Wired by `createRenderNamespace`
 * and not intended for direct caller use.
 *
 * Performs `renderDocument` then fetches the resulting `presignedPdfUrl`
 * to return the bytes. Two HTTP calls under the hood; one call from the
 * caller's perspective.
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
 * (HTTP response, S3 upload, file) without buffering.
 */
export async function renderPdfStream(
	ctx: SdkContext,
	input: RenderInput,
): Promise<ReadableStream<Uint8Array>> {
	const doc = await renderDocument(ctx, input);
	let response: Response;
	try {
		response = await fetch(doc.presignedPdfUrl, { signal: input.signal });
	} catch (err) {
		throw new PoliPageError(
			err instanceof Error ? err.message : String(err),
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
	if (!response.body) {
		throw new PoliPageError('Response has no body', 'INTERNAL_ERROR', response.status);
	}
	return response.body as ReadableStream<Uint8Array>;
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
