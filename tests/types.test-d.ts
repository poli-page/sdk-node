import { expectTypeOf, test } from 'vitest';
import type { ProjectModeInput, InlineModeInput, RenderInput, RenderMetadata, PreviewResult } from '../src/types.js';
import { PoliPage } from '../src/index.js';

test('ProjectModeInput requires project and template', () => {
	expectTypeOf<{ project: string; template: string; data: Record<string, unknown> }>().toMatchTypeOf<ProjectModeInput>();
});

test('InlineModeInput requires template, forbids project', () => {
	expectTypeOf<{ template: string; data: Record<string, unknown> }>().toMatchTypeOf<InlineModeInput>();
});

test('render.pdf rejects invalid combos at compile time', () => {
	const c = new PoliPage({ apiKey: 'pp_test_x' });
	// Valid inline mode:
	void c.render.pdf({ template: '<p>x</p>', data: {} });
	// Valid project mode:
	void c.render.pdf({ project: 'billing', template: 'invoice', data: {} });
	// @ts-expect-error — project mode requires template
	void c.render.pdf({ project: 'billing', data: {} });
	// @ts-expect-error — at least template required
	void c.render.pdf({ data: {} });
});

test('render.pdf returns Promise<Uint8Array>', () => {
	const c = new PoliPage({ apiKey: 'pp_test_x' });
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

test('PreviewResult.metadata is optional RenderMetadata', () => {
	expectTypeOf<PreviewResult['metadata']>().toEqualTypeOf<RenderMetadata | undefined>();
});

test('render.pdfStream returns Promise<ReadableStream<Uint8Array>>', () => {
	const c = new PoliPage({ apiKey: 'pp_test_x' });
	expectTypeOf(c.render.pdfStream).returns.resolves.toEqualTypeOf<ReadableStream<Uint8Array>>();
});

test('render.preview returns Promise<PreviewResult>', () => {
	const c = new PoliPage({ apiKey: 'pp_test_x' });
	expectTypeOf(c.render.preview).returns.resolves.toMatchTypeOf<{
		html: string;
		totalPages: number;
	}>();
});

test('client.render is not directly callable', () => {
	const c = new PoliPage({ apiKey: 'pp_test_x' });
	// @ts-expect-error — client.render is a namespace object, not a function
	void c.render({ template: '<p>x</p>', data: {} });
});

test('client.thumbnails has been removed', () => {
	const c = new PoliPage({ apiKey: 'pp_test_x' });
	// @ts-expect-error — inline thumbnails retired in v1.3; use documents.thumbnails (N2)
	void c.thumbnails({ template: '<p>x</p>', data: {} }, { width: 400 });
});

test('client.renderStream has been removed', () => {
	const c = new PoliPage({ apiKey: 'pp_test_x' });
	// @ts-expect-error — replaced by render.pdfStream
	void c.renderStream({ template: '<p>x</p>', data: {} });
});

test('client.preview (flat) has been removed', () => {
	const c = new PoliPage({ apiKey: 'pp_test_x' });
	// @ts-expect-error — replaced by render.preview
	void c.preview({ template: '<p>x</p>', data: {} });
});
