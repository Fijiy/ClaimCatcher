// The third-party notices check and copy (see scripts/notices.ts).
//
// Every `wxt build` (not dev, not the quality gate's `--mode eval` page,
// which never ships) records what goes into the extension: the modules and
// assets of each Vite build (the model worker's too) and the public files
// (ONNX Runtime's WASM, the models). When it's done, the build fails if
//   - an npm package in package.json's `dependencies`, or any package whose
//     code or files were bundled (or compiled into a bundled package), has
//     no entry in src/notices.ts, or
//   - a model under /models/ has no entry, or
//   - THIRD-PARTY-NOTICES.md isn't what `pnpm notices` would write.
// The file ships in the extension as /THIRD-PARTY-NOTICES.txt (Privacy &
// data links to it).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addViteConfig, defineWxtModule } from 'wxt/modules';
import { NOTICES } from '../src/notices.ts';
import { NOTICES_FILE, packagesIn, renderNotices, uncovered } from '../scripts/notices.ts';

export const SHIPPED_AS = 'THIRD-PARTY-NOTICES.txt';

type Bundle = Record<string, { type: 'chunk'; moduleIds: readonly string[] } | { type: 'asset'; originalFileNames: readonly string[] }>;

export default defineWxtModule((wxt) => {
  // Only builds that ship: not `wxt` (dev) or the quality gate's `--mode eval` page.
  if (wxt.config.command !== 'build' || wxt.config.mode === 'eval') return;

  const bundledFiles = new Set<string>();
  const models = new Set<string>();

  const record = (bundle: Bundle) => {
    for (const output of Object.values(bundle)) {
      const ids = output.type === 'chunk' ? output.moduleIds : output.originalFileNames;
      for (const id of ids) bundledFiles.add(id.replace(/^\0/, '').replace(/\?.*$/, ''));
    }
  };
  const name = 'claimcatcher:record-bundled-files';
  addViteConfig(wxt, () => ({
    plugins: [{ name, generateBundle: (_, bundle) => record(bundle) }],
    worker: { plugins: () => [{ name, generateBundle: (_, bundle) => record(bundle) }] },
  }));

  wxt.hook('build:publicAssets', (_, assets) => {
    for (const asset of assets) {
      if ('absoluteSrc' in asset) bundledFiles.add(asset.absoluteSrc);
      const model = /^models\/([^/]+\/[^/]+)\//.exec(asset.relativeDest);
      if (model) models.add(model[1]!);
    }
    // Chrome serves .txt from an extension without a charset; the byte-order mark makes it read UTF-8.
    assets.push({ relativeDest: SHIPPED_AS, contents: `\uFEFF${readFileSync(NOTICES_FILE, 'utf8')}` });
  });

  wxt.hook('build:done', () => {
    const root = wxt.config.root;
    const files = [...bundledFiles].map((id) => {
      const path = id.startsWith('/') ? id : join(root, id);
      // Prebuilt bundles name what they compiled in; only scripts are worth reading for that.
      const source = /node_modules/.test(path) && /\.[cm]?js$/.test(path) && existsSync(path) ? readFileSync(path, 'utf8') : undefined;
      return { path, source };
    });
    const { dependencies = {} } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    const missing = uncovered({ packages: [...Object.keys(dependencies), ...packagesIn(files)], models: [...models] }, NOTICES);

    const problems = [
      ...missing.packages.map((name) => `the npm package ${name} is bundled or a production dependency`),
      ...missing.models.map((name) => `the model ${name} is bundled (in /models/)`),
    ].map((problem) => `${problem}, but src/notices.ts has no entry for it`);
    if (readFileSync(NOTICES_FILE, 'utf8') !== renderNotices()) problems.push('THIRD-PARTY-NOTICES.md is out of date');
    if (problems.length) {
      throw new Error(`[notices] ${problems.join('; ')}. Add or fix the entry in src/notices.ts, then run pnpm notices.`);
    }
  });
});
