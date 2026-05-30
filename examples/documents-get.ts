// Demonstrates: client.documents.get(id) — fetch a stored document.
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

const document = await client.documents.get('doc_abc123');

console.log(`Document ${document.documentId}: ${document.pageCount} pages, created ${document.createdAt}`);

// `presignedPdfUrl` has a 15-minute TTL. Call downloadPdf() to fetch bytes
// before it expires, or call documents.get(id) again to refresh.
const pdf = await document.downloadPdf();
console.log(`Downloaded ${pdf.byteLength} bytes`);
