// Bundles what the on-device model worker (src/models) loads at run time, so
// nothing is ever fetched from a CDN or the Hugging Face Hub:
//
//   /ort/     ONNX Runtime's WASM and its loader, from the onnxruntime-web
//             that @huggingface/transformers depends on (the two must match).
//             Only the asyncify build: it serves both WASM and WebGPU.
//   /models/  copied from public/ by WXT itself (scripts/models.ts makes
//             them before every build).
//
// ONNX Runtime's bundle also names its WASM with `new URL(…, import.meta.url)`,
// which makes Vite emit a second, hashed 27 MB copy under /assets/. That copy
// is only used when `wasmPaths` is unset, and the worker always sets it
// (src/models/runtime.ts), so it is dropped from the build.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { addViteConfig, defineWxtModule } from 'wxt/modules';

const ORT_FILES = ['ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs'];

const DUPLICATE_ORT_WASM = /(^|\/)ort-wasm-simd-threaded\.asyncify-[\w-]+\.wasm$/;

export default defineWxtModule((wxt) => {
  addViteConfig(wxt, () => ({
    plugins: [
      {
        name: 'claimcatcher:drop-duplicate-ort-wasm',
        generateBundle(_, bundle) {
          for (const name of Object.keys(bundle)) if (DUPLICATE_ORT_WASM.test(name)) delete bundle[name];
        },
      },
    ],
  }));

  wxt.hook('build:publicAssets', (_, assets) => {
    const fromTransformers = createRequire(createRequire(import.meta.url).resolve('@huggingface/transformers'));
    // onnxruntime-web doesn't export its package.json; find its folder from its entry file.
    const entry = fromTransformers.resolve('onnxruntime-web');
    const ortDist = join(entry.slice(0, entry.lastIndexOf('/onnxruntime-web/') + '/onnxruntime-web/'.length), 'dist');
    for (const file of ORT_FILES) assets.push({ absoluteSrc: join(ortDist, file), relativeDest: `ort/${file}` });
  });
});
