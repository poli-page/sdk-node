/**
 * Poli Page SDK for Node.js — public surface.
 *
 * The behavioural contract (options, defaults, errors, retry policy, HTTP rules)
 * is shared across every official Poli Page SDK.
 */

export type {
	PageFormat,
	Orientation,
	ProjectModeInput,
	InlineModeInput,
	RenderInput,
	RenderMetadata,
	RenderNamespace,
	DocumentDescriptor,
	PreviewResult,
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
} from './types.js';

export { PoliPageError, type PoliPageErrorCode } from './error.js';
import { PoliPageError } from './error.js';
import { createRenderNamespace, type SdkContext } from './render.js';
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
 *   version: '1.0.0',
 *   data: { invoiceNumber: 'INV-001', total: 1280 },
 * });
 * ```
 */
export class PoliPage {
	readonly render: RenderNamespace;

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
			clearTimeout(timeoutId);
			if (signal?.aborted) {
				const abortedError = new PoliPageError('Request was aborted', 'aborted');
				this.#fireHook(this.#onError, abortedError);
				throw abortedError;
			}
			const aborted = err instanceof Error && err.name === 'AbortError';
			const error = new PoliPageError(
				aborted ? `Request timed out after ${this.#timeout}ms` : (err as Error).message,
				aborted ? 'timeout' : 'network_error',
			);
			return { ok: false, error, retryAfterMs: undefined, retryable: true };
		}
		clearTimeout(timeoutId);

		if (response.ok) {
			this.#fireHook(this.#onResponse, {
				status: response.status,
				requestId: response.headers.get('x-request-id') ?? undefined,
				durationMs: Date.now() - t0,
			});
			return { ok: true, response };
		}

		const requestId = response.headers.get('x-request-id') ?? undefined;
		const retryable = response.status >= 500 || response.status === 429;
		const retryAfterMs = retryable
			? parseRetryAfter(response.headers.get('retry-after'))
			: undefined;

		const errorBody = await response.text();
		const { code, message } = parseErrorBody(errorBody, response.status);
		const error = new PoliPageError(message, code, response.status, requestId);

		return { ok: false, error, retryAfterMs, retryable };
	}

	#sleep(ms: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, ms);
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
