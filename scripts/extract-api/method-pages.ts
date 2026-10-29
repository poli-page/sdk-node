import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findFirst,
  renderTdType,
  summaryText,
  firstSentence,
  KIND,
  type TdNode,
  type TdParameter,
  type TdSignature,
} from './types-internal.js';

interface MethodTarget {
  readonly slug: string;
  readonly displayName: string;
  readonly exampleFile: string;
  readonly errorCodes: readonly string[];
  readonly locate: (td: TdNode) => TdNode | undefined;
}

// Codes a render can return; the byte-returning methods add DOWNLOAD_FAILED
// for the presigned-URL fetch that follows the render.
const RENDER_ERRORS: readonly string[] = [
  'VALIDATION_ERROR', 'INVALID_API_KEY', 'PROJECT_NOT_FOUND', 'PROJECT_NOT_IN_ENVIRONMENT', 'TEMPLATE_NOT_FOUND',
  'TEMPLATE_ERROR', 'TEMPLATE_UNSAFE', 'EMPTY_DOCUMENT', 'RENDER_BODY_TOO_LARGE', 'DOCUMENT_TOO_LARGE',
  'PROJECT_REQUIRED_FOR_DOCUMENT',
  'QUOTA_EXCEEDED', 'RATE_LIMIT_EXCEEDED', 'PUBLISH_IN_PROGRESS', 'RENDER_TIMEOUT',
  'timeout', 'network_error', 'aborted', 'INTERNAL_ERROR',
];

const METHODS: readonly MethodTarget[] = [
  {
    slug: 'render-pdf',
    displayName: 'render.pdf',
    exampleFile: 'render-pdf.ts',
    errorCodes: [...RENDER_ERRORS, 'DOWNLOAD_FAILED'],
    locate: (td) => findMethod(td, 'RenderNamespace', 'pdf'),
  },
  {
    slug: 'render-pdf-stream',
    displayName: 'render.pdfStream',
    exampleFile: 'render-pdf-stream.ts',
    errorCodes: [...RENDER_ERRORS, 'DOWNLOAD_FAILED'],
    locate: (td) => findMethod(td, 'RenderNamespace', 'pdfStream'),
  },
  {
    slug: 'render-document',
    displayName: 'render.document',
    exampleFile: 'render-document.ts',
    errorCodes: RENDER_ERRORS,
    locate: (td) => findMethod(td, 'RenderNamespace', 'document'),
  },
  {
    slug: 'documents-get',
    displayName: 'documents.get',
    exampleFile: 'documents-get.ts',
    errorCodes: ['DOCUMENT_NOT_FOUND', 'DOCUMENT_GONE', 'FORBIDDEN', 'INVALID_API_KEY', 'INTERNAL_ERROR'],
    locate: (td) => findMethod(td, 'DocumentsNamespace', 'get'),
  },
  {
    slug: 'documents-preview',
    displayName: 'documents.preview',
    exampleFile: 'documents-preview.ts',
    errorCodes: ['DOCUMENT_NOT_FOUND', 'DOCUMENT_GONE', 'FORBIDDEN', 'INVALID_API_KEY', 'INTERNAL_ERROR'],
    locate: (td) => findMethod(td, 'DocumentsNamespace', 'preview'),
  },
  {
    slug: 'documents-thumbnails',
    displayName: 'documents.thumbnails',
    exampleFile: 'documents-thumbnails.ts',
    errorCodes: ['DOCUMENT_NOT_FOUND', 'DOCUMENT_GONE', 'FORBIDDEN', 'THUMBNAILS_NOT_AVAILABLE', 'VALIDATION_ERROR', 'INVALID_API_KEY', 'INTERNAL_ERROR'],
    locate: (td) => findMethod(td, 'DocumentsNamespace', 'thumbnails'),
  },
  {
    slug: 'documents-delete',
    displayName: 'documents.delete',
    exampleFile: 'documents-delete.ts',
    errorCodes: ['DOCUMENT_NOT_FOUND', 'FORBIDDEN', 'ENVIRONMENT_PROTECTED', 'INVALID_API_KEY', 'INTERNAL_ERROR'],
    locate: (td) => findMethod(td, 'DocumentsNamespace', 'delete'),
  },
  {
    slug: 'render-to-file',
    displayName: 'renderToFile',
    exampleFile: 'render-to-file.ts',
    errorCodes: [...RENDER_ERRORS, 'DOWNLOAD_FAILED'],
    locate: (td) => findFirst(td, (n) => n.name === 'renderToFile' && n.kind === KIND.Function),
  },
];

export function buildMethodPages(td: TdNode, repoRoot: string): Array<{ slug: string; mdx: string }> {
  const pages: Array<{ slug: string; mdx: string }> = [];
  for (const m of METHODS) {
    const refl = m.locate(td);
    if (!refl) {
      throw new Error(`extractor: could not find ${m.displayName} in TypeDoc output`);
    }
    const examplePath = join(repoRoot, 'examples', m.exampleFile);
    const example = readFileSync(examplePath, 'utf8');
    pages.push({ slug: m.slug, mdx: renderMethodPage(m, refl, example) });
  }
  return pages;
}

function findMethod(td: TdNode, interfaceName: string, methodName: string): TdNode | undefined {
  const iface = findFirst(td, (n) => n.name === interfaceName && n.kind === KIND.Interface);
  return findFirst(iface, (n) => n.name === methodName && n.kind === KIND.Method);
}

function renderMethodPage(target: MethodTarget, refl: TdNode, example: string): string {
  const sig = refl.signatures?.[0];
  const summary = summaryText(sig?.comment);
  const lede = summary || `${target.displayName} method.`;
  const description = firstSentence(summary) || `${target.displayName} method.`;

  const signature = renderSignature(target.displayName, sig);
  const parameters = (sig?.parameters ?? []).map(renderParamRow);

  const parametersBlock = parameters.length === 0
    ? ''
    : `\n## Parameters\n\n<ParamsTable params={${JSON.stringify(parameters)}} />\n`;

  const returnType = renderTdType(sig?.type);
  const returnsBlock = returnType === 'unknown' ? '' : `\n## Returns\n\n\`${returnType}\`\n`;

  const errorsBlock = target.errorCodes.length === 0
    ? ''
    : `\n## Errors\n\n<ErrorTable errors={${JSON.stringify(
        target.errorCodes.map((code) => ({ code, when: 'See the [errors reference](../../errors/) for the full description.' })),
      )}} />\n`;

  const descLine = escapeFrontmatter(description);

  return `---
title: ${target.displayName}
description: ${descLine}
sidebar:
  label: ${target.displayName}
---

import MethodSignature from '@preset/components/MethodSignature.astro';
import ParamsTable from '@preset/components/ParamsTable.astro';
import ErrorTable from '@preset/components/ErrorTable.astro';

<MethodSignature lang="ts" code={\`${signature}\`} />

${lede}
${parametersBlock}${returnsBlock}${errorsBlock}
## Example

\`\`\`ts
${example.trimEnd()}
\`\`\`

## See also
- [Errors](../../../production/errors/)
- [Configuration](../../../concepts/configuration/)
`;
}

function renderParamRow(p: TdParameter): { name: string; type: string; required: boolean; description: string } {
  return {
    name: p.name,
    type: renderTdType(p.type),
    required: !p.flags?.isOptional,
    description: summaryText(p.comment) || '(no description)',
  };
}

function renderSignature(displayName: string, sig: TdSignature | undefined): string {
  const params = (sig?.parameters ?? [])
    .map((p) => `${p.name}${p.flags?.isOptional ? '?' : ''}: ${renderTdType(p.type)}`)
    .join(', ');
  const ret = renderTdType(sig?.type);
  return `${displayName}(${params}): ${ret}`;
}

function escapeFrontmatter(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\n/g, ' ').slice(0, 150);
}
