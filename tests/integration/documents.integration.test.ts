import { describe, it, expect } from 'vitest';
import { PoliPage, PoliPageError } from '../../src/index.js';

const apiKey = process.env.POLI_PAGE_API_KEY;
const baseUrl = process.env.POLI_PAGE_BASE_URL ?? 'https://api-develop.poli.page';

// Integration tests use the `getting-started/welcome/1.0.0` template that
// every Poli Page org gets provisioned automatically — works out of the box
// for any fresh API key. Override via env vars to point at your own template.
const project = process.env.POLI_PAGE_TEST_PROJECT ?? 'getting-started';
const template = process.env.POLI_PAGE_TEST_TEMPLATE ?? 'welcome';
const version = process.env.POLI_PAGE_TEST_VERSION ?? '1.0.0';

const describeIfKey = apiKey ? describe : describe.skip;

describeIfKey('integration: documents.* round trip', () => {
	it('render.document → documents.get → downloadPdf → documents.thumbnails → documents.delete → 410 GONE', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });

		// 1. Render and store a document.
		const created = await client.render.document({
			project, template, version,
			data: { id: Date.now() },
			metadata: { source: 'documents integration test' },
		});
		expect(typeof created.documentId).toBe('string');
		expect(created.documentId.length).toBeGreaterThan(0);

		// 2. Fetch a fresh descriptor.
		const fetched = await client.documents.get(created.documentId);
		expect(fetched.documentId).toBe(created.documentId);
		expect(fetched.metadata.source).toBe('documents integration test');

		// 3. Download the PDF via the fluent helper.
		const pdf = await fetched.downloadPdf();
		expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');

		// 4. Thumbnails of the stored document.
		// Tier-gated on the API side: Free tier returns THUMBNAILS_NOT_AVAILABLE.
		// Don't fail the whole round-trip on Free — assert wire-level
		// correctness on the paid path only when available.
		try {
			const thumbs = await client.documents.thumbnails(created.documentId, {
				width: 320,
				format: 'png',
			});
			expect(thumbs.length).toBeGreaterThan(0);
			expect(thumbs[0]?.contentType).toBe('image/png');
		} catch (err) {
			if (!(err instanceof PoliPageError) || err.code !== 'THUMBNAILS_NOT_AVAILABLE') throw err;
			// Free tier — skip the thumbnail assertions but continue the round-trip.
		}

		// 5. documents.preview returns html + pageCount.
		const preview = await client.documents.preview(created.documentId);
		expect(preview.pageCount).toBeGreaterThan(0);
		expect(typeof preview.html).toBe('string');

		// 6. Soft-delete.
		await client.documents.delete(created.documentId);

		// 7. Subsequent get returns 410 GONE.
		try {
			await client.documents.get(created.documentId);
			expect.fail('Expected GONE after delete');
		} catch (err) {
			expect(err).toBeInstanceOf(PoliPageError);
			expect((err as PoliPageError).status).toBe(410);
			// The deployed API may surface this code as 'GONE' or
			// 'DOCUMENT_GONE' depending on the API version. Both are
			// valid; assert the family rather than a single string.
			expect(['GONE', 'DOCUMENT_GONE']).toContain((err as PoliPageError).code);
		}
	});
});
