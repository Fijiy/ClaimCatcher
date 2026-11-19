// The model worker's runtime settings: bundled files only, and threads only
// when the extension is cross-origin isolated. (The real worker, model and
// WASM are tested in the built extension: tests/e2e/claim-filter.spec.ts.)

import type { env as TransformersEnv } from '@huggingface/transformers';
import { describe, expect, it } from 'vitest';
import { configureTransformers, runtimeFor } from './runtime';

const ORIGIN = 'chrome-extension://abcdefghijklmnop';

function fakeEnv() {
  const fetched: string[] = [];
  const env = {
    allowRemoteModels: true,
    allowLocalModels: false,
    localModelPath: '/somewhere/',
    useBrowserCache: true,
    useWasmCache: true,
    fetch: async (input: string | URL) => {
      fetched.push(String(input));
      return new Response('{}');
    },
    backends: { onnx: { wasm: { wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/', numThreads: 0 } } },
  };
  return { env, fetched };
}

describe('model runtime', () => {
  it('uses several WASM threads and WebGPU when cross-origin isolated', () => {
    expect(runtimeFor({ crossOriginIsolated: true, hardwareConcurrency: 10, webgpu: true })).toEqual({
      crossOriginIsolated: true,
      threads: 4,
      webgpu: true,
    });
    expect(runtimeFor({ crossOriginIsolated: true, hardwareConcurrency: 2, webgpu: false })).toEqual({
      crossOriginIsolated: true,
      threads: 2,
      webgpu: false,
    });
  });

  it('falls back to one thread when not cross-origin isolated', () => {
    expect(runtimeFor({ crossOriginIsolated: false, hardwareConcurrency: 10, webgpu: true })).toMatchObject({ threads: 1 });
  });

  it('loads models and ONNX Runtime from the bundle only, never from the network', async () => {
    const { env, fetched } = fakeEnv();
    configureTransformers(env as unknown as typeof TransformersEnv, runtimeFor({ crossOriginIsolated: true, hardwareConcurrency: 8, webgpu: false }), ORIGIN);

    expect(env).toMatchObject({
      allowRemoteModels: false,
      allowLocalModels: true,
      localModelPath: '/models/',
      useBrowserCache: false,
      useWasmCache: false,
      backends: { onnx: { wasm: { wasmPaths: '/ort/', numThreads: 4 } } },
    });
    await env.fetch('/models/claimcatcher/claimbuster-detector/config.json');
    await expect(env.fetch('https://huggingface.co/x/resolve/main/config.json')).rejects.toThrow(/only bundled files/);
    expect(fetched).toEqual([`${ORIGIN}/models/claimcatcher/claimbuster-detector/config.json`]);
  });
});
