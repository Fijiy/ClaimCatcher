import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LICENCES, NOTICES } from '../src/notices';
import { NOTICES_FILE, packagesIn, renderNotices, uncovered } from './notices';

describe('the build check', () => {
  it('names every bundled package and model the notices file leaves out', () => {
    const missing = uncovered(
      {
        packages: ['svelte', 'left-pad', 'onnxruntime-common'],
        models: ['onnx-community/moonshine-base-ONNX', 'acme/new-model'],
      },
      NOTICES,
    );

    expect(missing).toEqual({ packages: ['left-pad'], models: ['acme/new-model'] });
  });

  it('finds the packages in a build’s files, including ones compiled into another package', () => {
    const files = [
      { path: '/repo/src/entrypoints/background.ts' },
      { path: '/repo/node_modules/.pnpm/svelte@5.57.2/node_modules/svelte/src/internal/client/index.js' },
      { path: '\0vite/preload-helper.js' },
      {
        path: '/repo/node_modules/.pnpm/@huggingface+transformers@4.3.1/node_modules/@huggingface/transformers/dist/transformers.web.js',
        source: [
          '// src/env.js',
          'var VERSION = "4.3.1";',
          '// ../../node_modules/.pnpm/@huggingface+tokenizers@0.2.0/node_modules/@huggingface/tokenizers/dist/tokenizers.mjs',
          'var x = 1;',
          '// ../../node_modules/.pnpm/@huggingface+jinja@0.5.10/node_modules/@huggingface/jinja/dist/index.js',
        ].join('\n'),
      },
      { path: '/repo/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm' },
    ];

    expect(packagesIn(files).sort()).toEqual([
      '@huggingface/jinja',
      '@huggingface/tokenizers',
      '@huggingface/transformers',
      'onnxruntime-web',
      'svelte',
    ]);
  });

  it('passes for every production dependency in package.json', () => {
    const { dependencies } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

    expect(uncovered({ packages: Object.keys(dependencies), models: [] }, NOTICES)).toEqual({ packages: [], models: [] });
  });

  it('passes for the models the extension bundles', () => {
    const models = [
      'claimcatcher/claimbuster-detector',
      'onnx-community/moonshine-base-ONNX',
      'onnx-community/pyannote-segmentation-3.0',
      'onnx-community/wespeaker-voxceleb-resnet34-LM',
    ];

    expect(uncovered({ packages: [], models }, NOTICES).models).toEqual([]);
  });
});

/** The notices file's entries: heading → its `- Label: value` lines. */
function entries(file: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const block of file.split(/^### /m).slice(1)) {
    const [heading, ...lines] = block.split('\n');
    const fields: Record<string, string> = {};
    for (const line of lines) {
      const field = /^- ([^:]+): (.*)$/.exec(line);
      if (field) fields[field[1]!] = fields[field[1]!] ? `${fields[field[1]!]} ${field[2]}` : field[2]!;
    }
    out.set(heading!.trim(), fields);
  }
  return out;
}

describe('THIRD-PARTY-NOTICES.md', () => {
  const file = readFileSync(NOTICES_FILE, 'utf8');

  it('is up to date (pnpm notices rewrites it)', () => {
    expect(file).toBe(renderNotices());
  });

  it('lists what the spec names, each with its licence and origin', () => {
    const listed = entries(file);
    const licence = (name: string) => listed.get(name)?.Licence;

    expect(licence('WXT')).toBe('MIT License');
    expect(licence('Svelte')).toBe('MIT License');
    expect(licence('Transformers.js')).toBe('Apache License 2.0');
    expect(licence('ONNX Runtime Web')).toBe('MIT License');
    expect(licence('Moonshine base')).toBe('MIT License');
    expect(licence('claimbuster-detector')).toBe('MIT License');
    expect(licence('ClaimBuster dataset')).toBe('Creative Commons Attribution 4.0 International (CC BY 4.0)');
    expect(licence('pyannote segmentation-3.0')).toBe('MIT License');
    expect(licence('WeSpeaker ResNet34')).toBe('Creative Commons Attribution 4.0 International (CC BY 4.0)');
    expect(licence('Atkinson Hyperlegible Next')).toBe('SIL Open Font License 1.1');
    for (const [name, fields] of listed) expect(fields.From, name).toMatch(/^https:\/\//);
  });

  it('says MBFC’s ratings aren’t under the mbfcext MIT licence, and which snapshot is bundled', () => {
    const mbfc = entries(file).get('Media Bias/Fact Check (MBFC)')!;

    expect(mbfc.Licence).toMatch(/^No open licence/);
    expect(mbfc.Note).toMatch(/not covered by the mbfcext repository’s MIT licence/);
    expect(mbfc.Snapshot).toMatch(/drmikecrowe\/mbfcext.*docs\/csources\.json.*commit [0-9a-f]{40}.*\d{4}-\d{2}-\d{2}/);
  });

  it('gives the version of every bundled npm package', () => {
    for (const [name, fields] of entries(file)) {
      if ((NOTICES.find((n) => n.name === name)?.packages ?? []).length) expect(fields.Version, name).toMatch(/\d+\.\d+\.\d+/);
    }
  });

  it('carries the licence texts', () => {
    expect(file).toContain('Permission is hereby granted, free of charge');
    expect(file).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION');
    expect(file).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(file).toContain('https://creativecommons.org/licenses/by/4.0/legalcode');
  });
});

describe('Privacy & data credits', () => {
  it('show each licence by a part of the name the notices file gives it', () => {
    for (const { name, short } of Object.values(LICENCES)) expect(name).toContain(short);
  });
});
