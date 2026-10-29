# Poli Page SDK for Node.js

[![Npm](https://img.shields.io/npm/v/@poli-page/sdk?style=flat&logo=nodedotjs&logoColor=ffffff&label=Npm)](https://www.npmjs.com/package/@poli-page/sdk)
[![Downloads](https://img.shields.io/npm/dm/@poli-page/sdk?style=flat&logo=nodedotjs&logoColor=ffffff&label=Downloads)](https://www.npmjs.com/package/@poli-page/sdk)
[![Ci](https://img.shields.io/github/actions/workflow/status/poli-page/sdk-node/ci.yml?branch=main&style=flat&logo=githubactions&logoColor=ffffff&label=Ci)](https://github.com/poli-page/sdk-node/actions/workflows/ci.yml)
[![Codeql](https://img.shields.io/github/actions/workflow/status/poli-page/sdk-node/codeql.yml?branch=main&style=flat&logo=github&logoColor=ffffff&label=Codeql)](https://github.com/poli-page/sdk-node/actions/workflows/codeql.yml)
[![Coverage](https://img.shields.io/codecov/c/github/poli-page/sdk-node/main?style=flat&logo=codecov&logoColor=ffffff&label=Coverage)](https://codecov.io/gh/poli-page/sdk-node)
[![Node](https://img.shields.io/node/v/@poli-page/sdk?style=flat&logo=nodedotjs&logoColor=ffffff&label=Node)](https://nodejs.org/)
[![Types](https://img.shields.io/npm/types/@poli-page/sdk?style=flat&logo=nodedotjs&logoColor=ffffff&label=Types)](https://www.npmjs.com/package/@poli-page/sdk)
[![Install size](https://img.shields.io/npm/unpacked-size/@poli-page/sdk?style=flat&logo=nodedotjs&logoColor=ffffff&label=Install%20size)](https://www.npmjs.com/package/@poli-page/sdk)
[![Bundle](https://img.shields.io/bundlephobia/minzip/@poli-page/sdk?style=flat&logo=nodedotjs&logoColor=ffffff&label=Bundle)](https://bundlephobia.com/package/@poli-page/sdk)
[![Deps](https://img.shields.io/badge/Deps-up%20to%20date-brightgreen?style=flat&logo=nodedotjs&logoColor=ffffff)](https://github.com/poli-page/sdk-node/network/dependencies)
[![Docs](https://img.shields.io/badge/Docs-online-brightgreen?style=flat&logo=readthedocs&logoColor=ffffff)](https://poli-page.github.io/sdk-node/)
[![License](https://img.shields.io/npm/l/@poli-page/sdk?style=flat&logo=gnu&logoColor=ffffff&label=License)](LICENSE)

Official Node.js SDK for [Poli Page](https://poli.page) — render polished PDFs from HTML templates via the Poli Page API.

→ **Documentation**: https://poli-page.github.io/sdk-node/

## Install

```bash
npm install @poli-page/sdk
```

Requires Node.js 20.18 or later.

## Quick start

### Render a template by slug

Set `POLI_PAGE_API_KEY` to a `sandbox` key of a fresh organization (`pp_sandbox_…`, see [Authentication & environments](#authentication--environments)), then:

```ts
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({
  apiKey: process.env.POLI_PAGE_API_KEY!,
  // Optional: defaults to https://api.poli.page.
  baseUrl: process.env.POLI_PAGE_BASE_URL,
});

const pdf = await client.render.pdf({
  project: 'getting-started',
  template: 'welcome',
  data: { name: 'SDK Demo' },
});
// pdf is a Uint8Array
```

> **The host is configurable.** Without `baseUrl`, the SDK targets
> `https://api.poli.page`. The SDK does **not** read environment variables at
> runtime: resolve the host in your own app code (as shown above) and pass it
> in explicitly.

Every organization gets a `getting-started` project, published into its `sandbox` environment when the organization is created, with a `welcome` template. A sandbox key renders it with no setup, so the snippet above runs as-is on a fresh organization. It is a normal, editable project: in an organization that renamed it, deleted it or removed it from `sandbox`, the API answers `404 PROJECT_NOT_FOUND` or `404 PROJECT_NOT_IN_ENVIRONMENT`, so use a fresh organization to follow along.

There is no version to pick: a render uses the project's copy published in the API key's environment. For your own templates, publish the project to the environment of the key you render with, then swap the slugs:

```ts
const pdf = await client.render.pdf({
  project: 'billing',
  template: 'invoice',
  data: { invoiceNumber: 'INV-001', total: 1280 },
});
```

To preview a template or render inline HTML while you design it, use the playground: https://play.poli.page. The API and this SDK render published templates only.

### Write a PDF to disk

```ts
import { PoliPage } from '@poli-page/sdk';
import { renderToFile } from '@poli-page/sdk/node';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });
await renderToFile(
  client,
  { project: 'getting-started', template: 'welcome', data: { name: 'SDK Demo' } },
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

First run prompts for a `sandbox` key (`pp_sandbox_…`) and saves it to `.env`. Subsequent runs are silent. Each demo renders `getting-started`/`welcome` and walks nine steps: `render.pdf` → `render.pdfStream` → `renderToFile` → `render.document` → `documents.get` → `documents.thumbnails` → `documents.preview` → `documents.delete` → `not-found` (a render of a template that does not exist, caught as `PoliPageError` with code `TEMPLATE_NOT_FOUND`). Pick by target runtime — see [`demo/README.md`](demo/README.md#which-demo-for-which-use-case) for the full decision guide and what each demo proves.

### Stream — for large PDFs or piping to S3 / HTTP responses

```ts
const stream = await client.render.pdfStream({
  project: 'billing',
  template: 'invoice',
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

The presigned URL has a 15-minute TTL. If `downloadPdf()` fails with `code: 'DOWNLOAD_FAILED'` (HTTP 403 from S3), call `documents.get(id)` to refresh and retry. `DOWNLOAD_FAILED` is never retryable, whatever the storage status: the SDK does not retry it and `isRetryable()` is `false`.

## Authentication & environments

An API key belongs to exactly one environment of your organization, and its text names that environment: a key is `pp_{env}_{32 lowercase hex}`, matching

```text
^pp_(?=[a-z][a-z0-9-]{0,19}_)[a-z][a-z0-9]*(?:-[a-z0-9]+)*_[0-9a-f]{32}$
```

The API resolves the environment from the key and renders the project's copy published there; the SDK never sends an environment.

| Environment                           | Key            | Watermark | Counted |
| ------------------------------------- | -------------- | --------- | ------- |
| `sandbox` (every org)                 | `pp_sandbox_…` | yes       | no      |
| `live` (every org, deletable on Pro+) | `pp_live_…`    | no        | yes     |
| created on Pro+ (e.g. `staging`)      | `pp_staging_…` | no        | yes     |

"Counted" means the render counts toward the organization's monthly PDF quota. `sandbox` renders are watermarked, are not counted, and their documents expire 30 days after creation. There is no watermark option: a template that wants a watermark outside `sandbox` uses the `poli-watermark` class.

Standard and service keys share this one format. Every key hits the same endpoint, `https://api.poli.page` by default or whatever you pass as `baseUrl` (see [Configuration](#configuration)). The SDK passes the key through as a Bearer token and does not check its format.

## Methods

| Method | Returns | Description |
| ------ | ------- | ----------- |
| `client.render.pdf(input)` | `Promise<Uint8Array>` | Render a PDF, return bytes |
| `client.render.pdfStream(input)` | `Promise<ReadableStream<Uint8Array>>` | Render and stream the response |
| `client.render.document(input)` | `Promise<DocumentDescriptor>` | Render and return descriptor (skip auto-download) |
| `client.documents.get(id, { signal }?)` | `Promise<DocumentDescriptor>` | Retrieve a stored document |
| `client.documents.preview(id, { signal }?)` | `Promise<DocumentPreviewResult>` | Stored document's paginated HTML |
| `client.documents.thumbnails(id, options?, { signal }?)` | `Promise<Thumbnail[]>` | Page thumbnails (JPEG/WebP/PNG, base64) |
| `client.documents.delete(id, { signal }?)` | `Promise<void>` | Soft-delete a stored document |
| `renderToFile(client, input, path)` *(from `@poli-page/sdk/node`)* | `Promise<void>` | Render and stream to disk (Node only) |

## Configuration

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `apiKey` | string | (required) | API key; it belongs to one environment (see [Authentication & environments](#authentication--environments)) |
| `baseUrl` | string | `https://api.poli.page` | API base URL |
| `maxRetries` | number | 2 | Max retry attempts on retryable errors |
| `retryDelay` | number (ms) | 500 | Base delay before the first retry |
| `timeout` | number (ms) | 60000 | Per-request timeout |
| `onRequest` | function | — | Called before each HTTP attempt |
| `onResponse` | function | — | Called on each successful response, once its body is read |
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
    if (err.code === 'ORGANIZATION_PAYMENT_GRACE') return showBanner('Subscription has unpaid invoices.');
    if (err.code === 'ORGANIZATION_CANCELLED')     return showBanner('Subscription cancelled — service is read-only.');
    if (err.code === 'ORGANIZATION_PURGED')        return showBanner('Organization has been purged.');
    if (err.code === 'PROJECT_NOT_IN_ENVIRONMENT') return showBanner('Publish the project to this key\'s environment.');
    if (err.code === 'DOCUMENT_NOT_FOUND')         return show404();
    if (err.code === 'DOCUMENT_GONE')              return show410();   // document was deleted or expired
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

The `documents` methods take the signal as a last argument:

```ts
const doc = await client.documents.get(documentId, { signal: controller.signal });
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

The SDK retries on **5xx**, **429**, **network errors**, and **timeouts**, except `QUOTA_EXCEEDED`, `OVERAGE_CAP_EXCEEDED` (429) and `STORAGE_ACCESS_DENIED` (502), which waiting cannot fix: those are thrown at once. Before retry `n` (1-based) the SDK waits `retryDelay × 2^(n−1) × j`, with `j` a random factor in `[0.5, 1.5)`; a `Retry-After` header (seconds or HTTP-date, clamped to 30 s) replaces it when the server sends one. Every POST sends an auto-generated `Idempotency-Key` (UUID v4), the same on every retry of that call; the API does not deduplicate on it. Pass `idempotencyKey` in the input to override.

→ Full retry semantics: https://poli-page.github.io/sdk-node/production/retries-and-idempotency/

## Type system

Full type definitions ship with the package. `RenderInput` is the one input type of every render method: `project`, `template` and `data` are required. A field the API does not accept (such as `version`) fails at compile time in an object literal; passed through a variable, it compiles but the SDK never sends it.

## Concurrency & thread-safety

The client is safe to share across all async operations in a single Node process. Construct it once at startup; parallel calls to `render` are independent and share the underlying fetch connection pool. The client carries no per-request mutable state, so a single instance per process is the expected pattern.

## Runtime support

Server-side only. The SDK runs on any modern JavaScript server runtime:

- **Node.js** 20.18 or later
- **Cloudflare Workers**
- **Vercel Edge Runtime**
- **Deno**
- **Bun**

**Browsers are not supported.** API keys, whatever their environment, are
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

## Testing

`npm test` runs the unit tests. CI also runs `tests/contract.test.ts` against the [Poli Page API contract](https://github.com/poli-page/api-contract), pinned by commit in `.github/workflows/ci.yml`: every SDK case of `contract.json` runs against a local mock server. To run it locally, download that version's `contract.json` and run `POLI_CONTRACT=<path to contract.json> npm test`. Case ids allowed to fail are listed, with the reason, in `tests/contract-skip.json`.

## License

[MIT](LICENSE) © Poli Page
