// Every library, model, dataset and typeface ClaimCatcher bundles or was
// built from, with its licence and where it came from. One list, two views:
// scripts/notices.ts renders it as THIRD-PARTY-NOTICES.md (in the repo and,
// as THIRD-PARTY-NOTICES.txt, in the extension), and Privacy & data's
// Credits lists the same entries. The build fails when it bundles an npm
// package or a model that no entry here covers (modules/notices.ts).

/** The licences that appear below. */
export type LicenceId = 'MIT' | 'Apache-2.0' | 'CC-BY-4.0' | 'OFL-1.1' | 'MBFC';

/** Each licence's full name (in the notices file) and the part of it Privacy & data shows. */
export const LICENCES: Record<LicenceId, { name: string; short: string; url: string }> = {
  MIT: { name: 'MIT License', short: 'MIT', url: 'https://opensource.org/license/mit' },
  'Apache-2.0': { name: 'Apache License 2.0', short: 'Apache License 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
  'CC-BY-4.0': {
    name: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
    short: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/legalcode',
  },
  'OFL-1.1': { name: 'SIL Open Font License 1.1', short: 'SIL Open Font License', url: 'https://openfontlicense.org' },
  MBFC: {
    name: 'No open licence: used with attribution under MBFC’s fair-use policy',
    short: 'used with attribution under MBFC’s fair-use policy',
    url: 'https://mediabiasfactcheck.com/fair-use-policy/',
  },
};

export interface Notice {
  name: string;
  kind: 'data' | 'model' | 'dataset' | 'library' | 'typeface';
  /** Who made it, as credited. */
  by: string;
  licence: LicenceId;
  /** The copyright line its licence asks to keep. */
  copyright: string;
  /** The project's home. */
  origin: string;
  /** Where ClaimCatcher's copy came from, when that isn't `origin` (a mirror, a conversion, a snapshot). */
  source?: string;
  /** The Hub revision ClaimCatcher's copy is pinned to (models). */
  revision?: string;
  /** What ClaimCatcher uses it for. */
  use: string;
  notes?: string[];
  /** npm packages this entry covers (the build checks every bundled package against these). */
  packages?: string[];
  /** Its folder under /models/ in the extension (the build checks every bundled model against these). */
  model?: string;
  /** The line it's credited under in Privacy & data. */
  credit: string;
}

export const NOTICES: readonly Notice[] = [
  {
    name: 'Media Bias/Fact Check (MBFC)',
    kind: 'data',
    by: 'Media Bias/Fact Check, LLC, via the data of the official MBFC browser extension',
    licence: 'MBFC',
    copyright: 'Ratings © Media Bias/Fact Check, LLC (https://mediabiasfactcheck.com)',
    origin: 'https://mediabiasfactcheck.com',
    source: 'https://github.com/drmikecrowe/mbfcext',
    use: 'Bias and factual-reporting ratings for news sites, bundled as a snapshot and looked up on the device.',
    notes: [
      'MBFC’s ratings are not covered by the mbfcext repository’s MIT licence, which covers only its code (none of which ClaimCatcher uses). MBFC asks for clear attribution with a link, and use beyond fair use needs its permission. This must be settled with MBFC before ClaimCatcher is published in the Chrome Web Store.',
    ],
    credit: 'Bias and reliability ratings',
  },
  {
    name: 'Moonshine base',
    kind: 'model',
    by: 'Useful Sensors (Moonshine AI)',
    licence: 'MIT',
    copyright: 'Copyright (c) 2025 Useful Sensors, Inc. (dba Moonshine AI)',
    origin: 'https://github.com/moonshine-ai/moonshine',
    source: 'https://huggingface.co/onnx-community/moonshine-base-ONNX (ONNX conversion of https://huggingface.co/UsefulSensors/moonshine-base)',
    revision: 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad',
    use: 'Speech-to-text on the device when a video has no captions (8-bit encoder and merged decoder).',
    model: 'onnx-community/moonshine-base-ONNX',
    credit: 'Speech-to-text',
  },
  {
    name: 'claimbuster-detector',
    kind: 'model',
    by: 'Mohammad Sachal Jawad',
    licence: 'MIT',
    copyright: 'Copyright (c) 2026 M Sachal Jawad',
    origin: 'https://huggingface.co/sachaljawad/claimbuster-detector',
    revision: '9a3dcd45a212a06a04139863654717bc4743daba',
    use: 'The claim filter: scores each sentence for whether it is a check-worthy claim. Exported to ONNX and quantized to 8 bits by scripts/claim-filter/export.py.',
    notes: [
      'Fine-tuned from DistilBERT base uncased on the ClaimBuster dataset (both listed here).',
      'The model card gives the MIT licence; the copyright line is from the licence of its code, https://github.com/sachaljawad/DebateIQ.',
    ],
    model: 'claimcatcher/claimbuster-detector',
    credit: 'Claim filter',
  },
  {
    name: 'DistilBERT base uncased',
    kind: 'model',
    by: 'Hugging Face',
    licence: 'Apache-2.0',
    copyright: 'Hugging Face (Sanh, Debut, Chaumond and Wolf, 2019)',
    origin: 'https://huggingface.co/distilbert/distilbert-base-uncased',
    use: 'The base model claimbuster-detector was fine-tuned from; its weights and tokenizer are part of the claim filter.',
    credit: 'Claim filter',
  },
  {
    name: 'ClaimBuster dataset',
    kind: 'dataset',
    by: 'Fatma Arslan, Naeemul Hassan, Chengkai Li and Mark Tremayne',
    licence: 'CC-BY-4.0',
    copyright:
      'Arslan, F., Hassan, N., Li, C. and Tremayne, M. (2020). A Benchmark Dataset of Check-worthy Factual Claims. ICWSM 14, 821–829. Data: https://doi.org/10.5281/zenodo.3609356',
    origin: 'https://doi.org/10.5281/zenodo.3609356',
    use: 'The data claimbuster-detector was trained on. The dataset itself is not bundled.',
    notes: ['Its sentences were relabelled for training: check-worthy factual sentences as check-worthy, the rest as not (see the model card).'],
    credit: 'Claim filter',
  },
  {
    name: 'pyannote segmentation-3.0',
    kind: 'model',
    by: 'pyannote (Hervé Bredin and Alexis Plaquet, CNRS)',
    licence: 'MIT',
    copyright: 'Copyright (c) 2020 CNRS',
    origin: 'https://huggingface.co/pyannote/segmentation-3.0',
    source: 'https://huggingface.co/onnx-community/pyannote-segmentation-3.0 (ONNX conversion)',
    revision: '733a93b6473d019a773298e08cefa686894b1854',
    use: 'Telling voices apart on the device: finds where each voice speaks (8-bit).',
    model: 'onnx-community/pyannote-segmentation-3.0',
    credit: 'Telling voices apart',
  },
  {
    name: 'WeSpeaker ResNet34',
    kind: 'model',
    by: 'WeSpeaker (wenet-e2e)',
    licence: 'CC-BY-4.0',
    copyright: 'wespeaker-voxceleb-resnet34-LM by the WeSpeaker team (https://github.com/wenet-e2e/wespeaker), trained on VoxCeleb',
    origin: 'https://github.com/wenet-e2e/wespeaker',
    source:
      'https://huggingface.co/onnx-community/wespeaker-voxceleb-resnet34-LM (ONNX conversion of https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM)',
    revision: '6a61a1833ff2583aabeba044f5c8221f00b67ceb',
    use: 'Telling voices apart on the device: a voice print for each stretch of speech (8-bit).',
    notes: ['Changed from the original: converted to ONNX and quantized to 8 bits (by onnx-community).'],
    model: 'onnx-community/wespeaker-voxceleb-resnet34-LM',
    credit: 'Telling voices apart',
  },
  {
    name: 'Transformers.js',
    kind: 'library',
    by: 'Hugging Face',
    licence: 'Apache-2.0',
    copyright: 'Copyright Hugging Face',
    origin: 'https://github.com/huggingface/transformers.js',
    use: 'Runs the on-device models.',
    packages: ['@huggingface/transformers'],
    credit: 'Running the models',
  },
  {
    name: 'Tokenizers.js',
    kind: 'library',
    by: 'Hugging Face',
    licence: 'Apache-2.0',
    copyright: 'Copyright Hugging Face',
    origin: 'https://github.com/huggingface/tokenizers.js',
    use: 'Tokenizers for the on-device models (compiled into Transformers.js).',
    packages: ['@huggingface/tokenizers'],
    credit: 'Running the models',
  },
  {
    name: '@huggingface/jinja',
    kind: 'library',
    by: 'Hugging Face',
    licence: 'MIT',
    copyright: 'Copyright (c) 2023 Hugging Face',
    origin: 'https://github.com/huggingface/huggingface.js/tree/main/packages/jinja',
    use: 'Template engine (compiled into Transformers.js).',
    packages: ['@huggingface/jinja'],
    credit: 'Running the models',
  },
  {
    name: 'ONNX Runtime Web',
    kind: 'library',
    by: 'Microsoft',
    licence: 'MIT',
    copyright: 'Copyright (c) Microsoft Corporation',
    origin: 'https://github.com/microsoft/onnxruntime',
    use: 'Runs the models in WebAssembly and WebGPU (the JavaScript and the asyncify WASM build).',
    notes: [
      'The WASM build includes libraries compiled into ONNX Runtime; they are listed in its ThirdPartyNotices.txt: https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt',
    ],
    packages: ['onnxruntime-web', 'onnxruntime-common'],
    credit: 'Running the models',
  },
  {
    name: 'WXT',
    kind: 'library',
    by: 'Aaron Klinker',
    licence: 'MIT',
    copyright: 'Copyright (c) 2023 Aaron',
    origin: 'https://github.com/wxt-dev/wxt',
    use: 'The extension framework: builds the extension; its small runtime helpers and browser API wrapper are bundled.',
    packages: ['wxt', '@wxt-dev/browser'],
    credit: 'Built with',
  },
  {
    name: 'Svelte',
    kind: 'library',
    by: 'the Svelte contributors',
    licence: 'MIT',
    copyright: 'Copyright (c) 2016-2025 Svelte Contributors (https://github.com/sveltejs/svelte/graphs/contributors)',
    origin: 'https://github.com/sveltejs/svelte',
    use: 'The side panel, the first-run page and Privacy & data are Svelte components.',
    packages: ['svelte'],
    credit: 'Built with',
  },
  {
    name: 'Atkinson Hyperlegible Next',
    kind: 'typeface',
    by: 'the Braille Institute',
    licence: 'OFL-1.1',
    copyright:
      'Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next)',
    origin: 'https://github.com/googlefonts/atkinson-hyperlegible-next',
    source: 'https://fontsource.org/fonts/atkinson-hyperlegible-next (variable weight, Latin and Latin Extended)',
    use: 'The typeface of every page.',
    packages: ['@fontsource-variable/atkinson-hyperlegible-next'],
    credit: 'Typeface',
  },
];

/** Privacy & data's credit lines: the notices grouped by `credit`, in list order. */
export function creditLines(notices: readonly Notice[] = NOTICES): { credit: string; notices: Notice[] }[] {
  const lines = new Map<string, Notice[]>();
  for (const notice of notices) lines.set(notice.credit, [...(lines.get(notice.credit) ?? []), notice]);
  return [...lines].map(([credit, grouped]) => ({ credit, notices: grouped }));
}
