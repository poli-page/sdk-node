import { findFirst, summaryText, type TdNode, KIND } from './types-internal.js';

// Public types/interfaces to surface on the Reference > Types page, in this order.
const PUBLIC_TYPES = [
  'PoliPageOptions',
  'RenderInput',
  'ProjectModeInput',
  'InlineModeInput',
  'PreviewResult',
  'DocumentDescriptor',
  'DocumentPreviewResult',
  'Thumbnail',
  'ThumbnailOptions',
  'PageFormat',
  'Orientation',
  'RenderMetadata',
  'RenderNamespace',
  'DocumentsNamespace',
  'RequestEvent',
  'ResponseEvent',
  'RetryEvent',
] as const;

export function buildTypesPage(td: TdNode): string {
  const blocks: string[] = [];
  for (const name of PUBLIC_TYPES) {
    const node = findFirst(td, (n) => n.name === name && (n.kind === KIND.Interface || n.kind === KIND.Class));
    if (!node) continue; // type aliases (e.g. RenderInput) aren't kind=Interface; skip silently
    const lede = summaryText(node.comment) || '';
    blocks.push(`### \`${name}\`\n\n${lede || `_(See the source for the full definition.)_`}\n`);
  }

  return `---
title: Types
description: Public types and interfaces exported from @poli-page/sdk.
---

The Node.js SDK exposes the types below. Import any of them with a type-only import:

\`\`\`ts
import type { PoliPageOptions, RenderInput, DocumentDescriptor } from '@poli-page/sdk';
\`\`\`

${blocks.join('\n')}

For type aliases (\`PageFormat\`, \`Orientation\`, \`RenderInput\`, \`RenderMetadata\`, \`PoliPageErrorCode\`) and the full set of fields on each interface, see [the source on GitHub](https://github.com/poli-page/sdk-node/blob/main/src/types.ts).
`;
}
