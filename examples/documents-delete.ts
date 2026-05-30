// Demonstrates: client.documents.delete(id) — soft-delete a stored document.
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

await client.documents.delete('doc_abc123');

// Returns void. The PDF is purged; metadata is retained for audit.
console.log('Deleted.');
