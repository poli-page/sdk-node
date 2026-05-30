export function buildRuntimeSupportPage(packageVersion: string): string {
  return `---
title: Runtime support
description: Supported Node.js versions and operating systems for @poli-page/sdk v${packageVersion}.
---

import RuntimeMatrix from '@poli-page/starlight-preset/components/RuntimeMatrix.astro';

The Node.js SDK is built and tested against the matrix below.

<RuntimeMatrix matrix={{
  runtimes: ['20.x', '22.x', '24.x'],
  os: ['linux', 'macos', 'windows'],
  cells: {
    '20.x': { linux: 'tested', macos: 'tested', windows: 'supported' },
    '22.x': { linux: 'tested', macos: 'tested', windows: 'tested' },
    '24.x': { linux: 'supported', macos: 'supported', windows: 'supported' },
  },
}} />

The minimum supported Node.js version is **20.18.0**. Earlier versions lack the global \`fetch\` and \`ReadableStream\` the SDK depends on.

## Runtimes that are not Node

The main SDK entry point (\`@poli-page/sdk\`) targets any modern JavaScript server runtime with \`fetch\` and \`ReadableStream\`. The \`renderToFile\` helper from \`@poli-page/sdk/node\` is Node-only because it uses \`node:fs\`.
`;
}
