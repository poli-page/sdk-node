import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import {
  polipagePreset,
  enforcePageShape,
  canonicalSlugs,
} from '@poli-page/starlight-preset';

export default defineConfig({
  site: 'https://poli-page.github.io',
  base: '/sdk-node',
  markdown: {
    remarkPlugins: [enforcePageShape, canonicalSlugs],
  },
  integrations: [
    starlight(
      polipagePreset({
        language: 'node',
        repo: 'poli-page/sdk-node',
        package: { kind: 'npm', name: '@poli-page/sdk' },
        minRuntime: '20.18',
      }),
    ),
  ],
});
