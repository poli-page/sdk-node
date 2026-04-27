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
	PreviewResult,
	Thumbnail,
	ThumbnailOptions,
	PoliPageOptions,
	RequestEvent,
	ResponseEvent,
	RetryEvent,
} from './types.js';

import type { RenderInput, PreviewResult, Thumbnail, ThumbnailOptions, PoliPageOptions, RequestEvent, ResponseEvent, RetryEvent } from './types.js';

export { PoliPageError, type PoliPageErrorCode } from './error.js';
import { PoliPageError } from './error.js';
import { parseRetryAfter, computeBackoff, parseErrorBody, buildHeaders } from './internal/http.js';

type SendOnceResult =
	| { ok: true; response: Response }
	| { ok: false; error: PoliPageError; retryAfterMs: number | undefined; retryable: boolean };

const DEFAULT_BASE_URL = 'https://api.poli.page';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 500;
const DEFAULT_TIMEOUT = 60_000;

/**
 * Poli Page client. Single entry point for rendering PDFs, previewing
 * paginated HTML, and generating page thumbnails.
 */
export class PoliPage {
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
	}

	/** Render a PDF and return a ReadableStream of its bytes. Calls `POST /v1/render/pdf`. */
	async renderStream(input: RenderInput): Promise<ReadableStream<Uint8Array>> {
		const { signal, idempotencyKey, ...wireBody } = input;
		const response = await this.#request('/v1/render/pdf', wireBody, signal, idempotencyKey);
		const contentType = response.headers.get('content-type') ?? '';
		if (!contentType.includes('application/pdf')) {
			const requestId = response.headers.get('x-request-id') ?? undefined;
			throw new PoliPageError(
				`Expected application/pdf response, got ${contentType || 'no content-type'}`,
				'INTERNAL_ERROR',
				response.status,
				requestId,
			);
		}
		if (!response.body) {
			throw new PoliPageError('Response has no body', 'INTERNAL_ERROR', response.status);
		}
		return response.body as ReadableStream<Uint8Array>;
	}

	/** Render a PDF and return its raw bytes. Calls `POST /v1/render/pdf`. */
	async render(input: RenderInput): Promise<Uint8Array> {
		const stream = await this.renderStream(input);
		const reader = stream.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			chunks.push(value);
			total += value.length;
		}
		const out = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			out.set(chunk, offset);
			offset += chunk.length;
		}
		return out;
	}

	/** Generate paginated HTML output. Calls `POST /v1/render/preview`. */
	async preview(input: RenderInput): Promise<PreviewResult> {
		const { signal, idempotencyKey, ...wireBody } = input;
		const response = await this.#request('/v1/render/preview', wireBody, signal, idempotencyKey);
		return response.json() as Promise<PreviewResult>;
	}

	/** Generate page thumbnails as base64-encoded images. */
	async thumbnails(input: RenderInput, options: ThumbnailOptions): Promise<Thumbnail[]> {
		const { signal, idempotencyKey, ...inputBody } = input;
		const body = { ...inputBody, thumbnails: options };
		const response = await this.#request('/v1/render/thumbnails', body, signal, idempotencyKey);
		const result = (await response.json()) as { thumbnails: Thumbnail[] };
		return result.thumbnails;
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
		path: string,
		body: object,
		signal?: AbortSignal,
		callerIdempotencyKey?: string,
	): Promise<Response> {
		const idempotencyKey = callerIdempotencyKey ?? globalThis.crypto.randomUUID();
		return this.#runWithRetry(path, body, idempotencyKey, signal);
	}

	async #runWithRetry(
		path: string,
		body: object,
		idempotencyKey: string,
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

			const result = await this.#sendOnce(path, body, idempotencyKey, attempt + 1, signal);

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
		path: string,
		body: object,
		idempotencyKey: string,
		attempt: number,
		signal: AbortSignal | undefined,
	): Promise<SendOnceResult> {
		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), this.#timeout);
		const composed = signal
			? AbortSignal.any([signal, timeoutController.signal])
			: timeoutController.signal;

		this.#fireHook(this.#onRequest, {
			method: 'POST',
			url: `${this.#baseUrl}${path}`,
			attempt,
		});

		const t0 = Date.now();
		let response: Response;
		try {
			response = await fetch(`${this.#baseUrl}${path}`, {
				method: 'POST',
				headers: buildHeaders(
					path,
					this.#apiKey,
					idempotencyKey,
					`poli-page-sdk-node/${__SDK_VERSION__}`,
				),
				body: JSON.stringify(body),
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
