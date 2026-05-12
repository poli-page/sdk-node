import { describe, it, expect } from 'vitest';
import { PoliPage, PoliPageError } from '../../src/index.js';

const apiKey = process.env.POLI_PAGE_API_KEY;
const baseUrl = process.env.POLI_PAGE_BASE_URL ?? 'https://api-develop.poli.page';
const describeIfKey = apiKey ? describe : describe.skip;

describeIfKey('integration: documents.* round trip', () => {
	it('render.document → documents.get → downloadPdf → documents.thumbnails → documents.delete → 410 GONE', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });

		// 1. Render and store a document.
		const created = await client.render.document({
			template: '<h1>Integration {{ id }}</h1>',
			data: { id: Date.now() },
			metadata: { source: 'documents integration test' },
		});
		expect(created.documentId).toMatch(/^doc_/);

		// 2. Fetch a fresh descriptor.
		const fetched = await client.documents.get(created.documentId);
		expect(fetched.documentId).toBe(created.documentId);
		expect(fetched.metadata.source).toBe('documents integration test');

		// 3. Download the PDF via the fluent helper.
		const pdf = await fetched.downloadPdf();
		expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');

		// 4. Thumbnails of the stored document.
		const thumbs = await client.documents.thumbnails(created.documentId, {
			width: 320,
			format: 'png',
		});
		expect(thumbs.length).toBeGreaterThan(0);
		expect(thumbs[0]?.contentType).toBe('image/png');

		// 5. documents.preview returns html + totalPages.
		const preview = await client.documents.preview(created.documentId);
		expect(preview.totalPages).toBeGreaterThan(0);
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
			expect((err as PoliPageError).code).toBe('GONE');
		}
	});
});
