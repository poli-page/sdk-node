import { expectTypeOf, test } from 'vitest';
import type { ProjectModeInput, InlineModeInput } from '../src/types.js';
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
