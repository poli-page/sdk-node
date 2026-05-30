// Demonstrates: client.documents.preview(id) — get a stored document's HTML preview.
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

const preview = await client.documents.preview('doc_abc123');

// `preview.html` is the server-rendered HTML with the stored document's data
// applied to its template — useful for in-browser previews without a PDF.
console.log(`Preview: ${preview.pageCount} pages, HTML length ${preview.html.length}`);
