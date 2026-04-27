/**
 * Poli Page SDK for Node.js — public surface.
 *
 * The behavioural contract (options, defaults, errors, retry policy, HTTP rules)
 * is shared across every official Poli Page SDK.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_BASE_URL = 'https://api.poli.page';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 500;
const DEFAULT_TIMEOUT = 60_000;

const RETRY_AFTER_CAP_MS = 30_000;

function parseRetryAfter(headerValue: string | null): number | undefined {
	if (!headerValue) return undefined;
	// Try integer seconds
	const seconds = Number(headerValue);
	if (Number.isFinite(seconds)) {
		return Math.min(Math.max(seconds * 1000, 0), RETRY_AFTER_CAP_MS);
	}
	// Try HTTP-date
	const dateMs = Date.parse(headerValue);
	if (Number.isFinite(dateMs)) {
		const delta = dateMs - Date.now();
		return Math.min(Math.max(delta, 0), RETRY_AFTER_CAP_MS);
	}
	return undefined;
}

export interface PoliPageOptions {
	/** A `pp_test_*` or `pp_live_*` API key. Required. */
	apiKey: string;
	/** API base URL. Defaults to `https://api.poli.page`. */
	baseUrl?: string;
	/** Maximum retry attempts on retryable errors. Defaults to 2. */
	maxRetries?: number;
	/** Base delay (ms) before the first retry. Defaults to 500. */
	retryDelay?: number;
	/** Per-request timeout (ms). Defaults to 60000 (60s). */
	timeout?: number;
}

/**
 * Canonical Poli Page page formats. The full list is documented in the
 * platform spec (`docs/spec/page-formats.md`) and must match every other SDK.
 */
export type PageFormat =
	| 'A3'
	| 'A4'
	| 'A5'
	| 'A6'
	| 'B4'
	| 'B5'
	| 'Letter'
	| 'Legal'
	| 'Tabloid'
	| 'Executive'
	| 'Statement'
	| 'Folio';

export type Orientation = 'portrait' | 'landscape';

export interface RenderInput {
	/** Template data (variables, locale hints, etc.). Required. */
	data: Record<string, unknown>;
	/** Project slug (project mode). */
	project?: string;
	/** Template slug (project mode) or raw HTML (inline mode). Required. */
	template: string;
	/** Semver (e.g. `"1.0.0"`) or `"latest"`. Project mode only. Omit for draft. */
	version?: string;
	/** Page format override. */
	format?: PageFormat;
	/** Page orientation override. */
	orientation?: Orientation;
	/** BCP 47 locale (e.g. `en-US`, `fr-FR`) for page numbers and formatting. */
	locale?: string;
}

export interface PreviewResult {
	/** Paginated HTML. */
	html: string;
	/** Number of pages in the document. */
	totalPages: number;
}

export interface ThumbnailOptions {
	/** Thumbnail width in pixels. Required. */
	width: number;
	/** Image format. Defaults to `png`. */
	format?: 'png' | 'jpeg';
	/** JPEG quality 1–100 (jpeg only). */
	quality?: number;
	/** Generate only this page (1-based). */
	page?: number;
	/** Generate only these pages. */
	pages?: number[];
}

export interface Thumbnail {
	/** 1-based page number. */
	page: number;
	/** Image width in pixels. */
	width: number;
	/** Image height in pixels. */
	height: number;
	/** MIME type, e.g. `image/png`. */
	contentType: string;
	/** Base64-encoded image bytes. */
	data: string;
}

/**
 * Typed error raised by the SDK for any non-2xx API response, network failure,
 * or input validation error. Concrete `code` values follow the spec
 * (`invalid_api_key`, `template_not_found`, `rate_limited`, ...).
 */
export class PoliPageError extends Error {
	readonly code: string;
	readonly status?: number;
	readonly requestId?: string;

	constructor(message: string, code: string, status?: number, requestId?: string) {
		super(message);
		this.name = 'PoliPageError';
		this.code = code;
		this.status = status;
		this.requestId = requestId;
	}
}

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

	constructor(options: PoliPageOptions) {
		if (!options.apiKey) {
			throw new PoliPageError('apiKey is required', 'invalid_api_key');
		}
		this.#apiKey = options.apiKey;
		this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
		this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
		this.#retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;
		this.#timeout = options.timeout ?? DEFAULT_TIMEOUT;
	}

	/** Render a PDF and return its raw bytes. Calls `POST /v1/render/pdf`. */
	async render(input: RenderInput): Promise<Buffer> {
		const response = await this.#request('/v1/render/pdf', input);
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
		const arrayBuffer = await response.arrayBuffer();
		return Buffer.from(arrayBuffer);
	}

	/** Render a PDF and write it to disk. Creates parent directories. */
	async renderToFile(input: RenderInput, outputPath: string): Promise<void> {
		const buffer = await this.render(input);
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, buffer);
	}

	/** Generate paginated HTML output. Calls `POST /v1/render/preview`. */
	async preview(input: RenderInput): Promise<PreviewResult> {
		const response = await this.#request('/v1/render/preview', input);
		return response.json() as Promise<PreviewResult>;
	}

	/** Generate page thumbnails as base64-encoded images. */
	async thumbnails(input: RenderInput, options: ThumbnailOptions): Promise<Thumbnail[]> {
		const body = { ...input, thumbnails: options };
		const response = await this.#request('/v1/render/thumbnails', body);
		const result = (await response.json()) as { thumbnails: Thumbnail[] };
		return result.thumbnails;
	}

	#headers(path: string): Record<string, string> {
		const accept = path === '/v1/render/pdf' ? 'application/pdf' : 'application/json';
		return {
			'Content-Type': 'application/json',
			Accept: accept,
			Authorization: `Bearer ${this.#apiKey}`,
			'User-Agent': `poli-page-sdk-node/${__SDK_VERSION__}`,
		};
	}

	async #request(path: string, body: object): Promise<Response> {
		let lastError: PoliPageError | undefined;
		let nextRetryAfterMs: number | undefined;

		for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
			if (attempt > 0) {
				const delay =
					nextRetryAfterMs !== undefined
						? nextRetryAfterMs
						: this.#retryDelay * Math.pow(2, attempt - 1);
				await new Promise((resolve) => setTimeout(resolve, delay));
				nextRetryAfterMs = undefined;
			}

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), this.#timeout);

			let response: Response;
			try {
				response = await fetch(`${this.#baseUrl}${path}`, {
					method: 'POST',
					headers: this.#headers(path),
					body: JSON.stringify(body),
					signal: controller.signal,
				});
			} catch (err) {
				clearTimeout(timeoutId);
				const aborted = err instanceof Error && err.name === 'AbortError';
				lastError = new PoliPageError(
					aborted ? `Request timed out after ${this.#timeout}ms` : (err as Error).message,
					aborted ? 'timeout' : 'network_error',
				);
				if (attempt < this.#maxRetries) continue;
				throw lastError;
			}
			clearTimeout(timeoutId);

			if (response.ok) return response;

			const requestId = response.headers.get('x-request-id') ?? undefined;

			// Retry on 5xx and 429; 4xx (except 429) is never retried.
			const isRetryable = response.status >= 500 || response.status === 429;
			if (isRetryable) {
				nextRetryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
			}

			const errorBody = await response.text();
			let code: string;
			let message: string;
			try {
				const json = JSON.parse(errorBody) as { code?: string; message?: string; error?: string };
				code = json.code ?? json.message ?? json.error ?? 'unknown_error';
				message = json.message ?? `API error (${response.status}): ${code}`;
			} catch {
				code = 'INTERNAL_ERROR';
				message = `API error ${response.status}: response body was not valid JSON`;
			}

			lastError = new PoliPageError(message, code, response.status, requestId);

			if (!isRetryable) throw lastError;
		}

		throw lastError!;
	}
}
