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
<<<<<<< HEAD
	RenderMetadata,
	RenderNamespace,
	DocumentsNamespace,
	DocumentDescriptor,
	DocumentPreviewResult,
	Thumbnail,
	ThumbnailOptions,
	PreviewResult,
=======
	PreviewResult,
	Thumbnail,
	ThumbnailOptions,
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
	PoliPageOptions,
	RequestEvent,
	ResponseEvent,
	RetryEvent,
} from './types.js';

<<<<<<< HEAD
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
=======
import type { RenderInput, PreviewResult, Thumbnail, ThumbnailOptions, PoliPageOptions, RequestEvent, ResponseEvent, RetryEvent } from './types.js';

export { PoliPageError, type PoliPageErrorCode } from './error.js';
import { PoliPageError } from './error.js';
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
import { parseRetryAfter, computeBackoff, parseErrorBody, buildHeaders } from './internal/http.js';

type SendOnceResult =
	| { ok: true; response: Response }
	| { ok: false; error: PoliPageError; retryAfterMs: number | undefined; retryable: boolean };

const DEFAULT_BASE_URL = 'https://api.poli.page';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 500;
const DEFAULT_TIMEOUT = 60_000;

/**
<<<<<<< HEAD
 * Poli Page client. Entry point for the namespaced render API.
=======
 * Poli Page client. Single entry point for rendering PDFs, previewing
 * paginated HTML, and generating page thumbnails.
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
 *
 * @example
 * ```ts
 * import { PoliPage } from '@poli-page/sdk';
 *
 * const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });
 *
<<<<<<< HEAD
 * const pdf = await client.render.pdf({
 *   project: 'billing',
 *   template: 'invoice',
 *   version: '1.0.0',
=======
 * const pdf = await client.render({
 *   project: 'billing',
 *   template: 'invoice',
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
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
<<<<<<< HEAD

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

=======
	}

	/**
	 * Render a PDF and return a `ReadableStream` of its bytes. Calls `POST /v1/render/pdf`.
	 *
	 * Use this when you want to pipe the response straight to a destination
	 * (HTTP response, S3 upload, file) without buffering the full PDF in memory.
	 *
	 * @example
	 * ```ts
	 * const stream = await client.renderStream({
	 *   project: 'billing',
	 *   template: 'invoice',
	 *   data: { invoiceNumber: 'INV-001' },
	 * });
	 *
	 * // In an HTTP handler, pipe directly to the response:
	 * return new Response(stream, { headers: { 'content-type': 'application/pdf' } });
	 * ```
	 */
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

	/**
	 * Render a PDF and return its raw bytes. Calls `POST /v1/render/pdf`.
	 *
	 * For large PDFs or when streaming is preferable (e.g. piping to S3 or an
	 * HTTP response), use {@link PoliPage.renderStream} instead.
	 *
	 * @example
	 * ```ts
	 * const pdf = await client.render({
	 *   project: 'billing',
	 *   template: 'invoice',
	 *   data: { invoiceNumber: 'INV-001', total: 1280 },
	 * });
	 * // pdf is a Uint8Array
	 * ```
	 *
	 * @example Inline HTML mode
	 * ```ts
	 * const pdf = await client.render({
	 *   template: '<h1>Hello {{ name }}</h1>',
	 *   data: { name: 'World' },
	 * });
	 * ```
	 */
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

	/**
	 * Generate paginated HTML output. Calls `POST /v1/render/preview`.
	 *
	 * Useful for live preview in editor UIs or for asserting layout in tests
	 * without producing a PDF.
	 *
	 * @example
	 * ```ts
	 * const { html, totalPages } = await client.preview({
	 *   project: 'billing',
	 *   template: 'invoice',
	 *   data: { invoiceNumber: 'INV-001' },
	 * });
	 * console.log(`Rendered ${totalPages} page(s)`);
	 * ```
	 */
	async preview(input: RenderInput): Promise<PreviewResult> {
		const { signal, idempotencyKey, ...wireBody } = input;
		const response = await this.#request('/v1/render/preview', wireBody, signal, idempotencyKey);
		return response.json() as Promise<PreviewResult>;
	}

	/**
	 * Generate page thumbnails as base64-encoded images.
	 * Calls `POST /v1/render/thumbnails`.
	 *
	 * @example
	 * ```ts
	 * const thumbs = await client.thumbnails(
	 *   { project: 'billing', template: 'invoice', data: { invoiceNumber: 'INV-001' } },
	 *   { width: 320, format: 'png' },
	 * );
	 * for (const t of thumbs) {
	 *   console.log(`page ${t.page}: ${t.width}x${t.height} ${t.contentType}`);
	 * }
	 * ```
	 */
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

>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
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

<<<<<<< HEAD
			const result = await this.#sendOnce(method, path, body, idempotencyKey, attempt + 1, signal);
=======
			const result = await this.#sendOnce(path, body, idempotencyKey, attempt + 1, signal);
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17

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
<<<<<<< HEAD
		method: 'GET' | 'POST' | 'DELETE',
		path: string,
		body: object | undefined,
		idempotencyKey: string | undefined,
=======
		path: string,
		body: object,
		idempotencyKey: string,
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
		attempt: number,
		signal: AbortSignal | undefined,
	): Promise<SendOnceResult> {
		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), this.#timeout);
		const composed = signal
			? AbortSignal.any([signal, timeoutController.signal])
			: timeoutController.signal;

		this.#fireHook(this.#onRequest, {
<<<<<<< HEAD
			method,
=======
			method: 'POST',
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			url: `${this.#baseUrl}${path}`,
			attempt,
		});

		const t0 = Date.now();
		let response: Response;
		try {
			response = await fetch(`${this.#baseUrl}${path}`, {
<<<<<<< HEAD
				method,
				headers: buildHeaders(
					method,
=======
				method: 'POST',
				headers: buildHeaders(
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
					path,
					this.#apiKey,
					idempotencyKey,
					`poli-page-sdk-node/${__SDK_VERSION__}`,
				),
<<<<<<< HEAD
				body: method === 'POST' ? JSON.stringify(body) : undefined,
=======
				body: JSON.stringify(body),
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
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
<<<<<<< HEAD
				aborted ? `Request timed out after ${this.#timeout}ms` : err instanceof Error ? err.message : String(err),
=======
				aborted ? `Request timed out after ${this.#timeout}ms` : (err as Error).message,
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
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
