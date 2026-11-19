// The on-device model worker, started by the offscreen document. It runs
// Transformers.js on ONNX Runtime from bundled files only (see runtime.ts),
// with multi-threaded WASM and WebGPU when the extension is cross-origin
// isolated, and one thread when it isn't.
//
// It hosts every on-device model task (protocol.ts): the claim filter,
// speech-to-text and voice separation. Transformers.js runs every
// model call in one realm one at a time, so tasks queue behind each other.

import { env } from '@huggingface/transformers';
import type { FromWorker, TaskInput, TaskName, TaskOutput, ToWorker } from './protocol';
import { configureTransformers, hasWebGpu, runtimeFor } from './runtime';
import { createClaimFilterTask } from './tasks/claim-filter';
import { createSpeechToTextTask } from './tasks/speech-to-text';
import { createVoiceSeparationTask } from './tasks/voice-separation';

/** Every task the worker runs. A task named in protocol.ts must be listed here. */
const tasks: { [T in TaskName]: (input: TaskInput<T>) => Promise<TaskOutput<T>> } = {
  'claim-filter': createClaimFilterTask(),
  'speech-to-text': createSpeechToTextTask(),
  'voice-separation': createVoiceSeparationTask(),
};

interface WorkerScope {
  crossOriginIsolated: boolean;
  location: { origin: string };
  navigator: { hardwareConcurrency: number; gpu?: { requestAdapter(): Promise<unknown> } };
  postMessage(message: FromWorker): void;
  addEventListener(type: 'message', listener: (event: { data: ToWorker }) => void): void;
}
const scope = self as unknown as WorkerScope;

const ready = (async () => {
  const runtime = runtimeFor({
    crossOriginIsolated: scope.crossOriginIsolated,
    hardwareConcurrency: scope.navigator.hardwareConcurrency,
    webgpu: await hasWebGpu(scope.navigator),
  });
  configureTransformers(env, runtime, scope.location.origin);
  scope.postMessage({ type: 'runtime', runtime });
})();

scope.addEventListener('message', ({ data }) => {
  void (async () => {
    try {
      await ready;
      const run = tasks[data.task] as (input: unknown) => Promise<unknown>;
      scope.postMessage({ type: 'done', id: data.id, output: await run(data.input) });
    } catch (error) {
      scope.postMessage({ type: 'failed', id: data.id, error: error instanceof Error ? error.message : String(error) });
    }
  })();
});
