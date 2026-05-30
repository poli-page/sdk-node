// Demonstrates: client.documents.thumbnails(id, options) — page thumbnails for a stored document.
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

const thumbnails = await client.documents.thumbnails('doc_abc123', {
  width: 840,
  format: 'png',
  pages: [1, 2],
});

// Each entry includes the image bytes base64-encoded.
for (const t of thumbnails) {
  console.log(`Page ${t.page}: ${t.width}×${t.height} ${t.contentType} (${t.data.length} base64 chars)`);
}
