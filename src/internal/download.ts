import { PoliPageError } from '../error.js';
import { startTimer } from './timer.js';
import type { DocumentDescriptor, RawDocumentDescriptor } from '../types.js';

/**
 * The client's `timeout` around a presigned download, composed with the
 * caller's signal. `arm()` starts a wait, `disarm()` ends it; when a wait
 * outlasts `timeoutMs`, the timer aborts the download, and `timedOut` tells
 * that abort apart from a network failure or a cancellation.
 */
class DownloadTimer {
	readonly signal: AbortSignal;
	readonly #controller = new AbortController();
	readonly #timeoutMs: number;
	#cancel: (() => void) | undefined;

	constructor(timeoutMs: number, callerSignal: AbortSignal | undefined) {
		this.#timeoutMs = timeoutMs;
		this.signal = callerSignal
			? AbortSignal.any([callerSignal, this.#controller.signal])
			: this.#controller.signal;
	}

	/** True once the timer fired: only then is a failure labelled `timeout`. */
	get timedOut(): boolean {
		return this.#controller.signal.aborted;
	}

	arm(): void {
		this.disarm();
		this.#cancel = startTimer(this.#timeoutMs, () => this.#controller.abort());
	}

	disarm(): void {
		this.#cancel?.();
		this.#cancel = undefined;
	}
}

/**
 * The error for a download that failed without an HTTP status, whether before
 * the headers or while reading the body: `aborted` when the caller's `signal`
 * aborted it, `DOWNLOAD_FAILED` with `Failed to download PDF: timeout` when the
 * client's `timeout` fired, else `DOWNLOAD_FAILED` with
 * `Failed to download PDF: network error` (a refused or dropped connection, a
 * body that ends short of its `Content-Length`). The underlying error is the
 * cause.
 */
function downloadFailure(
	err: unknown,
	signal: AbortSignal | undefined,
	timer: DownloadTimer,
): PoliPageError {
	if (signal?.aborted) {
		return new PoliPageError('Request was aborted', 'aborted', undefined, undefined, {
			cause: err,
		});
	}
	return new PoliPageError(
		timer.timedOut ? 'Failed to download PDF: timeout' : 'Failed to download PDF: network error',
		'DOWNLOAD_FAILED',
		undefined,
		undefined,
		{ cause: err },
	);
}

/**
 * GET a presigned PDF URL: a plain `fetch` to object storage, with no SDK
 * auth, no `Idempotency-Key` and no retry. A non-2xx answer raises
 * `DOWNLOAD_FAILED` with the storage status; a failure without an answer
 * raises what `downloadFailure` maps it to.
 */
async function fetchPresignedPdf(
	url: string,
	signal: AbortSignal | undefined,
	timer: DownloadTimer,
): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(url, { signal: timer.signal });
	} catch (err) {
		throw downloadFailure(err, signal, timer);
	}
	if (!response.ok) {
		// Free the connection: the error body is not read.
		response.body?.cancel().catch(() => {});
		throw new PoliPageError(
			`Failed to download PDF: HTTP ${response.status}`,
			'DOWNLOAD_FAILED',
			response.status,
		);
	}
	return response;
}

/**
 * Download a presigned PDF in full. `timeoutMs` bounds the whole download,
 * from the request to the last byte of the body; `signal` cancels it
 * (`aborted`).
 *
 * @internal
 */
export async function downloadPresignedPdf(
	url: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	const timer = new DownloadTimer(timeoutMs, signal);
	timer.arm();
	try {
		const response = await fetchPresignedPdf(url, signal, timer);
		try {
			return new Uint8Array(await response.arrayBuffer());
		} catch (err) {
			throw downloadFailure(err, signal, timer);
		}
	} finally {
		timer.disarm();
	}
}

/**
 * Download a presigned PDF as a stream. `timeoutMs` is an idle timeout: it
 * bounds the wait for the first byte of the body, which this function reads
 * before it returns (so a download that never starts raises here), then each
 * wait for the next chunk once the stream asks for it. Time the caller spends
 * between reads is not counted, so a large PDF read at the caller's pace is
 * not cut off. A failure after the first byte errors the stream with the
 * same errors as `downloadPresignedPdf`, never a raw `fetch` error.
 *
 * @internal
 */
export async function streamPresignedPdf(
	url: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
	const timer = new DownloadTimer(timeoutMs, signal);
	let reader: ReadableStreamDefaultReader<Uint8Array>;
	let first: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>;
	timer.arm();
	try {
		const response = await fetchPresignedPdf(url, signal, timer);
		if (!response.body) {
			throw new PoliPageError('Response has no body', 'INTERNAL_ERROR', response.status);
		}
		reader = (response.body as ReadableStream<Uint8Array>).getReader();
		try {
			first = await reader.read();
		} catch (err) {
			throw downloadFailure(err, signal, timer);
		}
	} finally {
		timer.disarm();
	}

	let pending: Uint8Array | undefined = first.done ? undefined : first.value;
	let ended = first.done;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (pending !== undefined) {
				controller.enqueue(pending);
				pending = undefined;
				return;
			}
			if (ended) {
				controller.close();
				return;
			}
			timer.arm();
			try {
				const { done, value } = await reader.read();
				if (done) {
					ended = true;
					controller.close();
				} else {
					controller.enqueue(value);
				}
			} catch (err) {
				controller.error(downloadFailure(err, signal, timer));
			} finally {
				timer.disarm();
			}
		},
		cancel(reason) {
			timer.disarm();
			return reader.cancel(reason);
		},
	});
}

/**
 * Attach the `downloadPdf` fluent helper to a raw wire descriptor. The
 * download is bounded by the client's `timeoutMs`.
 *
 * @internal
 */
export function attachDownloadPdf(
	raw: RawDocumentDescriptor,
	timeoutMs: number,
): DocumentDescriptor {
	return {
		...raw,
		downloadPdf(options) {
			return downloadPresignedPdf(raw.presignedPdfUrl, timeoutMs, options?.signal);
		},
	};
}
