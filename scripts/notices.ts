// The third-party notices: THIRD-PARTY-NOTICES.md, rendered from the list
// in src/notices.ts with the installed versions, the bundled MBFC snapshot
// and the licence texts, and the check the build runs (modules/notices.ts).
//
//   pnpm notices    rewrite THIRD-PARTY-NOTICES.md

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LICENCES, NOTICES, type LicenceId, type Notice } from '../src/notices.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const NOTICES_FILE = join(root, 'THIRD-PARTY-NOTICES.md');
const MBFC_SNAPSHOT = join(root, 'src/session/sources/mbfc-snapshot.json');

/** What one build put in the extension. */
export interface Bundled {
  /** npm package names. */
  packages: string[];
  /** Folders under /models/, `<owner>/<name>`. */
  models: string[];
}

/** The package a file in node_modules belongs to (the innermost one), if any. */
function packageOf(path: string): string | undefined {
  const parts = path.split(/[\\/]/);
  const at = parts.lastIndexOf('node_modules');
  if (at < 0 || at + 1 >= parts.length) return undefined;
  const first = parts[at + 1]!;
  return first.startsWith('@') ? (parts[at + 2] ? `${first}/${parts[at + 2]}` : undefined) : first;
}

/** esbuild's `// <path>` region comments, which name the files a prebuilt bundle compiled in. */
const REGION = /^\/\/ (\S*node_modules\/\S+)$/gm;

/**
 * The npm packages a build's files come from: each file's own package, plus
 * any a prebuilt file compiled in (Transformers.js ships with its tokenizer
 * and template engine inside), when its `source` is given.
 */
export function packagesIn(files: { path: string; source?: string }[]): string[] {
  const found = new Set<string>();
  for (const { path, source } of files) {
    const own = packageOf(path);
    if (!own) continue;
    found.add(own);
    for (const [, inner] of source?.matchAll(REGION) ?? []) {
      const name = packageOf(inner!);
      if (name) found.add(name);
    }
  }
  return [...found];
}

/** The bundled packages and models that no notice covers, each sorted. */
export function uncovered(bundled: Bundled, notices: readonly Notice[]): Bundled {
  const packages = new Set(notices.flatMap((n) => n.packages ?? []));
  const models = new Set(notices.flatMap((n) => (n.model ? [n.model] : [])));
  return {
    packages: [...new Set(bundled.packages)].filter((p) => !packages.has(p)).sort(),
    models: [...new Set(bundled.models)].filter((m) => !models.has(m)).sort(),
  };
}

const SECTIONS: { kind: Notice['kind']; title: string }[] = [
  { kind: 'data', title: 'Ratings data' },
  { kind: 'model', title: 'Models' },
  { kind: 'dataset', title: 'Datasets (not bundled; the models above were trained on them)' },
  { kind: 'library', title: 'Libraries' },
  { kind: 'typeface', title: 'Typeface' },
];

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** An installed package's folder: a direct dependency, or one found beside a package already found. */
function findPackage(name: string, near: string[]): string | undefined {
  const direct = join(root, 'node_modules', name);
  if (existsSync(join(direct, 'package.json'))) return realpathSync(direct);
  for (const start of near) {
    for (let dir = start; dirname(dir) !== dir; dir = dirname(dir)) {
      const candidate = basename(dir) === 'node_modules' ? join(dir, name) : join(dir, 'node_modules', name);
      if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    }
  }
  return undefined;
}

/** Every listed package's installed folder. */
function packageFolders(notices: readonly Notice[]): Map<string, string> {
  const found = new Map<string, string>();
  const wanted = notices.flatMap((n) => n.packages ?? []);
  // Packages compiled into another one are found beside it, so go round until nothing new turns up.
  for (let progress = true; progress; ) {
    progress = false;
    for (const name of wanted) {
      if (found.has(name)) continue;
      const dir = findPackage(name, [...found.values()]);
      if (dir) found.set(name, dir), (progress = true);
    }
  }
  const missing = wanted.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`[notices] not installed: ${missing.join(', ')} (run pnpm install)`);
  return found;
}

function licenceText(id: LicenceId, folders: Map<string, string>): string {
  switch (id) {
    case 'MIT':
      return `Applies with each MIT entry's copyright line above.\n\n\`\`\`\n${MIT_TEXT}\n\`\`\``;
    case 'Apache-2.0':
      return `\`\`\`\n${readFileSync(join(folders.get('@huggingface/transformers')!, 'LICENSE'), 'utf8').trimEnd()}\n\`\`\``;
    case 'OFL-1.1':
      return `\`\`\`\n${readFileSync(join(folders.get('@fontsource-variable/atkinson-hyperlegible-next')!, 'LICENSE'), 'utf8').trimEnd()}\n\`\`\``;
    case 'CC-BY-4.0':
      return `The full legal code: ${LICENCES[id].url}`;
    case 'MBFC':
      return `MBFC's fair-use policy: ${LICENCES[id].url}`;
  }
}

interface SnapshotFacts {
  source: { repo: string; commit: string; path: string; url: string };
  snapshotDate: string;
  dataUpdated: string;
}

function entry(notice: Notice, folders: Map<string, string>, snapshot: SnapshotFacts): string {
  const lines = [`### ${notice.name}`, '', `- Licence: ${LICENCES[notice.licence].name}`, `- By: ${notice.by}`];
  lines.push(`- Copyright: ${notice.copyright}`, `- From: ${notice.origin}`);
  if (notice.source) lines.push(`- Copy from: ${notice.source}`);
  if (notice.revision) lines.push(`- Revision: ${notice.revision}`);
  if (notice.packages?.length) {
    const versions = notice.packages.map((name) => {
      const { version } = JSON.parse(readFileSync(join(folders.get(name)!, 'package.json'), 'utf8')) as { version: string };
      return `${name} ${version}`;
    });
    lines.push(`- Version: ${versions.join('; ')} (npm)`);
  }
  if (notice.kind === 'data') {
    const { source, snapshotDate, dataUpdated } = snapshot;
    lines.push(
      `- Snapshot: ${source.repo} ${source.path} at commit ${source.commit}, of ${snapshotDate} (the file last changed upstream on ${dataUpdated}): ${source.url}`,
    );
  }
  lines.push(`- Used for: ${notice.use}`);
  for (const note of notice.notes ?? []) lines.push(`- Note: ${note}`);
  return lines.join('\n');
}

/** THIRD-PARTY-NOTICES.md as it should be now. */
export function renderNotices(notices: readonly Notice[] = NOTICES): string {
  const folders = packageFolders(notices);
  const snapshot = JSON.parse(readFileSync(MBFC_SNAPSHOT, 'utf8')) as SnapshotFacts;
  const parts = [
    '# Third-party notices',
    '',
    'ClaimCatcher bundles, or was built from, the data, models, libraries and typeface below. Each entry gives its licence, ' +
      'who made it and where it came from; the licence texts are at the end. Everything else in ClaimCatcher is the ' +
      "entrant's own work. Not part of the package: Gemini Nano (local mode's model comes with Google Chrome) and Venice " +
      '(the cloud service the viewer brings a key for).',
    '',
    'This file is generated from `src/notices.ts` by `pnpm notices`. The build fails if it bundles an npm package or a ' +
      'model this file does not list, or if this file is out of date.',
  ];
  for (const { kind, title } of SECTIONS) {
    const inSection = notices.filter((n) => n.kind === kind);
    if (!inSection.length) continue;
    parts.push('', `## ${title}`);
    for (const notice of inSection) parts.push('', entry(notice, folders, snapshot));
  }
  parts.push('', '## Licence texts');
  for (const id of new Set(notices.map((n) => n.licence))) {
    parts.push('', `#### ${LICENCES[id].name}`, '', licenceText(id, folders));
  }
  return `${parts.join('\n')}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(NOTICES_FILE, renderNotices());
  console.log(`[notices] wrote ${NOTICES_FILE}`);
}
