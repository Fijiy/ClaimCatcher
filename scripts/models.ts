// Build step: makes the on-device models the extension bundles, in
// public/models/ (git-ignored). Runs before every WXT build (wxt.config.ts);
// a model that is already there is left alone, so only the first run is slow.
//
//   claim filter  sachaljawad/claimbuster-detector (DistilBERT, MIT; trained on
//                 ClaimBuster, CC-BY-4.0), exported to ONNX and quantized to
//                 8 bits (per channel) by scripts/claim-filter/export.py at a
//                 pinned revision
//   speech-to-text  onnx-community/moonshine-base-ONNX (Moonshine base by
//                 Useful Sensors, MIT), its 8-bit encoder and merged decoder,
//                 downloaded from the Hugging Face Hub at a pinned revision and
//                 checked against pinned sha256s (about 67 MB)
//   voice separation  onnx-community/pyannote-segmentation-3.0 (pyannote,
//                 MIT) and onnx-community/wespeaker-voxceleb-resnet34-LM
//                 (WeSpeaker, CC-BY-4.0), 8-bit, downloaded the same way
//                 (about 8 MB)
//
// Models are fetched here, at build time, and nowhere else: the extension
// loads them from its own files and never from the network.
//
// The export needs Python 3.12 (set PYTHON to choose one) and makes a venv
// with pinned tools in .cache/model-export/venv (set CLAIMCATCHER_EXPORT_VENV
// to share one between checkouts). The first run downloads about 1 GB of
// tools and the 268 MB model, once.
//
//   pnpm models                     build whatever is missing
//   node scripts/models.ts --force  rebuild everything

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface Model {
  id: string;
  revision: string;
  sha256: string;
  out: string;
  files: string[];
}

const CLAIM_FILTER: Model = {
  id: 'sachaljawad/claimbuster-detector',
  // The Hub commit the export and the quality-gate numbers are from.
  revision: '9a3dcd45a212a06a04139863654717bc4743daba',
  // What the pinned export (8-bit, per channel) wrote on macOS arm64, the same
  // bytes on two runs. Other platforms may quantize to different bytes; that
  // is reported, not fatal.
  sha256: 'a6310196392bdeef0986b43473ebd76e82738f4b6d1cb5f6e58fad79f16072e3',
  out: join(root, 'public/models/claimcatcher/claimbuster-detector'),
  files: ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'],
};

/** A model taken as published on the Hub, file by file. */
export interface Download {
  id: string;
  revision: string;
  out: string;
  /** Path in the repo -> its sha256. */
  files: Record<string, string>;
}

const SPEECH_TO_TEXT: Download = {
  id: 'onnx-community/moonshine-base-ONNX',
  revision: 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad',
  out: join(root, 'public/models/onnx-community/moonshine-base-ONNX'),
  // Only what Transformers.js loads for dtype q8: the encoder and the merged decoder.
  files: {
    'config.json': 'fab7241d1e9fc6c2370c4c6dfb5da79bb54d67ed9ab6b507ac51d29d2abe01d1',
    'generation_config.json': 'f9b3f711b57be7def2e50a8942f64f36ee0a55fad5b84ff93a687b6c5bcc1d44',
    'preprocessor_config.json': 'fa43a7017ef85cd1d0fba0d9aae77c8adb16990ae6f11115631f41ec5d8aa679',
    'special_tokens_map.json': 'ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356',
    'tokenizer.json': '7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f',
    'tokenizer_config.json': 'edaee394565d428ea98a663ae7209cdcfeefc5585c42d7a570ff7c986df2cd15',
    'onnx/encoder_model_quantized.onnx': '1dd9ab0a7f987113d30affcba5a068d11c8f90fa0223caa3e491ade431ad9751',
    'onnx/decoder_model_merged_quantized.onnx': 'cc9f3cd6698a369c6008b41aa60aa3fb3322e7f03c9bdf19d8e6b7200afca4f3',
  },
};

const SEGMENTATION: Download = {
  id: 'onnx-community/pyannote-segmentation-3.0',
  revision: '733a93b6473d019a773298e08cefa686894b1854',
  out: join(root, 'public/models/onnx-community/pyannote-segmentation-3.0'),
  files: {
    'config.json': '5a4c6bb4f49f1b47c9bd398aac78b8cd4a9f30a0ff91b5c2dc68d05e13e160cf',
    'preprocessor_config.json': 'dfc7d35a3895f8997eb94521e28b1921c03480a34fa9bcbb6bef1f1934f81480',
    'onnx/model_quantized.onnx': '93a3eb106923c9b76a7d8af07ac337dd24c2d0dcd20f1b6c55f21133e944d658',
  },
};

const VOICEPRINTS: Download = {
  id: 'onnx-community/wespeaker-voxceleb-resnet34-LM',
  revision: '6a61a1833ff2583aabeba044f5c8221f00b67ceb',
  out: join(root, 'public/models/onnx-community/wespeaker-voxceleb-resnet34-LM'),
  files: {
    'config.json': '4a65a1544d2085d7819632f130583d83f6815f49ef6c8ba6c8eb460bd4085041',
    'preprocessor_config.json': 'a81bbded0530b1bf5c3d395d2c5c7c266686e348be5989171290ace960f24ec2',
    'onnx/model_quantized.onnx': 'f73f647730ae440ae411c2241290f42ff5b2106dd3176c897fe6fbb1950d5393',
  },
};

/** The files of a Hub model that are missing, or whose bytes aren't the pinned ones (an older pin, a broken copy). */
export function staleFiles(model: Download): string[] {
  return Object.entries(model.files)
    .filter(([file, hash]) => {
      const path = join(model.out, file);
      return !existsSync(path) || sha256(readFileSync(path)) !== hash;
    })
    .map(([file]) => file);
}

/**
 * Downloads each file of a Hub model that is missing or isn't the pinned
 * bytes, at its pinned revision, refusing any download whose sha256 differs.
 */
async function download(model: Download, force: boolean): Promise<void> {
  const stale = new Set(force ? Object.keys(model.files) : staleFiles(model));
  for (const [file, hash] of Object.entries(model.files)) {
    const path = join(model.out, file);
    if (!stale.has(file)) continue;
    const url = `https://huggingface.co/${model.id}/resolve/${model.revision}/${file}`;
    console.log(`[models] downloading ${model.id}/${file}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[models] ${url}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const got = sha256(bytes);
    if (got !== hash) throw new Error(`[models] ${model.id}/${file}: sha256 ${got}, expected the pinned ${hash}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.part`, bytes);
    renameSync(`${path}.part`, path);
  }
}

function present(model: Model): boolean {
  return model.files.every((file) => existsSync(join(model.out, file)));
}

const MODEL_FILE = 'onnx/model_quantized.onnx';

/** What an export of `model` by `exportScript` is: changes when the pin, the pinned bytes or the export script change. */
export function exportStamp(model: Model, exportScript: string): string {
  return sha256(Buffer.from(`${model.id}@${model.revision}\n${model.sha256}\n${sha256(readFileSync(exportScript))}`));
}

/**
 * Whether the exported model on disk is the current one: every file there and
 * either the pinned bytes, or an export this machine made for the current pin
 * and export script (other platforms may quantize to other bytes, so a
 * mismatch alone doesn't force a new export each build).
 */
export function exportCurrent(model: Model, exportScript: string, stampFile: string): boolean {
  if (!present(model)) return false;
  if (sha256(readFileSync(join(model.out, MODEL_FILE))) === model.sha256) return true;
  return existsSync(stampFile) && readFileSync(stampFile, 'utf8') === exportStamp(model, exportScript);
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: 'inherit', cwd: root });
}

function exportVenv(): string {
  const venv = process.env.CLAIMCATCHER_EXPORT_VENV ?? join(root, '.cache/model-export/venv');
  const python = join(venv, 'bin/python');
  const requirements = join(root, 'scripts/claim-filter/requirements.txt');
  const stamp = join(venv, '.requirements-sha256');
  const wanted = sha256(readFileSync(requirements));
  if (existsSync(python) && existsSync(stamp) && readFileSync(stamp, 'utf8') === wanted) return python;

  const base = process.env.PYTHON ?? 'python3.12';
  console.log(`[models] making the export venv at ${venv} with ${base}`);
  run(base, ['-m', 'venv', '--clear', venv]);
  run(python, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']);
  run(python, ['-m', 'pip', 'install', '--quiet', '-r', requirements]);
  run(python, ['-c', `open(${JSON.stringify(stamp)}, 'w').write(${JSON.stringify(wanted)})`]);
  return python;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Makes every bundled model that is missing or isn't its pinned version (or all of them, with `force`). */
export async function ensureModels({ force = false }: { force?: boolean } = {}): Promise<void> {
  await download(SPEECH_TO_TEXT, force);
  await download(SEGMENTATION, force);
  await download(VOICEPRINTS, force);
  ensureClaimFilter(force);
}

const EXPORT_SCRIPT = join(root, 'scripts/claim-filter/export.py');
/** Where the export records what it was made for, outside public/ so it never ships. */
const EXPORT_STAMP_FILE = join(root, '.cache/model-export/claimbuster-detector.stamp');

function ensureClaimFilter(force: boolean): void {
  if (!force && exportCurrent(CLAIM_FILTER, EXPORT_SCRIPT, EXPORT_STAMP_FILE)) return;
  console.log(`[models] exporting the claim filter ${CLAIM_FILTER.id}@${CLAIM_FILTER.revision.slice(0, 7)}`);
  const python = exportVenv();
  rmSync(CLAIM_FILTER.out, { recursive: true, force: true });
  run(python, [EXPORT_SCRIPT, CLAIM_FILTER.out, CLAIM_FILTER.revision]);
  if (!present(CLAIM_FILTER)) throw new Error('[models] the claim filter export did not write every file');
  mkdirSync(dirname(EXPORT_STAMP_FILE), { recursive: true });
  writeFileSync(EXPORT_STAMP_FILE, exportStamp(CLAIM_FILTER, EXPORT_SCRIPT));
  const hash = sha256(readFileSync(join(CLAIM_FILTER.out, MODEL_FILE)));
  console.log(`[models] claim filter: sha256 ${hash}${hash === CLAIM_FILTER.sha256 ? ' (as pinned)' : ` (differs from the pinned ${CLAIM_FILTER.sha256})`}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await ensureModels({ force: process.argv.includes('--force') });
  console.log('[models] the claim filter, speech-to-text and voice separation are in public/models/');
}
