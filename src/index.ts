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
				await this.#sleep(delay, signal);
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
			// The whole answer is read inside the attempt, under its timeout: a
			// connection dropped or stalled mid-body is a failed attempt like any
			// other (network_error or timeout, retried), never a raw fetch error
			// once the caller parses the body.
			answer = await response.arrayBuffer();
		} catch (err) {
			if (signal?.aborted) {
				const abortedError = new PoliPageError('Request was aborted', 'aborted', undefined, undefined, {
					cause: err,
				});
				this.#fireHook(this.#onError, abortedError);
				throw abortedError;
			}
			// The messages are the exact texts of the SDK specification; the fetch
			// failure itself stays available as `cause`.
			const timedOut = timeoutController.signal.aborted;
			const error = new PoliPageError(
				timedOut ? `Request timed out after ${this.#timeout}ms` : 'Network request failed',
				timedOut ? 'timeout' : 'network_error',
				undefined,
				undefined,
				{ cause: err },
			);
			return { ok: false, error, retryAfterMs: undefined, retryable: true };
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

		const requestId = response.headers.get('x-request-id') ?? undefined;
		const errorBody = new TextDecoder().decode(answer);
		const { code, message } = parseErrorBody(errorBody, response.status);
		const error = new PoliPageError(message, code, response.status, requestId);

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
			const wake = () => {
				const left = end - performance.now();
				if (left > 0) timer = setTimeout(wake, Math.ceil(left));
				else resolve();
			};
			let timer = setTimeout(wake, ms);
			if (signal) {
				const onAbort = () => {
					clearTimeout(timer);
					reject(new PoliPageError('Request was aborted', 'aborted'));
				};
				if (signal.aborted) {
					onAbort();
				} else {
					signal.addEventListener('abort', onAbort, { once: true });
				}
			}
		});
	}
}
