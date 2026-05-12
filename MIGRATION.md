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
client.render.pdf(input)          // → Uint8Array
client.render.pdfStream(input)    // → ReadableStream<Uint8Array>
client.render.preview(input)      // → { html, totalPages, metadata? }
client.render.document(input)     // → DocumentDescriptor (Starter+)

// Documents namespace (Starter+)
client.documents.get(id)              // → DocumentDescriptor
client.documents.preview(id)          // → { html, totalPages }
client.documents.thumbnails(id, opts) // → Thumbnail[]
client.documents.delete(id)           // → void

// Sub-export (Node only)
import { renderToFile } from '@poli-page/sdk/node';
renderToFile(client, input, path)     // → void
```

### Renames from the pre-1.0 shape

| Pre-1.0 (`0.1.0` and earlier dev versions) | 1.0.0 |
|---|---|
| `client.render(input)` | `client.render.pdf(input)` |
| `client.renderStream(input)` | `client.render.pdfStream(input)` |
| `client.preview(input)` | `client.render.preview(input)` |
| `client.thumbnails(input, options)` | *Retired — use `client.documents.thumbnails(id, options)` against a stored document* |

### Storage workflow (new in 1.0)

`render.document` is a render that **stores** the result server-side and
returns a descriptor instead of bytes. Persist `documentId` in your database;
fetch bytes on demand via `documents.get(id).downloadPdf()`. The presigned
URL is short-lived (15 min) — refresh via `documents.get` when needed.

See [CHANGELOG.md](CHANGELOG.md) for the full per-feature list.
