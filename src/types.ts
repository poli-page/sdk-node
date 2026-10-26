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

/**
 * Input accepted by every render method: a project and one of its templates,
 * by slug. The render uses the project's copy published in the API key's
 * environment; there is no version to pick and no inline HTML.
 */
export interface RenderInput {
	/** Project slug. */
	project: string;
	/** Template slug within the project. */
	template: string;
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
	 * API and echoed on the document descriptor. Not interpreted by the SDK.
	 */
	metadata?: RenderMetadata;
	/** Optional caller cancellation. Composed with the SDK's internal timeout. Not sent. */
	signal?: AbortSignal;
	/** Optional override for the auto-generated UUID v4 idempotency key. Sent as a header. */
	idempotencyKey?: string;
}

/**
 * Result of `client.documents.preview(id)`: the stored HTML of a rendered
 * document and its page count.
 */
export interface DocumentPreviewResult {
	html: string;
	pageCount: number;
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
	templateSlug: string | null;
	/**
	 * Name of the environment the document was rendered in (the API key's
	 * environment), e.g. `sandbox`, `live` or `staging`. Any name the API
	 * returns is passed through unchanged.
	 */
	environment: string;
	apiKeyId: string | null;
	format: PageFormat;
	orientation: Orientation | null;
	locale: string | null;
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
 * Options for `client.documents.thumbnails(id, options?)`. Spec §6.3.
 * Every option is optional; an unset option is not sent and the API's
 * default applies. The SDK does not check bounds: the API answers
 * `400 VALIDATION_ERROR` to an out-of-range value.
 */
export interface ThumbnailOptions {
	/** Thumbnail width in pixels, 50–2000. API default `400`. */
	width?: number;
	/** Output format. API default `jpeg`. */
	format?: 'jpeg' | 'webp' | 'png';
	/** Image quality 1–100. Only valid when `format` is `jpeg`. */
	quality?: number;
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
 * The render namespace exposed as `client.render`. Hosts the three
 * render operations, all backed by `POST /v1/render`.
 */
export interface RenderNamespace {
	/**
	 * Render a PDF and return its raw bytes. Two HTTP calls under the hood:
	 * `POST /v1/render` to produce a stored document, then `GET presignedPdfUrl`
	 * to fetch the bytes.
	 *
	 * @example
	 * ```ts
	 * const pdf = await client.render.pdf({
	 *   project: 'billing',
	 *   template: 'invoice',
	 *   data: { invoiceNumber: 'INV-001' },
	 * });
	 * ```
	 */
	pdf(input: RenderInput): Promise<Uint8Array>;

	/**
	 * Like `render.pdf` but returns a `ReadableStream` of the PDF bytes.
	 *
	 * @example
	 * ```ts
	 * const stream = await client.render.pdfStream({
	 *   project: 'billing', template: 'invoice', data: { ... },
	 * });
	 * return new Response(stream, { headers: { 'content-type': 'application/pdf' } });
	 * ```
	 */
	pdfStream(input: RenderInput): Promise<ReadableStream<Uint8Array>>;

	/**
	 * Render a PDF, store it server-side, and return a flat document descriptor.
	 * Like `render.pdf` but skips the auto-download — caller fetches the PDF
	 * via `result.downloadPdf()` (or stores `documentId` for later via
	 * `client.documents.get(id).downloadPdf()`).
	 *
	 * Calls `POST /v1/render`. Same wire endpoint as `render.pdf` — the
	 * difference is that `pdf` chains a second fetch.
	 *
	 * @example
	 * ```ts
	 * const doc = await client.render.document({
	 *   project: 'billing', template: 'invoice',
	 *   data: { ... },
	 *   metadata: { customerId: 'cust_123' },
	 * });
	 * await db.invoices.update({ id: 'INV-001' }, { documentId: doc.documentId });
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
	 * const { html, pageCount } = await client.documents.preview('doc_abc123');
	 * ```
	 */
	preview(id: string): Promise<DocumentPreviewResult>;

	/**
	 * Generate page thumbnails for a stored document. Spec §6.3.
	 * POST `/v1/documents/:id/thumbnails`. Every option is optional.
	 *
	 * @example
	 * ```ts
	 * const thumbs = await client.documents.thumbnails('doc_abc123');
	 * const webp = await client.documents.thumbnails('doc_abc123', {
	 *   width: 840,
	 *   format: 'webp',
	 * });
	 * ```
	 */
	thumbnails(id: string, options?: ThumbnailOptions): Promise<Thumbnail[]>;

	/**
	 * Soft-delete a stored document. The PDF is purged from storage;
	 * metadata is retained for audit. Spec §6.4. DELETE `/v1/documents/:id`.
	 * Idempotent: deleting an already-deleted document resolves too.
	 *
	 * @example
	 * ```ts
	 * await client.documents.delete('doc_abc123');
	 * ```
	 */
	delete(id: string): Promise<void>;
}
