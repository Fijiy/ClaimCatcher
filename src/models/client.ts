// The offscreen document's handle on the model worker (worker.ts). One worker
// serves every on-device model; `run` sends one task and resolves with its
// output. If the worker dies, every pending and later run rejects, and each
// caller applies its own fallback (the claim filter lets sentences through).

import type { FromWorker, ModelRuntime, TaskInput, TaskName, TaskOutput, ToWorker } from './protocol';

/** The part of `Worker` the client uses, so tests can stand in for it. */
export interface WorkerLike {
  postMessage(message: ToWorker, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<FromWorker>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export interface ModelClient {
  /** Runs one task in the worker. Pass `transfer` to hand over buffers (audio) without copying. */
  run<T extends TaskName>(task: T, input: TaskInput<T>, transfer?: Transferable[]): Promise<TaskOutput<T>>;
  /** How the worker runs models (threads, WebGPU), once it has started. */
  runtime(): Promise<ModelRuntime>;
  close(): void;
}

/** Starts the model worker. Only extension pages can: its files come from the extension's origin. */
export function startModelWorker(): ModelClient {
  return createModelClient(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'claimcatcher-models' }));
}

export function createModelClient(worker: WorkerLike): ModelClient {
  const pending = new Map<number, { resolve: (output: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let dead: Error | null = null;
  let gotRuntime: (runtime: ModelRuntime) => void = () => {};
  let noRuntime: (error: Error) => void = () => {};
  const runtime = new Promise<ModelRuntime>((resolve, reject) => {
    gotRuntime = resolve;
    noRuntime = reject;
  });
  runtime.catch(() => {}); // only a caller who asks sees this

  function die(error: Error) {
    dead ??= error;
    noRuntime(dead);
    for (const { reject } of pending.values()) reject(dead);
    pending.clear();
  }

  worker.addEventListener('message', ({ data }) => {
    if (data.type === 'runtime') return gotRuntime(data.runtime);
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    if (data.type === 'done') call.resolve(data.output);
    else call.reject(new Error(data.error));
  });
  worker.addEventListener('error', (event) => die(new Error(`the model worker stopped: ${event.message || 'error'}`)));

  return {
    run<T extends TaskName>(task: T, input: TaskInput<T>, transfer: Transferable[] = []) {
      if (dead) return Promise.reject(dead);
      const id = nextId++;
      return new Promise<TaskOutput<T>>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (output: unknown) => void, reject });
        worker.postMessage({ type: 'run', id, task, input } as ToWorker, transfer);
      });
    },
    runtime: () => runtime,
    close() {
      worker.terminate();
      die(new Error('the model worker was closed'));
    },
  };
}
