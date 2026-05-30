import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClientPage } from './typedoc-to-mdx.js';
import { buildMethodPages } from './method-pages.js';
import { buildTypesPage } from './types-page.js';
import { buildErrorsPage } from './errors-page.js';
import { buildRuntimeSupportPage } from './runtime-support-page.js';
import { buildMetaSidecar } from './meta-sidecar.js';
import type { TdNode } from './types-internal.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const REFERENCE_OUT = resolve(REPO_ROOT, 'docs', 'src', 'content', 'docs', 'reference');
const TYPEDOC_JSON = resolve(REPO_ROOT, 'scripts', 'extract-api', '.cache', 'typedoc.json');

interface PackageJson {
  readonly version: string;
}

function run(): void {
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as PackageJson;

  // 1. Clear previous output.
  if (existsSync(REFERENCE_OUT)) rmSync(REFERENCE_OUT, { recursive: true, force: true });
  mkdirSync(REFERENCE_OUT, { recursive: true });
  mkdirSync(join(REFERENCE_OUT, 'methods'), { recursive: true });

  // 2. Run TypeDoc in JSON mode.
  mkdirSync(dirname(TYPEDOC_JSON), { recursive: true });
  execSync(`npx typedoc --json ${TYPEDOC_JSON}`, { cwd: REPO_ROOT, stdio: 'inherit' });
  const td = JSON.parse(readFileSync(TYPEDOC_JSON, 'utf8')) as TdNode;

  // 3. Build each page.
  writeFileSync(join(REFERENCE_OUT, 'client.mdx'), buildClientPage(td), 'utf8');
  for (const m of buildMethodPages(td, REPO_ROOT)) {
    writeFileSync(join(REFERENCE_OUT, 'methods', `${m.slug}.mdx`), m.mdx, 'utf8');
  }
  writeFileSync(join(REFERENCE_OUT, 'types.mdx'), buildTypesPage(td), 'utf8');
  writeFileSync(join(REFERENCE_OUT, 'errors.mdx'), buildErrorsPage(), 'utf8');
  writeFileSync(join(REFERENCE_OUT, 'runtime-support.mdx'), buildRuntimeSupportPage(pkg.version), 'utf8');
  writeFileSync(
    join(REFERENCE_OUT, '_meta.json'),
    JSON.stringify(buildMetaSidecar(pkg.version), null, 2) + '\n',
    'utf8',
  );

  console.log(`extractor: wrote ${REFERENCE_OUT}`);
}

run();
