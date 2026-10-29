import { expectTypeOf, test } from 'vitest';
import type {
	RenderInput,
	RenderMetadata,
	DocumentPreviewResult,
	DocumentDescriptor,
	Thumbnail,
	ThumbnailOptions,
} from '../src/types.js';
import type * as Sdk from '../src/index.js';
import { PoliPage, type PoliPageErrorCode } from '../src/index.js';

test('RenderInput requires project, template and data', () => {
	expectTypeOf<{ project: string; template: string; data: Record<string, unknown> }>().toMatchTypeOf<RenderInput>();
	expectTypeOf<{ template: string; data: Record<string, unknown> }>().not.toMatchTypeOf<RenderInput>();
});

test('RenderInput is the only render input type exported', () => {
	expectTypeOf<Sdk.RenderInput>().toEqualTypeOf<RenderInput>();
	// @ts-expect-error — ProjectModeInput was renamed RenderInput
	void expectTypeOf<Sdk.ProjectModeInput>();
	// @ts-expect-error — inline mode was removed with inline-HTML rendering
	void expectTypeOf<Sdk.InlineModeInput>();
	// @ts-expect-error — render.preview and its result type were removed
	void expectTypeOf<Sdk.PreviewResult>();
});

test('render methods reject a version at compile time', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	// @ts-expect-error — versions were removed; a render uses the copy published in the key's environment
	void c.render.pdf({ project: 'billing', template: 'invoice', version: '1.0.0', data: {} });
	// @ts-expect-error — versions were removed
	void c.render.pdfStream({ project: 'billing', template: 'invoice', version: '1.0.0', data: {} });
	// @ts-expect-error — versions were removed
	void c.render.document({ project: 'billing', template: 'invoice', version: '1.0.0', data: {} });
});

test('render methods reject inline HTML (no project) at compile time', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	// @ts-expect-error — inline-HTML rendering was removed
	void c.render.pdf({ template: '<p>x</p>', data: {} });
	// @ts-expect-error — inline-HTML rendering was removed
	void c.render.pdfStream({ template: '<p>x</p>', data: {} });
	// @ts-expect-error — inline-HTML rendering was removed
	void c.render.document({ template: '<p>x</p>', data: {} });
	void c.render.pdf({ project: 'billing', template: 'invoice', data: {} });
});

test('render.preview has been removed', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	// @ts-expect-error — POST /v1/render/preview was removed from the API
	void c.render.preview({ project: 'billing', template: 'invoice', data: {} });
});

test('render.pdf returns Promise<Uint8Array>', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	expectTypeOf(c.render.pdf).returns.resolves.toEqualTypeOf<Uint8Array>();
});

test('RenderMetadata accepts string, number, boolean values', () => {
	expectTypeOf<{ a: string; b: number; c: boolean }>().toMatchTypeOf<RenderMetadata>();
});

test('RenderMetadata rejects nested objects', () => {
	expectTypeOf<{ nested: { k: string } }>().not.toMatchTypeOf<RenderMetadata>();
});

test('RenderMetadata rejects arrays', () => {
	expectTypeOf<{ tags: string[] }>().not.toMatchTypeOf<RenderMetadata>();
});

test('RenderInput has optional metadata field', () => {
	expectTypeOf<RenderInput['metadata']>().toEqualTypeOf<RenderMetadata | undefined>();
});

test('render.pdfStream returns Promise<ReadableStream<Uint8Array>>', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	expectTypeOf(c.render.pdfStream).returns.resolves.toEqualTypeOf<ReadableStream<Uint8Array>>();
});

test('client.render is not directly callable', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	// @ts-expect-error — client.render is a namespace object, not a function
	void c.render({ template: '<p>x</p>', data: {} });
});

test('client.thumbnails has been removed', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	// @ts-expect-error — inline thumbnails retired in v1.3; use documents.thumbnails (N2)
	void c.thumbnails({ template: '<p>x</p>', data: {} }, { width: 400 });
});

test('client.renderStream has been removed', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	// @ts-expect-error — replaced by render.pdfStream
	void c.renderStream({ template: '<p>x</p>', data: {} });
});

test('client.preview (flat) has been removed', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	// @ts-expect-error — removed with the authenticated preview
	void c.preview({ template: '<p>x</p>', data: {} });
});

test('render.document returns Promise<DocumentDescriptor>', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	expectTypeOf(c.render.document).returns.resolves.toMatchTypeOf<DocumentDescriptor>();
});

test('DocumentDescriptor.downloadPdf returns Promise<Uint8Array>', () => {
	expectTypeOf<DocumentDescriptor['downloadPdf']>().returns.toEqualTypeOf<Promise<Uint8Array>>();
});

test('DocumentDescriptor.metadata is RenderMetadata (always present)', () => {
	expectTypeOf<DocumentDescriptor['metadata']>().toEqualTypeOf<RenderMetadata>();
});

test('DocumentDescriptor.environment is any environment name', () => {
	expectTypeOf<DocumentDescriptor['environment']>().toEqualTypeOf<string>();
});

test('DocumentDescriptor has no version', () => {
	expectTypeOf<DocumentDescriptor>().not.toHaveProperty('version');
});

test('client.documents.get returns Promise<DocumentDescriptor>', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	expectTypeOf(c.documents.get).returns.resolves.toMatchTypeOf<DocumentDescriptor>();
});

test('client.documents.preview returns DocumentPreviewResult (pageCount, not totalPages)', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	expectTypeOf(c.documents.preview).returns.resolves.toMatchTypeOf<DocumentPreviewResult>();
	expectTypeOf(c.documents.preview).returns.resolves.toMatchTypeOf<{
		html: string;
		pageCount: number;
	}>();
});

test('client.documents.thumbnails options are all optional', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	void c.documents.thumbnails('doc_id');
	void c.documents.thumbnails('doc_id', {});
	void c.documents.thumbnails('doc_id', { width: 320 });
	void c.documents.thumbnails('doc_id', { format: 'webp' });
	expectTypeOf<ThumbnailOptions['format']>().toEqualTypeOf<'jpeg' | 'webp' | 'png' | undefined>();
});

test('ThumbnailOptions has no page (singular) — only pages (plural)', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	// @ts-expect-error — `page` (singular) was retired; use `pages: [N]`
	void c.documents.thumbnails('doc_id', { width: 320, page: 1 });
	// Valid:
	void c.documents.thumbnails('doc_id', { width: 320, pages: [1] });
});

test('client.documents.delete returns Promise<void>', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	expectTypeOf(c.documents.delete).returns.resolves.toEqualTypeOf<void>();
});

test('every documents method takes a last { signal } argument', () => {
	const c = new PoliPage({ apiKey: 'pp_sandbox_x' });
	const signal = new AbortController().signal;
	void c.documents.get('doc_id', { signal });
	void c.documents.preview('doc_id', { signal });
	void c.documents.thumbnails('doc_id', undefined, { signal });
	void c.documents.thumbnails('doc_id', { width: 320 }, { signal });
	void c.documents.delete('doc_id', { signal });
	expectTypeOf<Sdk.DocumentsRequestOptions>().toEqualTypeOf<{ signal?: AbortSignal }>();
});

test('Thumbnail and ThumbnailOptions are re-exported', () => {
	expectTypeOf<ThumbnailOptions>().toMatchTypeOf<{ width?: number }>();
	expectTypeOf<Thumbnail>().toMatchTypeOf<{ page: number; data: string }>();
});

/** The literal members of a `'A' | 'B' | (string & {})` union. */
type KnownCodes<T> = T extends string ? (string extends T ? never : T) : never;

test('PoliPageErrorCode knows exactly the SDK codes and the 31 API codes', () => {
	expectTypeOf<KnownCodes<PoliPageErrorCode>>().toEqualTypeOf<
		// SDK
		| 'invalid_options'
		| 'network_error'
		| 'timeout'
		| 'aborted'
		| 'DOWNLOAD_FAILED'
		// API
		| 'MISSING_API_KEY'
		| 'INVALID_API_KEY'
		| 'ORGANIZATION_CANCELLED'
		| 'ORGANIZATION_PURGED'
		| 'ORGANIZATION_PAYMENT_GRACE'
		| 'ORGANIZATION_MIGRATING'
		| 'FORBIDDEN'
		| 'ENVIRONMENT_PROTECTED'
		| 'THUMBNAILS_NOT_AVAILABLE'
		| 'NOT_FOUND'
		| 'PROJECT_NOT_FOUND'
		| 'PROJECT_NOT_IN_ENVIRONMENT'
		| 'TEMPLATE_NOT_FOUND'
		| 'DOCUMENT_NOT_FOUND'
		| 'DOCUMENT_GONE'
		| 'VALIDATION_ERROR'
		| 'MISSING_DATA'
		| 'MISSING_TEMPLATE_SLUG'
		| 'PROJECT_REQUIRED_FOR_DOCUMENT'
		| 'ENVIRONMENT_MISMATCH'
		| 'EMPTY_DOCUMENT'
		| 'TEMPLATE_ERROR'
		| 'RENDER_BODY_TOO_LARGE'
		| 'DOCUMENT_TOO_LARGE'
		| 'QUOTA_EXCEEDED'
		| 'OVERAGE_CAP_EXCEEDED'
		| 'RATE_LIMIT_EXCEEDED'
		| 'INTERNAL_ERROR'
		| 'STORAGE_ACCESS_DENIED'
		| 'PUBLISH_IN_PROGRESS'
		| 'RENDER_TIMEOUT'
	>();
});

test('PoliPageErrorCode still accepts any code the API returns', () => {
	expectTypeOf<'SOME_FUTURE_CODE'>().toMatchTypeOf<PoliPageErrorCode>();
});
