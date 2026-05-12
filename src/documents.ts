import { PoliPageError } from './error.js';
import type { SdkContext } from './render.js';
import type {
	DocumentDescriptor,
	RawDocumentDescriptor,
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
