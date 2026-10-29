import { PoliPageError } from '../error.js';
import type { DocumentDescriptor, RawDocumentDescriptor } from '../types.js';

/**
 * GET a presigned PDF URL: a plain `fetch` to object storage, with no SDK
 * auth, no `Idempotency-Key` and no retry. A non-2xx answer raises
 * `DOWNLOAD_FAILED` with the storage status; a network failure raises
 * `DOWNLOAD_FAILED` without one; a cancellation through `signal` raises
 * `aborted`.
 *
 * @internal
 */
export async function fetchPresignedPdf(url: string, signal?: AbortSignal): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(url, { signal });
	} catch (err) {
		if (signal?.aborted) {
			throw new PoliPageError('Request was aborted', 'aborted', undefined, undefined, {
				cause: err,
			});
		}
		throw new PoliPageError(
			'Failed to download PDF: network error',
			'DOWNLOAD_FAILED',
			undefined,
			undefined,
			{ cause: err },
		);
	}
	if (!response.ok) {
		throw new PoliPageError(
			`Failed to download PDF: HTTP ${response.status}`,
			'DOWNLOAD_FAILED',
			response.status,
		);
	}
	return response;
}

/**
 * Attach the `downloadPdf` fluent helper to a raw wire descriptor.
 *
 * @internal
 */
export function attachDownloadPdf(raw: RawDocumentDescriptor): DocumentDescriptor {
	return {
		...raw,
		async downloadPdf(options) {
			const response = await fetchPresignedPdf(raw.presignedPdfUrl, options?.signal);
			return new Uint8Array(await response.arrayBuffer());
		},
	};
}
