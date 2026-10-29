import { PoliPageError } from '../error.js';
import type { DocumentDescriptor, RawDocumentDescriptor } from '../types.js';

/**
 * The error for a download that failed without an HTTP status, whether before
 * the headers or while reading the body: `aborted` when `signal` aborted it,
 * else `DOWNLOAD_FAILED` without a status. The underlying error is the cause.
 */
function downloadFailure(err: unknown, signal: AbortSignal | undefined): PoliPageError {
	if (signal?.aborted) {
		return new PoliPageError('Request was aborted', 'aborted', undefined, undefined, {
			cause: err,
		});
	}
	return new PoliPageError(
		'Failed to download PDF: network error',
		'DOWNLOAD_FAILED',
		undefined,
		undefined,
		{ cause: err },
	);
}

/**
 * GET a presigned PDF URL: a plain `fetch` to object storage, with no SDK
 * auth, no `Idempotency-Key` and no retry. A non-2xx answer raises
 * `DOWNLOAD_FAILED` with the storage status; a network failure raises
 * `DOWNLOAD_FAILED` without one; a cancellation through `signal` raises
 * `aborted`. The body is read with `readPresignedPdf` or
 * `streamPresignedPdf`, which map body-read failures the same way.
 *
 * @internal
 */
export async function fetchPresignedPdf(url: string, signal?: AbortSignal): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(url, { signal });
	} catch (err) {
		throw downloadFailure(err, signal);
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
 * Read a presigned download's whole body. A cancellation or a dropped
 * connection mid-body raises `aborted` or `DOWNLOAD_FAILED`, never a raw
 * `fetch` error.
 *
 * @internal
 */
export async function readPresignedPdf(
	response: Response,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	try {
		return new Uint8Array(await response.arrayBuffer());
	} catch (err) {
		throw downloadFailure(err, signal);
	}
}

/**
 * The body of a presigned download as a stream whose read errors are SDK
 * errors: a cancellation or a dropped connection mid-body errors the stream
 * with `aborted` or `DOWNLOAD_FAILED`, never a raw `fetch` error.
 *
 * @internal
 */
export function streamPresignedPdf(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): ReadableStream<Uint8Array> {
	const reader = body.getReader();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) controller.close();
				else controller.enqueue(value);
			} catch (err) {
				controller.error(downloadFailure(err, signal));
			}
		},
		cancel(reason) {
			return reader.cancel(reason);
		},
	});
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
			return readPresignedPdf(response, options?.signal);
		},
	};
}
