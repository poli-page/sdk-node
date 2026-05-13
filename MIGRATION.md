# Migration Guide

This file documents breaking changes between major versions of `@poli-page/sdk`.
Follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html): breaking
changes only ship in major version bumps and always come with an entry here.

## 1.0

The first stable release. The pre-1.0 line (`0.1.0`) was published briefly and
unpublished from npm — no live users. Treat `1.0.0` as the starting point.

### Surface

```ts
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({ apiKey });

// Render namespace
// render.pdf, render.pdfStream, render.document → project mode only (project + template + version)
// render.preview → accepts both project mode and inline HTML
client.render.pdf(input)          // → Uint8Array  (two HTTP calls internally)
client.render.pdfStream(input)    // → ReadableStream<Uint8Array>  (two HTTP calls internally)
client.render.preview(input)      // → { html, totalPages, environment }
client.render.document(input)     // → DocumentDescriptor  (skip auto-download)

// Documents namespace
client.documents.get(id)              // → DocumentDescriptor
client.documents.preview(id)          // → DocumentPreviewResult { html, pageCount }
client.documents.thumbnails(id, opts) // → Thumbnail[]
client.documents.delete(id)           // → void

// Sub-export (Node only)
import { renderToFile } from '@poli-page/sdk/node';
renderToFile(client, input, path)     // → void
```

### Auto-provisioned `getting-started/welcome` template

Every Poli Page org is created with a `getting-started/welcome/1.0.0` template already in place. You can call `client.render.pdf({ project: 'getting-started', template: 'welcome', version: '1.0.0', data: {...} })` the moment your API key is active — no `poli init` / `poli push` required. The SDK Quick Start example, the demos, and the integration tests in this repo all default to this template so they run for any new user.

### Renames from the pre-1.0 shape

| Pre-1.0 (`0.1.0` and earlier dev versions) | 1.0.0 |
|---|---|
| `client.render(input)` | `client.render.pdf(input)` |
| `client.renderStream(input)` | `client.render.pdfStream(input)` |
| `client.preview(input)` | `client.render.preview(input)` |
| `client.thumbnails(input, options)` | *Retired — use `client.documents.thumbnails(id, options)` against a stored document* |

### Render is always a stored document

Every `render.*` (except `render.preview`) produces a stored document server-side. `render.pdf` and `render.pdfStream` are SDK conveniences that chain a presigned-URL fetch internally to return PDF bytes. `render.document` returns just the descriptor — use it when you'd rather hold the `documentId` and fetch bytes later.

This means `render.pdf` makes two HTTP calls (`POST /v1/render` + `GET presignedPdfUrl`). Same throughput characteristics as before; only network-log visibility differs.

`render.preview` is the exception — it doesn't store and returns paginated HTML directly. It's also the only render method that accepts inline-mode HTML.

### Storage workflow (new in 1.0)

`render.document` is a render that **stores** the result server-side and
returns a descriptor instead of bytes. Persist `documentId` in your database;
fetch bytes on demand via `documents.get(id).downloadPdf()`. The presigned
URL is short-lived (15 min) — refresh via `documents.get` when needed.

See [CHANGELOG.md](CHANGELOG.md) for the full per-feature list.
