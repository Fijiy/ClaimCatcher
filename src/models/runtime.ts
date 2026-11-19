// How the model worker sets up Transformers.js and ONNX Runtime. No remote
// code and no remote models, ever: every model and every WASM file is
// bundled with the extension and fetched from its own origin.
//
//   models  public/models/<org>/<name>/   -> /models/  (built by scripts/models.ts)
//   ORT     onnxruntime-web asyncify WASM -> /ort/     (copied by modules/bundled-runtime.ts)

import type { env as TransformersEnv } from '@huggingface/transformers';
import type { ModelRuntime } from './protocol';

/** Where bundled models live, from the extension's origin. Workers have no `chrome.runtime.getURL`. */
export const MODEL_PATH = '/models/';
/** Where the bundled ONNX Runtime WASM and its loader live. */
export const ORT_PATH = '/ort/';
/** At most this many WASM threads, whatever the core count. */
const MAX_THREADS = 4;

export interface Platform {
  crossOriginIsolated: boolean;
  hardwareConcurrency: number;
  /** Whether `navigator.gpu.requestAdapter()` gave an adapter. */
  webgpu: boolean;
}

/**
 * Multi-threaded WASM (and WebGPU, where there is an adapter) when the page is
 * cross-origin isolated; one thread when it isn't, because WASM threads need
 * SharedArrayBuffer.
 */
export function runtimeFor(platform: Platform): ModelRuntime {
  const threads = platform.crossOriginIsolated ? Math.max(1, Math.min(MAX_THREADS, platform.hardwareConcurrency)) : 1;
  return { crossOriginIsolated: platform.crossOriginIsolated, threads, webgpu: platform.crossOriginIsolated && platform.webgpu };
}

/**
 * Points Transformers.js at the bundled files only. Call it after importing
 * Transformers.js (which sets a CDN default for the WASM path on import) and
 * before loading any model.
 */
export function configureTransformers(env: typeof TransformersEnv, runtime: ModelRuntime, origin: string): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = MODEL_PATH;
  // Bundled files are already on disk; copying them into the Cache API gains nothing.
  env.useBrowserCache = false;
  // On, this would import the WASM loader from a blob: URL, which the extension's CSP blocks.
  env.useWasmCache = false;
  // Fail loudly rather than reach the network if anything ever asks for a file from elsewhere.
  const fetchOwnOrigin = env.fetch;
  const own = new URL(origin);
  env.fetch = (input, init) => {
    const url = new URL(String(input), origin);
    // Compared by scheme and host: `URL.origin` is "null" for chrome-extension: outside Chrome.
    if (url.protocol !== own.protocol || url.host !== own.host) {
      return Promise.reject(new Error(`on-device models load only bundled files, not ${url.href}`));
    }
    return fetchOwnOrigin(url.href, init);
  };
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    // Mutate in place: these objects are ONNX Runtime's own settings.
    wasm.wasmPaths = ORT_PATH;
    wasm.numThreads = runtime.threads;
  }
}

/** Asks for a WebGPU adapter; false where there is none (no GPU, or blocked). */
export async function hasWebGpu(nav: { gpu?: { requestAdapter(): Promise<unknown> } }): Promise<boolean> {
  try {
    return (await nav.gpu?.requestAdapter()) != null;
  } catch {
    return false;
  }
}
