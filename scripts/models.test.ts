// `pnpm models` (scripts/models.ts) replaces a bundled model that isn't its
// pinned version: a downloaded file whose bytes differ from its pinned
// sha256, or a claim-filter export that is neither the pinned bytes nor an
// export made here for the current pin and export script. Checked on
// throwaway folders; nothing is downloaded or exported.

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportCurrent, exportStamp, staleFiles, type Download, type Model } from './models';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
let dirs: string[] = [];
function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'claimcatcher-models-'));
  dirs.push(dir);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('downloaded models', () => {
  it('replaces files that are missing or whose bytes are not the pinned ones, and keeps the rest', () => {
    const out = folder({ 'config.json': '{"a":1}', 'onnx/model.onnx': 'old model bytes' });
    const model: Download = {
      id: 'owner/model',
      revision: 'r',
      out,
      files: { 'config.json': hash('{"a":1}'), 'onnx/model.onnx': hash('new model bytes'), 'tokenizer.json': hash('{}') },
    };
    expect(staleFiles(model)).toEqual(['onnx/model.onnx', 'tokenizer.json']);
  });
});

describe('the exported claim filter', () => {
  const files = ['config.json', 'onnx/model_quantized.onnx'];
  const setup = (onnx: string) => {
    const out = folder({ 'config.json': '{}', 'onnx/model_quantized.onnx': onnx });
    const script = join(folder({ 'export.py': 'per_channel=True' }), 'export.py');
    const stamp = join(folder({}), 'filter.stamp');
    const model: Model = { id: 'owner/filter', revision: 'r2', sha256: hash('pinned bytes'), out, files };
    return { model, script, stamp };
  };

  it('is current when it holds the pinned bytes', () => {
    const { model, script, stamp } = setup('pinned bytes');
    expect(exportCurrent(model, script, stamp)).toBe(true);
  });

  it('is re-exported when it holds other bytes (an export for an older pin)', () => {
    const { model, script, stamp } = setup('bytes from the old export');
    expect(exportCurrent(model, script, stamp)).toBe(false);
  });

  it('is kept when this machine exported it for the current pin and script, even if its bytes differ (another platform)', () => {
    const { model, script, stamp } = setup('this platform quantized differently');
    writeFileSync(stamp, exportStamp(model, script));
    expect(exportCurrent(model, script, stamp)).toBe(true);
    // A new pin, or a changed export script, makes it stale again.
    expect(exportCurrent({ ...model, revision: 'r3' }, script, stamp)).toBe(false);
    writeFileSync(script, 'per_channel=False');
    expect(exportCurrent(model, script, stamp)).toBe(false);
  });

  it('is re-exported when a file is missing', () => {
    const { model, script, stamp } = setup('pinned bytes');
    expect(exportCurrent({ ...model, files: [...files, 'tokenizer.json'] }, script, stamp)).toBe(false);
  });
});
