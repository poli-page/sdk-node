import { PoliPageError } from './error.js';
import type { SdkContext } from './render.js';
import type {
	DocumentDescriptor,
	PreviewResult,
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
): Promise<PreviewResult> {
	const response = await ctx.get(`/v1/documents/${encodeURIComponent(id)}/preview`);
	return response.json() as Promise<PreviewResult>;
}

/**
 * Implementation of `client.documents.thumbnails`. Wired by
 * `createDocumentsNamespace` (Task 7).
 *
 * POSTs `/v1/documents/:id/thumbnails` with the options object as the
 * request body. Unwraps the server envelope `{ thumbnails: [...] }` and
 * returns the array. Spec §6.3.
 */
export async function documentsThumbnails(
	ctx: SdkContext,
	id: string,
	options: ThumbnailOptions,
): Promise<Thumbnail[]> {
	const response = await ctx.post(
		`/v1/documents/${encodeURIComponent(id)}/thumbnails`,
		options,
	);
	const result = (await response.json()) as { thumbnails: Thumbnail[] };
	return result.thumbnails;
}
