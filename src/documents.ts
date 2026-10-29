import { attachDownloadPdf } from './internal/download.js';
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
 * `createDocumentsNamespace`.
 *
 * GETs `/v1/documents/:id/preview` and returns the stored paginated HTML.
 * The deployed API responds with `text/html` directly (not a JSON envelope)
 * and exposes the page count via the `X-Document-Page-Count` response
 * header — the SDK assembles the `DocumentPreviewResult` envelope here.
 * No counter increments — the engine performs no work.
 */
export async function documentsPreview(
	ctx: SdkContext,
	id: string,
): Promise<DocumentPreviewResult> {
	const response = await ctx.get(`/v1/documents/${encodeURIComponent(id)}/preview`);
	const html = await response.text();
	const raw = response.headers.get('X-Document-Page-Count');
	const parsed = raw !== null ? Number.parseInt(raw, 10) : Number.NaN;
	const pageCount = Number.isFinite(parsed) ? parsed : 0;
	return { html, pageCount };
}

/**
 * Implementation of `client.documents.thumbnails`. Wired by
 * `createDocumentsNamespace`.
 *
 * POSTs `/v1/documents/:id/thumbnails` with the options object nested
 * under a `thumbnails` key (deployed-API wire shape), or `{}` when no option
 * is set so every API default applies. Options are not range-checked here:
 * the API answers `400 VALIDATION_ERROR`. Unwraps the server envelope
 * `{ thumbnails: [...] }` from the response and returns the array.
 */
export async function documentsThumbnails(
	ctx: SdkContext,
	id: string,
	options?: ThumbnailOptions,
): Promise<Thumbnail[]> {
	const anySet = options !== undefined && Object.values(options).some((v) => v !== undefined);
	const response = await ctx.post(
		`/v1/documents/${encodeURIComponent(id)}/thumbnails`,
		anySet ? { thumbnails: options } : {},
	);
	const result = (await response.json()) as { thumbnails: Thumbnail[] };
	return result.thumbnails;
}

/**
 * Implementation of `client.documents.delete`. Wired by
 * `createDocumentsNamespace`.
 *
 * DELETEs `/v1/documents/:id`. Returns void; the response body is
 * ignored. Spec §6.4. Idempotent: the API answers `204` for an
 * already-deleted document too.
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
