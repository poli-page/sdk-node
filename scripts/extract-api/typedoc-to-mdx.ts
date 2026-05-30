import { findFirst, summaryText, type TdNode, KIND } from './types-internal.js';

export function buildClientPage(td: TdNode): string {
  const cls = findFirst(td, (n) => n.name === 'PoliPage' && n.kind === KIND.Class);
  const lede = summaryText(cls?.comment) || 'The Poli Page client — the single entry point to the Node.js SDK.';

  return `---
title: Client
description: The PoliPage class — the only entry point to the Node.js SDK.
---

import MethodSignature from '@poli-page/starlight-preset/components/MethodSignature.astro';

<MethodSignature lang="ts" code={\`new PoliPage(options: PoliPageOptions)\`} />

${lede}

## Constructor

The constructor takes a single options object. The only required field is \`apiKey\`. See [\`PoliPageOptions\`](../types/) for every field.

## Namespaces

The client exposes two namespaces:

- [\`render\`](./methods/render-pdf/) — render PDFs (in memory, streaming, or to a stored document).
- [\`documents\`](./methods/documents-get/) — fetch, preview, thumbnail, or delete stored documents.

The standalone helper [\`renderToFile\`](./methods/render-to-file/) ships from the \`@poli-page/sdk/node\` subexport.

## See also
- [Types](../types/)
- [Errors](../errors/)
- [Runtime support](../runtime-support/)
`;
}
