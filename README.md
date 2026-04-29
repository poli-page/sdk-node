# Poli Page SDK for Node.js

[![npm version](https://img.shields.io/npm/v/@poli-page/sdk.svg)](https://www.npmjs.com/package/@poli-page/sdk)
[![CI](https://github.com/poli-page/sdk-node/actions/workflows/ci.yml/badge.svg)](https://github.com/poli-page/sdk-node/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@poli-page/sdk.svg)](LICENSE)
[![node](https://img.shields.io/node/v/@poli-page/sdk.svg)](https://nodejs.org/)

Official Node.js SDK for [Poli Page](https://poli.page) — render polished PDFs from HTML templates via the Poli Page API.

→ API reference (auto-generated from source): **https://docs.poli.page/reference/sdk/node/**

## Install

```bash
npm install @poli-page/sdk
# or
pnpm add @poli-page/sdk
```

Requires Node.js 20.18 or later.

## Quick start

### Project mode — render a published template by slug

```ts
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

const pdf = await client.render({
  project: 'billing',
  template: 'invoice',
  data: { invoiceNumber: 'INV-001', total: 1280 },
});
// pdf is a Uint8Array
```

### Inline mode — pass raw HTML

```ts
const pdf = await client.render({
  template: '<h1>Hello {{ name }}</h1>',
  data: { name: 'World' },
});
```

### Write a PDF to disk

```ts
import { PoliPage } from '@poli-page/sdk';
import { renderToFile } from '@poli-page/sdk/node';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });
await renderToFile(
  client,
  { project: 'billing', template: 'invoice', data: { invoiceNumber: 'INV-001' } },
  './invoices/INV-001.pdf',
);
```

`renderToFile` streams response bytes directly to disk (bounded memory).

### Try it locally — runnable demos

The repo ships three end-to-end demos that exercise every public method against the real API:

```bash
pnpm demo        # Node ESM — start here
pnpm demo:cjs    # Node CommonJS (verifies the dual exports map)
pnpm demo:edge   # Cloudflare Worker (proof of edge-runtime support)
```

First run prompts for a `pp_test_*` key and saves it to `.env`. Subsequent runs are silent. Pick by target runtime — see [`demo/README.md`](demo/README.md#which-demo-for-which-use-case) for the full decision guide and what each demo proves.

### Stream — for large PDFs or piping to S3 / HTTP responses

```ts
const stream = await client.renderStream({
  project: 'billing',
  template: 'invoice',
  data: { ... },
});
// stream is a ReadableStream<Uint8Array>
await s3.upload({ Bucket: 'invoices', Key: 'INV-001.pdf', Body: stream }).promise();
```

## Authentication & environments

The mode is determined by the API key prefix:

- `pp_test_…` → sandbox mode (not billed, generous rate limits)
- `pp_live_…` → live mode (billed, production rate limits)

Both prefixes hit the same endpoint (`https://api.poli.page`).

For the develop environment:
```ts
const client = new PoliPage({
  apiKey: process.env.POLI_PAGE_API_KEY!,
  baseUrl: 'https://api-develop.poli.page',
});
```

## Methods

| Method | Returns | Description |
| ------ | ------- | ----------- |
| `render(input)` | `Promise<Uint8Array>` | Render a PDF, return bytes |
| `renderStream(input)` | `Promise<ReadableStream<Uint8Array>>` | Render and stream the response |
| `preview(input)` | `Promise<{ html, totalPages }>` | Paginated HTML preview |
| `thumbnails(input, options)` | `Promise<Thumbnail[]>` | Page thumbnails as base64 images |
| `renderToFile(client, input, path)` *(from `@poli-page/sdk/node`)* | `Promise<void>` | Render a PDF and stream it to disk |

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
  await client.render({ ... });
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

→ Full error reference: https://docs.poli.page/reference/sdk/node/classes/index.PoliPageError.html

## Cancellation

Pass an `AbortSignal` to cancel a render in flight:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

const pdf = await client.render({ ..., signal: controller.signal });
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

→ Full retry semantics: https://docs.poli.page/reference/sdk/node/classes/index.PoliPage.html#render

## TypeScript

Full type definitions ship with the package. `RenderInput` is a discriminated union — invalid combos (e.g. `project` without `template`) fail at compile time.

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
- SDK API reference: [docs.poli.page/reference/sdk/node](https://docs.poli.page/reference/sdk/node/)
- Sign up & generate API keys: [app.poli.page](https://app.poli.page)
- Issues: [github.com/poli-page/sdk-node/issues](https://github.com/poli-page/sdk-node/issues)
- Security: see [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE) © Poli Page
