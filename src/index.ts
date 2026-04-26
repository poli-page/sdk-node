/**
 * Poli Page SDK for Node.js — public surface.
 *
 * The behavioural contract (options, defaults, errors, retry policy, HTTP rules)
 * is shared across every official Poli Page SDK and lives in
 * `docs/onboarding/micka/sdk-specification.md` of the platform monorepo.
 */

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

export type PageFormat = 'A3' | 'A4' | 'A5' | 'Letter';
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
		this.#baseUrl = options.baseUrl ?? 'https://api.poli.page';
		this.#maxRetries = options.maxRetries ?? 2;
		this.#retryDelay = options.retryDelay ?? 500;
		this.#timeout = options.timeout ?? 60000;
	}

	/** Render a PDF and return its raw bytes. Calls `POST /v1/render/pdf`. */
	render(_input: RenderInput): Promise<Buffer> {
		throw new PoliPageError('render() is not yet implemented', 'not_implemented');
	}

	/** Render a PDF and write it to disk. Creates parent directories. */
	renderToFile(_input: RenderInput, _outputPath: string): Promise<void> {
		throw new PoliPageError('renderToFile() is not yet implemented', 'not_implemented');
	}

	/** Generate paginated HTML output. Calls `POST /v1/render/preview`. */
	preview(_input: RenderInput): Promise<PreviewResult> {
		throw new PoliPageError('preview() is not yet implemented', 'not_implemented');
	}

	/** Generate page thumbnails as base64-encoded images. */
	thumbnails(_input: RenderInput, _options: ThumbnailOptions): Promise<Thumbnail[]> {
		throw new PoliPageError('thumbnails() is not yet implemented', 'not_implemented');
	}
}
