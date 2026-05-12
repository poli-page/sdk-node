import { expectTypeOf, test } from 'vitest';
import type { ProjectModeInput, InlineModeInput, RenderInput, RenderMetadata, PreviewResult } from '../src/types.js';
import { PoliPage } from '../src/index.js';

test('ProjectModeInput requires project and template', () => {
	expectTypeOf<{ project: string; template: string; data: Record<string, unknown> }>().toMatchTypeOf<ProjectModeInput>();
});

test('InlineModeInput requires template, forbids project', () => {
	expectTypeOf<{ template: string; data: Record<string, unknown> }>().toMatchTypeOf<InlineModeInput>();
});

test('render() rejects invalid combos at compile time', () => {
	const c = new PoliPage({ apiKey: 'pp_test_x' });
	// Valid inline mode:
	void c.render({ template: '<p>x</p>', data: {} });
	// Valid project mode:
	void c.render({ project: 'billing', template: 'invoice', data: {} });
	// @ts-expect-error — project mode requires template
	void c.render({ project: 'billing', data: {} });
	// @ts-expect-error — at least template required
	void c.render({ data: {} });
});

test('render returns Promise<Uint8Array>', () => {
	const c = new PoliPage({ apiKey: 'pp_test_x' });
	expectTypeOf(c.render).returns.resolves.toEqualTypeOf<Uint8Array>();
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

test('RenderInput accepts a metadata field', () => {
	expectTypeOf<{
		template: string;
		data: Record<string, unknown>;
		metadata: { customerId: string; amount: number; paid: boolean };
	}>().toMatchTypeOf<RenderInput>();
});

test('PreviewResult.metadata is optional RenderMetadata', () => {
	expectTypeOf<PreviewResult>().toMatchTypeOf<{
		html: string;
		totalPages: number;
		metadata?: RenderMetadata;
	}>();
});
