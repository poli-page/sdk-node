# Poli Page SDK for Node.js

[![npm version](https://img.shields.io/npm/v/@poli-page/sdk.svg?style=flat)](https://www.npmjs.com/package/@poli-page/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@poli-page/sdk.svg?style=flat)](https://www.npmjs.com/package/@poli-page/sdk)
[![types](https://img.shields.io/npm/types/@poli-page/sdk.svg?style=flat)](https://www.npmjs.com/package/@poli-page/sdk)
[![license](https://img.shields.io/npm/l/@poli-page/sdk.svg?style=flat)](LICENSE)
[![node](https://img.shields.io/node/v/@poli-page/sdk.svg?style=flat)](https://nodejs.org/)

[![CI](https://img.shields.io/github/actions/workflow/status/poli-page/sdk-node/ci.yml?branch=main&label=CI&style=flat)](https://github.com/poli-page/sdk-node/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/poli-page/sdk-node/codeql.yml?branch=main&label=CodeQL&style=flat)](https://github.com/poli-page/sdk-node/actions/workflows/codeql.yml)
[![coverage](https://codecov.io/gh/poli-page/sdk-node/branch/main/graph/badge.svg)](https://codecov.io/gh/poli-page/sdk-node)
[![install size](https://packagephobia.com/badge?p=@poli-page/sdk)](https://packagephobia.com/result?p=@poli-page/sdk)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@poli-page/sdk?style=flat&label=bundle)](https://bundlephobia.com/package/@poli-page/sdk)
[![docs](https://img.shields.io/badge/docs-online-brightgreen?style=flat)](https://poli-page.github.io/sdk-node/)

Official Node.js SDK for [Poli Page](https://poli.page) — render polished PDFs from HTML templates via the Poli Page API.

→ **Documentation**: https://poli-page.github.io/sdk-node/

## Install

```bash
npm install @poli-page/sdk
```

Requires Node.js 20.18 or later.

## Quick start

### Project mode — render a published template by slug

```ts
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

const pdf = await client.render.pdf({
  project: 'getting-started',
  template: 'welcome',
  version: '1.0.0',
  data: { name: 'World' },
});
// pdf is a Uint8Array
```

Every Poli Page org comes pre-provisioned with a `getting-started/welcome` template, so the snippet above runs as-is the moment you have an API key — no project setup needed. For your own templates, swap the slugs once you've pushed a version with the `poli` CLI:

```ts
const pdf = await client.render.pdf({
  project: 'billing',
  template: 'invoice',
  version: '1.0.0',
  data: { invoiceNumber: 'INV-001', total: 1280 },
});
```

### Preview inline HTML

`render.preview` accepts raw HTML for live editing and visual inspection without producing a stored document. Use this for editor previews or layout tests.

```ts
const { html, totalPages, environment } = await client.render.preview({
  template: '<h1>Hello {{ name }}</h1>',
  data: { name: 'World' },
});
console.log(`Rendered ${totalPages} page(s) in ${environment} mode`);
```

**`render.pdf`, `render.pdfStream`, and `render.document` require project mode** — `project` + `template`, optionally pinned to a specific `version` (omit to render the current draft). Inline HTML is only accepted by `render.preview`. The SDK enforces this at compile time.

### Write a PDF to disk

```ts
import { PoliPage } from '@poli-page/sdk';
import { renderToFile } from '@poli-page/sdk/node';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });
await renderToFile(
  client,
  { project: 'getting-started', template: 'welcome', version: '1.0.0', data: { name: 'World' } },
  './welcome.pdf',
);
```

`renderToFile` streams response bytes directly to disk (bounded memory).

### Try it locally — runnable demos

The repo ships three end-to-end demos that exercise every public method against the real API:

```bash
npm run demo        # Node ESM — start here
npm run demo:cjs    # Node CommonJS (verifies the dual exports map)
npm run demo:edge   # Cloudflare Worker (proof of edge-runtime support)
```

First run prompts for a `pp_test_*` key and saves it to `.env`. Subsequent runs are silent. Pick by target runtime — see [`demo/README.md`](demo/README.md#which-demo-for-which-use-case) for the full decision guide and what each demo proves.

### Stream — for large PDFs or piping to S3 / HTTP responses

```ts
const stream = await client.render.pdfStream({
  project: 'billing',
  template: 'invoice',
  version: '1.0.0',
  data: { invoiceNumber: 'INV-001' },
});
// stream is a ReadableStream<Uint8Array>
await s3.upload({ Bucket: 'invoices', Key: 'INV-001.pdf', Body: stream }).promise();
```

## Working with stored documents

Every render produces a stored document, accessible via `documentId` for later download or thumbnails. `render.pdf` and `render.pdfStream` are conveniences that chain a presigned-URL fetch internally to return bytes; `render.document` returns just the descriptor (skip the auto-download when you'll fetch the bytes later).

```ts
// 1. Render and store
const doc = await client.render.document({
  project: 'billing',
  template: 'invoice',
  version: '1.0.0',
  data: { invoiceNumber: 'INV-001' },
  metadata: { customerId: 'cust_123' },  // your own audit data
});
// doc.documentId, doc.pageCount, doc.sizeBytes, doc.presignedPdfUrl, doc.metadata, ...

// 2. Save doc.documentId in your database
await db.invoices.update({ id: 'INV-001' }, { documentId: doc.documentId });

// 3. Later, fetch a fresh presigned URL + download
const fresh = await client.documents.get(doc.documentId);
const pdf = await fresh.downloadPdf();

// 4. Generate thumbnails
const thumbs = await client.documents.thumbnails(doc.documentId, { width: 320, format: 'png' });

// 5. When done, soft-delete
await client.documents.delete(doc.documentId);
```

The presigned URL has a 15-minute TTL. If `downloadPdf()` fails with `code: 'DOWNLOAD_FAILED'` (HTTP 403 from S3), call `documents.get(id)` to refresh and retry.

## Authentication & environments

The mode is determined by the API key prefix:

- `pp_test_…` → sandbox mode (not billed, generous rate limits)
- `pp_live_…` → live mode (billed, production rate limits)
- `pp_sa_…` → service-account keys; environment matches the SA's configuration (sandbox or live)

All prefixes hit the same endpoint (`https://api.poli.page`). The SDK passes the key through as a Bearer token and never inspects the prefix — pick whichever fits your deploy model.

## Methods

| Method | Returns | Description |
| ------ | ------- | ----------- |
| `client.render.pdf(input)` | `Promise<Uint8Array>` | Render a PDF, return bytes |
| `client.render.pdfStream(input)` | `Promise<ReadableStream<Uint8Array>>` | Render and stream the response |
| `client.render.preview(input)` | `Promise<PreviewResult>` | Paginated HTML preview |
| `client.render.document(input)` | `Promise<DocumentDescriptor>` | Render and return descriptor (skip auto-download) |
| `client.documents.get(id)` | `Promise<DocumentDescriptor>` | Retrieve a stored document |
| `client.documents.preview(id)` | `Promise<DocumentPreviewResult>` | Stored document's paginated HTML |
| `client.documents.thumbnails(id, options)` | `Promise<Thumbnail[]>` | Page thumbnails (PNG/JPEG, base64) |
| `client.documents.delete(id)` | `Promise<void>` | Soft-delete a stored document |
| `renderToFile(client, input, path)` *(from `@poli-page/sdk/node`)* | `Promise<void>` | Render and stream to disk (Node only) |

## Configuration

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `apiKey` | string | (required) | `pp_test_*` or `pp_live_*` API key |
| `baseUrl` | string | `https://api.poli.page` | API base URL |
| `maxRetries` | number | 2 | Max retry attempts on retryable errors |
| `retryDelay` | number (ms) | 500 | Base delay before the first retry |
| `timeout` | number (ms) | 60000 | Per-request timeout |
| `onRequest` | function | — | Called before each HTTP attempt |
| `onResponse` | function | — | Called on each successful response |
| `onRetry` | function | — | Called when a retry is scheduled |
| `onError` | function | — | Called when a call terminates in error |

## Error handling

The SDK throws a single error type, `PoliPageError`, for every failure (API errors, network failures, timeouts, caller cancellation):

```ts
import { PoliPage, PoliPageError } from '@poli-page/sdk';

try {
  await client.render.pdf({ ... });
} catch (err) {
  if (err instanceof PoliPageError) {
    if (err.isAuthError())       return refreshCredentials();
    if (err.isRateLimitError())  return queueForLater();
    if (err.isValidationError()) console.error('Bad input:', err.message);
    if (err.isNetworkError())    console.error('Network/timeout');
    if (err.isRetryable())       /* SDK already retried up to maxRetries */;
    console.error(err.code, err.status, err.requestId);
  }
  throw err;
}
```

For lifecycle and billing failures, route the user to actionable messages rather than treating them as opaque errors:

```ts
try {
  await client.render.document({ ... });
} catch (err) {
  if (err instanceof PoliPageError) {
    if (err.code === 'PAYMENT_REQUIRED')       return showBanner('Subscription has unpaid invoices.');
    if (err.code === 'ORGANIZATION_CANCELLED') return showBanner('Subscription cancelled — service is read-only.');
    if (err.code === 'ORGANIZATION_PURGED')    return showBanner('Organization has been purged.');
    if (err.code === 'DOCUMENT_NOT_FOUND')     return show404();
    if (err.code === 'GONE')                   return show410();   // document was soft-deleted
    // ... existing predicate-based handling above ...
  }
  throw err;
}
```

→ Full error reference: https://poli-page.github.io/sdk-node/reference/errors/

## Cancellation

Pass an `AbortSignal` to cancel a render in flight:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

const pdf = await client.render.pdf({ ..., signal: controller.signal });
```

When the signal aborts, the SDK throws `PoliPageError` with `code: 'aborted'`.

## Observability

Hooks fire at well-defined points. They are sync, optional, and never break the request:

```ts
const client = new PoliPage({
  apiKey: process.env.POLI_PAGE_API_KEY!,
  onRequest:  ({ method, url, attempt })           => log.debug({ method, url, attempt }),
  onResponse: ({ status, requestId, durationMs })  => metrics.histogram('poli.duration', durationMs),
  onRetry:    ({ attempt, delayMs, reason })       => log.warn(`retry ${attempt} after ${delayMs}ms: ${reason.code}`),
  onError:    (err)                                => sentry.captureException(err),
});
```

## Retries & idempotency

The SDK retries on **5xx**, **429**, **network errors**, and **timeouts**. Backoff is exponential (`retryDelay × 2^N`) with jitter, capped by `Retry-After` when the server provides it. Every call sends an auto-generated `Idempotency-Key` (UUID v4); pass `idempotencyKey` in the input to override.

→ Full retry semantics: https://poli-page.github.io/sdk-node/production/retries-and-idempotency/

## Type system

Full type definitions ship with the package. `RenderInput` is a discriminated union — invalid combos (e.g. `project` without `template`) fail at compile time.

## Concurrency & thread-safety

The client is safe to share across all async operations in a single Node process. Construct it once at startup; parallel calls to `render` are independent and share the underlying fetch connection pool. The client carries no per-request mutable state, so a single instance per process is the expected pattern.

## Runtime support

Server-side only. The SDK runs on any modern JavaScript server runtime:

- **Node.js** 20.18 or later
- **Cloudflare Workers**
- **Vercel Edge Runtime**
- **Deno**
- **Bun**

**Browsers are not supported.** API keys (`pp_test_*`, `pp_live_*`) are
secrets and must never be shipped to a browser. Call the SDK from your
backend and proxy the result to the client.

The main entry is fully isomorphic (no `node:*` imports). The Node-only
filesystem helper `renderToFile` lives at `@poli-page/sdk/node` and is
imported separately when needed.

## Requirements

Node.js 20.18 or later.

## Documentation & support

- Platform docs: [docs.poli.page](https://docs.poli.page)
- SDK documentation: [poli-page.github.io/sdk-node](https://poli-page.github.io/sdk-node/)
- Sign up & generate API keys: [app.poli.page](https://app.poli.page)
- Issues: [github.com/poli-page/sdk-node/issues](https://github.com/poli-page/sdk-node/issues)

## License

[MIT](LICENSE) © Poli Page
