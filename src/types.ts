import type { PoliPageError } from './error.js';

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

/**
 * Free-form caller metadata. Forwarded to the API as-is and echoed back
 * on responses that support it. Not interpreted, indexed, or validated
 * by the SDK.
 *
 * Values are limited to primitives (`string | number | boolean`); nested
 * objects and arrays are not supported by the wire format.
 */
export type RenderMetadata = Record<string, string | number | boolean>;

interface BaseRenderInput {
	/** Template data (variables, locale hints, etc.). Required. */
	data: Record<string, unknown>;
	/** Page format override. */
	format?: PageFormat;
	/** Page orientation override. */
	orientation?: Orientation;
	/** BCP 47 locale (e.g. `en-US`, `fr-FR`) for page numbers and formatting. */
	locale?: string;
	/**
	 * Caller-supplied metadata. Free-form key-value pairs, forwarded to the
	 * API and echoed on `preview` and `document` responses. Not interpreted
	 * by the SDK.
	 */
	metadata?: RenderMetadata;
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
	/** Echoed back when `metadata` was supplied on the input. */
	metadata?: RenderMetadata;
}

/**
 * Wire-shape representation of a stored document. The public type
 * `DocumentDescriptor` extends this with a `downloadPdf` method.
 *
 * @internal
 */
export interface RawDocumentDescriptor {
	documentId: string;
	organizationId: string;
	projectId: string | null;
	projectSlug: string | null;
	templateId: string | null;
	templateSlug: string;
	version: string | null;
	environment: 'sandbox' | 'live';
	apiKeyId: string;
	format: PageFormat;
	orientation: Orientation;
	locale: string;
	pageCount: number;
	sizeBytes: number;
	createdAt: string;
	metadata: RenderMetadata;
	presignedPdfUrl: string;
	expiresAt: string;
}

/**
 * Stored document returned by `client.render.document` and
 * `client.documents.get`. Top-level fields are system-controlled;
 * `metadata` echoes caller-supplied data. `downloadPdf()` fetches the
 * PDF bytes from `presignedPdfUrl` on demand.
 */
export interface DocumentDescriptor extends RawDocumentDescriptor {
	/**
	 * Fetch the PDF bytes from `presignedPdfUrl`. The URL has a 15-minute
	 * TTL — if it expired, call `documents.get(id)` to refresh and retry.
	 * Throws `PoliPageError` with `code: 'DOWNLOAD_FAILED'` on non-2xx or
	 * network failures.
	 *
	 * @example
	 * ```ts
	 * const pdf = await doc.downloadPdf();
	 * // Or with cancellation:
	 * const pdf = await doc.downloadPdf({ signal: AbortSignal.timeout(10_000) });
	 * ```
	 */
	downloadPdf(options?: { signal?: AbortSignal }): Promise<Uint8Array>;
}

/**
 * Options for `client.documents.thumbnails(id, options)`. Spec §6.3.
 */
export interface ThumbnailOptions {
	/** Thumbnail width in pixels. Required. */
	width: number;
	/** Output format. Default `png`. */
	format?: 'png' | 'jpeg';
	/** JPEG quality 1-100. Only valid when `format` is `jpeg`. */
	quality?: number;
	/** Generate only this page (1-based). */
	page?: number;
	/** Generate only these pages (1-based). */
	pages?: number[];
}

/**
 * A single page thumbnail returned by `documents.thumbnails`. Spec §6.3.
 */
export interface Thumbnail {
	page: number;
	width: number;
	height: number;
	contentType: string;
	/** Base64-encoded image bytes. */
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

/**
 * The render namespace exposed as `client.render`. Hosts the four
 * render operations defined by spec v1.3 §5.1–§5.3.
 */
export interface RenderNamespace {
	/**
	 * Render a PDF and return its raw bytes. Calls `POST /v1/render/pdf`.
	 *
	 * @example
	 * ```ts
	 * const pdf = await client.render.pdf({
	 *   project: 'billing',
	 *   template: 'invoice',
	 *   version: '1.0.0',
	 *   data: { invoiceNumber: 'INV-001' },
	 * });
	 * ```
	 */
	pdf(input: RenderInput): Promise<Uint8Array>;

	/**
	 * Render a PDF and return a `ReadableStream` of its bytes. Use when piping
	 * directly to a destination (HTTP response, S3 upload, file) without
	 * buffering.
	 *
	 * @example
	 * ```ts
	 * const stream = await client.render.pdfStream({
	 *   project: 'billing', template: 'invoice', version: '1.0.0', data: { ... },
	 * });
	 * return new Response(stream, { headers: { 'content-type': 'application/pdf' } });
	 * ```
	 */
	pdfStream(input: RenderInput): Promise<ReadableStream<Uint8Array>>;

	/**
	 * Generate paginated HTML preview output. Calls `POST /v1/render/preview`.
	 *
	 * @example
	 * ```ts
	 * const { html, totalPages } = await client.render.preview({
	 *   project: 'billing', template: 'invoice', version: '1.0.0', data: { ... },
	 * });
	 * ```
	 */
	preview(input: RenderInput): Promise<PreviewResult>;

	/**
	 * Render a PDF, store it server-side, and return a flat document descriptor
	 * with system metadata + caller-supplied `metadata` + presigned PDF URL.
	 * The SDK does not auto-download the PDF — call `downloadPdf()` on the
	 * returned descriptor when you need the bytes.
	 *
	 * Calls `POST /v1/render/document`. Starter+ tier (Free tier returns
	 * `403 STORAGE_REQUIRED`).
	 *
	 * @example
	 * ```ts
	 * const doc = await client.render.document({
	 *   project: 'billing', template: 'invoice', version: '1.0.0',
	 *   data: { ... },
	 *   metadata: { customerId: 'cust_123' },
	 * });
	 * const pdf = await doc.downloadPdf();
	 * ```
	 */
	document(input: RenderInput): Promise<DocumentDescriptor>;
}

/**
 * The documents namespace exposed as `client.documents`. Hosts the four
 * stored-document operations defined by spec v1.3 §6.
 */
export interface DocumentsNamespace {
	/**
	 * Retrieve a stored document's descriptor with a fresh presigned URL.
	 * Spec §6.1. GET `/v1/documents/:id`.
	 *
	 * @example
	 * ```ts
	 * const doc = await client.documents.get('doc_abc123');
	 * const pdf = await doc.downloadPdf();
	 * ```
	 */
	get(id: string): Promise<DocumentDescriptor>;

	/**
	 * Retrieve a stored document's paginated HTML. No counter — the engine
	 * performs no work. Spec §6.2. GET `/v1/documents/:id/preview`.
	 *
	 * @example
	 * ```ts
	 * const { html, totalPages } = await client.documents.preview('doc_abc123');
	 * ```
	 */
	preview(id: string): Promise<PreviewResult>;

	/**
	 * Generate page thumbnails for a stored document. Spec §6.3.
	 * POST `/v1/documents/:id/thumbnails`.
	 *
	 * @example
	 * ```ts
	 * const thumbs = await client.documents.thumbnails('doc_abc123', {
	 *   width: 840,
	 *   format: 'png',
	 * });
	 * ```
	 */
	thumbnails(id: string, options: ThumbnailOptions): Promise<Thumbnail[]>;

	/**
	 * Soft-delete a stored document. The PDF is purged from storage;
	 * metadata is retained for audit. Spec §6.4. DELETE `/v1/documents/:id`.
	 *
	 * @example
	 * ```ts
	 * await client.documents.delete('doc_abc123');
	 * ```
	 */
	delete(id: string): Promise<void>;
}
