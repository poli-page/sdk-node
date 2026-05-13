import { PoliPageError } from './error.js';
import type { SdkContext } from './render.js';
import type {
	DocumentDescriptor,
	DocumentPreviewResult,
	DocumentsNamespace,
	RawDocumentDescriptor,
	Thumbnail,
	ThumbnailOptions,
} from './types.js';

/**
 * Attach the `downloadPdf` fluent helper to a raw wire descriptor.
 *
 * Identical to the helper in `src/render.ts` — duplicated inline (6 lines)
 * to avoid a shared-helper file and the circular import that would arise
 * if `render.ts` imported it from `documents.ts` or vice versa.
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
 * Implementation of `client.documents.get`. Wired by `createDocumentsNamespace`
 * (Task 7) and not intended for direct caller use.
 *
 * GETs `/v1/documents/:id`, parses the wire response, and returns a
 * `DocumentDescriptor` with the `downloadPdf` helper attached. Spec §6.1.
 */
export async function documentsGet(ctx: SdkContext, id: string): Promise<DocumentDescriptor> {
	const response = await ctx.get(`/v1/documents/${encodeURIComponent(id)}`);
	const raw = (await response.json()) as RawDocumentDescriptor;
	return attachDownloadPdf(raw);
}

/**
 * Implementation of `client.documents.preview`. Wired by
 * `createDocumentsNamespace` (Task 7).
 *
 * GETs `/v1/documents/:id/preview`, returns the stored paginated HTML.
 * No counter increments — the engine performs no work (spec §6.2).
 */
export async function documentsPreview(
	ctx: SdkContext,
	id: string,
): Promise<DocumentPreviewResult> {
	const response = await ctx.get(`/v1/documents/${encodeURIComponent(id)}/preview`);
	return response.json() as Promise<DocumentPreviewResult>;
}

/**
 * Implementation of `client.documents.thumbnails`. Wired by
 * `createDocumentsNamespace`.
 *
 * POSTs `/v1/documents/:id/thumbnails` with the options object nested
 * under a `thumbnails` key (deployed-API wire shape). Unwraps the server
 * envelope `{ thumbnails: [...] }` from the response and returns the array.
 */
export async function documentsThumbnails(
	ctx: SdkContext,
	id: string,
	options: ThumbnailOptions,
): Promise<Thumbnail[]> {
	const response = await ctx.post(
		`/v1/documents/${encodeURIComponent(id)}/thumbnails`,
		{ thumbnails: options },
	);
	const result = (await response.json()) as { thumbnails: Thumbnail[] };
	return result.thumbnails;
}

/**
 * Implementation of `client.documents.delete`. Wired by
 * `createDocumentsNamespace` (Task 7).
 *
 * DELETEs `/v1/documents/:id`. Returns void; the response body is
 * ignored. Spec §6.4.
 *
 * Note: a re-delete of an already-deleted document surfaces as
 * `PoliPageError` with `code: 'GONE'` (HTTP 410) from the transport
 * layer — no special handling here.
 */
export async function documentsDelete(ctx: SdkContext, id: string): Promise<void> {
	await ctx.delete(`/v1/documents/${encodeURIComponent(id)}`);
}

/**
 * Build the object exposed as `client.documents`. Each method captures the
 * provided `ctx` and forwards to the corresponding free function.
 *
 * @internal
 */
export function createDocumentsNamespace(ctx: SdkContext): DocumentsNamespace {
	return {
		get: (id) => documentsGet(ctx, id),
		preview: (id) => documentsPreview(ctx, id),
		thumbnails: (id, options) => documentsThumbnails(ctx, id, options),
		delete: (id) => documentsDelete(ctx, id),
	};
}
