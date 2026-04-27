import type { PoliPageError } from './index.js';

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

interface BaseRenderInput {
	/** Template data (variables, locale hints, etc.). Required. */
	data: Record<string, unknown>;
	/** Page format override. */
	format?: PageFormat;
	/** Page orientation override. */
	orientation?: Orientation;
	/** BCP 47 locale (e.g. `en-US`, `fr-FR`) for page numbers and formatting. */
	locale?: string;
	/** Optional caller cancellation. Composed with the SDK's internal timeout. */
	signal?: AbortSignal;
	/** Optional override for the auto-generated UUID v4 idempotency key. */
	idempotencyKey?: string;
}

/**
 * Render against a stored project + template by slug. Use `version` to target
 * a specific published version; omit to render the draft.
 */
export interface ProjectModeInput extends BaseRenderInput {
	project: string;
	template: string;
	version?: string;
}

/**
 * Render with raw HTML inline. No project resolution.
 */
export interface InlineModeInput extends BaseRenderInput {
	project?: never;
	template: string;
	version?: never;
}

/**
 * Input accepted by all render methods. Either project mode (resolved by slug)
 * or inline mode (raw HTML in `template`).
 */
export type RenderInput = ProjectModeInput | InlineModeInput;

export interface PreviewResult {
	html: string;
	totalPages: number;
}

export interface ThumbnailOptions {
	width: number;
	format?: 'png' | 'jpeg';
	quality?: number;
	page?: number;
	pages?: number[];
}

export interface Thumbnail {
	page: number;
	width: number;
	height: number;
	contentType: string;
	data: string;
}

export interface RequestEvent {
	method: string;
	url: string;
	attempt: number;
}

export interface ResponseEvent {
	status: number;
	requestId?: string;
	durationMs: number;
}

export interface RetryEvent {
	attempt: number;
	delayMs: number;
	reason: PoliPageError;
}

export interface PoliPageOptions {
	apiKey: string;
	baseUrl?: string;
	maxRetries?: number;
	retryDelay?: number;
	timeout?: number;
	onRequest?: (e: RequestEvent) => void;
	onResponse?: (e: ResponseEvent) => void;
	onRetry?: (e: RetryEvent) => void;
	onError?: (err: PoliPageError) => void;
}
