// Demonstrates: client.render.document(input) — render and store a PDF server-side.
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

const document = await client.render.document({
  project: 'billing',
  template: 'invoice',
  data: { invoiceNumber: 'INV-001', total: 1280 },
  metadata: { customerId: 'cust_42' },
});

// `document.documentId` identifies the stored document — use it with
// client.documents.* to fetch, preview, thumbnail, or delete later.
console.log(`Stored as ${document.documentId} (${document.pageCount} pages, ${document.sizeBytes} bytes)`);

// Fetch the PDF bytes on demand:
const pdf = await document.downloadPdf();
console.log(`Downloaded ${pdf.byteLength} bytes`);
