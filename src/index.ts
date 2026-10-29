/**
 * Poli Page SDK for Node.js — public surface.
 *
 * The behavioural contract (options, defaults, errors, retry policy, HTTP rules)
 * is shared across every official Poli Page SDK.
 */

export type {
	PageFormat,
	Orientation,
	RenderInput,
	RenderMetadata,
	RenderNamespace,
	DocumentsNamespace,
	DocumentsRequestOptions,
	DocumentDescriptor,
	DocumentPreviewResult,
	Thumbnail,
	ThumbnailOptions,
	PoliPageOptions,
	RequestEvent,
	ResponseEvent,
	RetryEvent,
} from './types.js';

import type {
	PoliPageOptions,
	RequestEvent,
	ResponseEvent,
	RetryEvent,
	RenderNamespace,
	DocumentsNamespace,
} from './types.js';

export { PoliPageError, type PoliPageErrorCode } from './error.js';
import { PoliPageError } from './error.js';
import { createRenderNamespace, type SdkContext } from './render.js';
import { createDocumentsNamespace } from './documents.js';
import { parseRetryAfter, computeBackoff, parseErrorBody, buildHeaders } from './internal/http.js';

type SendOnceResult =
	| { ok: true; response: Response }
	| { ok: false; error: PoliPageError; retryAfterMs: number | undefined; retryable: boolean };

const DEFAULT_BASE_URL = 'https://api.poli.page';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 500;
const DEFAULT_TIMEOUT = 60_000;

/**
 * Poli Page client. Entry point for the namespaced render API.
 *
 * @example
 * ```ts
 * import { PoliPage } from '@poli-page/sdk';
 *
 * const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });
 *
 * const pdf = await client.render.pdf({
 *   project: 'billing',
 *   template: 'invoice',
 *   data: { invoiceNumber: 'INV-001', total: 1280 },
 * });
 * ```
 */
export class PoliPage {
	readonly render: RenderNamespace;
	readonly documents: DocumentsNamespace;

	readonly #apiKey: string;
	readonly #baseUrl: string;
	readonly #maxRetries: number;
	readonly #retryDelay: number;
	readonly #timeout: number;
	readonly #onRequest?: (e: RequestEvent) => void;
	readonly #onResponse?: (e: ResponseEvent) => void;
	readonly #onRetry?: (e: RetryEvent) => void;
	readonly #onError?: (err: PoliPageError) => void;

	constructor(options: PoliPageOptions) {
		if (!options.apiKey) {
			throw new PoliPageError('apiKey is required', 'invalid_options');
		}
		this.#apiKey = options.apiKey;
		this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
		this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
		this.#retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;
		this.#timeout = options.timeout ?? DEFAULT_TIMEOUT;
		this.#onRequest = options.onRequest;
		this.#onResponse = options.onResponse;
		this.#onRetry = options.onRetry;
		this.#onError = options.onError;

		const ctx: SdkContext = {
			post: (path, body, signal, key) => this.#request('POST', path, body, signal, key),
			get: (path, signal) => this.#request('GET', path, undefined, signal),
			delete: (path, signal) => this.#request('DELETE', path, undefined, signal),
		};
		this.render = createRenderNamespace(ctx);
		this.documents = createDocumentsNamespace(ctx);
	}

	#fireHook<T>(hook: ((e: T) => void) | undefined, event: T): void {
		if (!hook) return;
		try {
			hook(event);
		} catch {
			// Hooks must not break the request.
		}
	}

	async #request(
		method: 'GET' | 'POST' | 'DELETE',
		path: string,
		body: object | undefined,
		signal?: AbortSignal,
		callerIdempotencyKey?: string,
	): Promise<Response> {
		const idempotencyKey = method === 'POST'
			? (callerIdempotencyKey ?? globalThis.crypto.randomUUID())
			: undefined;
		return this.#runWithRetry(method, path, body, idempotencyKey, signal);
	}

	async #runWithRetry(
		method: 'GET' | 'POST' | 'DELETE',
		path: string,
		body: object | undefined,
		idempotencyKey: string | undefined,
		signal: AbortSignal | undefined,
	): Promise<Response> {
		if (signal?.aborted) {
			const abortedError = new PoliPageError('Request was aborted', 'aborted');
			this.#fireHook(this.#onError, abortedError);
			throw abortedError;
		}

		let lastError: PoliPageError | undefined;
		let nextRetryAfterMs: number | undefined;

		for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
			if (attempt > 0) {
				const delay = computeBackoff(attempt, this.#retryDelay, nextRetryAfterMs);
				this.#fireHook(this.#onRetry, {
					attempt: attempt + 1,
					delayMs: delay,
					reason: lastError!,
				});
				try {
					await this.#sleep(delay, signal);
				} catch (err) {
					// Only a cancellation rejects the wait (`aborted`, never retried).
					if (err instanceof PoliPageError) this.#fireHook(this.#onError, err);
					throw err;
				}
			}

			const result = await this.#sendOnce(method, path, body, idempotencyKey, attempt + 1, signal);

			if (result.ok) return result.response;

			lastError = result.error;
			nextRetryAfterMs = result.retryAfterMs;

			if (!result.retryable) {
				this.#fireHook(this.#onError, lastError);
				throw lastError;
			}
		}

		this.#fireHook(this.#onError, lastError!);
		throw lastError!;
	}

	async #sendOnce(
		method: 'GET' | 'POST' | 'DELETE',
		path: string,
		body: object | undefined,
		idempotencyKey: string | undefined,
		attempt: number,
		signal: AbortSignal | undefined,
	): Promise<SendOnceResult> {
		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), this.#timeout);
		const composed = signal
			? AbortSignal.any([signal, timeoutController.signal])
			: timeoutController.signal;

		this.#fireHook(this.#onRequest, {
			method,
			url: `${this.#baseUrl}${path}`,
			attempt,
		});

		const t0 = Date.now();
		let response: Response;
		let answer: ArrayBuffer;
		try {
			try {
				response = await fetch(`${this.#baseUrl}${path}`, {
					method,
					headers: buildHeaders(
						method,
						path,
						this.#apiKey,
						idempotencyKey,
						`poli-page-sdk-node/${__SDK_VERSION__}`,
					),
					body: method === 'POST' ? JSON.stringify(body) : undefined,
					signal: composed,
				});
			} catch (err) {
				return this.#transportFailure(err, signal, timeoutController.signal);
			}
			// The whole answer is read inside the attempt, under its timeout, so a
			// body cut or stalled mid-way is a failed attempt, never a raw fetch
			// error once the caller parses it.
			try {
				answer = await response.arrayBuffer();
			} catch (err) {
				if (response.ok || signal?.aborted) {
					// A 2xx whose body fails: network_error or timeout, retried; a
					// cancellation: aborted, whatever the status.
					return this.#transportFailure(err, signal, timeoutController.signal);
				}
				// An error answer whose body fails keeps its status, like a body that
				// is not JSON (SDK specification §8.2): INTERNAL_ERROR, `HTTP <status>`,
				// retried according to the status.
				return this.#apiFailure(response, '', err);
			}
		} finally {
			clearTimeout(timeoutId);
		}

		if (response.ok) {
			this.#fireHook(this.#onResponse, {
				status: response.status,
				requestId: response.headers.get('x-request-id') ?? undefined,
				durationMs: Date.now() - t0,
			});
			// Hand the caller an answer whose body is already in memory. A 204 (or
			// any empty answer) keeps a null body, as `Response` requires for 204.
			return {
				ok: true,
				response: new Response(answer.byteLength === 0 ? null : answer, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				}),
			};
		}

		return this.#apiFailure(response, new TextDecoder().decode(answer));
	}

	/**
	 * A failed attempt with no HTTP answer to report: the caller's abort throws
	 * `aborted` at once (after `onError`); otherwise `timeout` when the attempt
	 * timer fired, else `network_error`, both retried. The messages are the
	 * exact texts of the SDK specification; the fetch failure is the `cause`.
	 */
	#transportFailure(
		err: unknown,
		signal: AbortSignal | undefined,
		timeoutSignal: AbortSignal,
	): SendOnceResult {
		if (signal?.aborted) {
			const abortedError = new PoliPageError(
				'Request was aborted',
				'aborted',
				undefined,
				undefined,
				{ cause: err },
			);
			this.#fireHook(this.#onError, abortedError);
			throw abortedError;
		}
		const timedOut = timeoutSignal.aborted;
		const error = new PoliPageError(
			timedOut ? `Request timed out after ${this.#timeout}ms` : 'Network request failed',
			timedOut ? 'timeout' : 'network_error',
			undefined,
			undefined,
			{ cause: err },
		);
		return { ok: false, error, retryAfterMs: undefined, retryable: true };
	}

	/**
	 * A non-2xx API answer, from its body text (`''` when the body could not be
	 * read, which `parseErrorBody` treats as a body that is not JSON).
	 */
	#apiFailure(response: Response, errorBody: string, cause?: unknown): SendOnceResult {
		const requestId = response.headers.get('x-request-id') ?? undefined;
		const { code, message } = parseErrorBody(errorBody, response.status);
		const error = new PoliPageError(
			message,
			code,
			response.status,
			requestId,
			cause === undefined ? undefined : { cause },
		);

		// One rule for the retry loop and for `isRetryable()`: 5xx and 429 are
		// retried, except the codes that waiting cannot fix (quota, storage access).
		const retryable = error.isRetryable();
		const retryAfterMs = retryable
			? parseRetryAfter(response.headers.get('retry-after'))
			: undefined;

		return { ok: false, error, retryAfterMs, retryable };
	}

	#sleep(ms: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			// A timer can fire up to about 1 ms early: re-arm until the whole delay
			// has passed, so a `Retry-After` wait is never shorter than asked.
			const end = performance.now() + ms;
			const onAbort = () => {
				clearTimeout(timer);
				reject(new PoliPageError('Request was aborted', 'aborted'));
			};
			const wake = () => {
				const left = end - performance.now();
				if (left > 0) {
					timer = setTimeout(wake, Math.ceil(left));
				} else {
					// The wait ended normally: drop the listener, so a long-lived
					// signal shared by many calls does not collect one per retry.
					signal?.removeEventListener('abort', onAbort);
					resolve();
				}
			};
			let timer = setTimeout(wake, ms);
			if (signal?.aborted) {
				onAbort();
			} else {
				signal?.addEventListener('abort', onAbort, { once: true });
			}
		});
	}
}
