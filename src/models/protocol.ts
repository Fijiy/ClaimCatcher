// The messages between the offscreen document and the on-device model worker
// (worker.ts). Everything here is plain data or transferable.
//
// Each model job is a *task*: a name with one input and one output type.
// A new on-device model adds:
//   1. its entry in `ModelTasks` here;
//   2. a handler in tasks/<name>.ts;
//   3. that handler in worker.ts's `tasks` table (the compiler insists).
// The client (client.ts) then runs it with `models.run('<name>', input)`.

export interface ModelTasks {
  /** The claim filter: how check-worthy each sentence is, 0..1, in input order. */
  'claim-filter': { input: { sentences: string[] }; output: { scores: number[] } };
  /**
   * Speech-to-text: the words in 16 kHz mono audio (at most 30 s, at least 1 s).
   * Send `audio.buffer` as a transferable. An empty input only loads the model.
   */
  'speech-to-text': { input: { audio: Float32Array }; output: { text: string } };
  /**
   * Voice separation, the model half: who-speaks-when in 16 kHz mono audio
   * (pyannote segmentation, in windows of at most 10 s), and a voiceprint for
   * each stretch of one voice (WeSpeaker, 256 numbers, L2-normalised). Times
   * are seconds from the start of the audio. The clustering into voices is
   * the caller's (src/audio/voice-clusters.ts). An empty input only loads the models.
   */
  'voice-separation': {
    input: { audio: Float32Array };
    output: { segments: Array<{ start: number; end: number; embedding: Float32Array; overlap?: boolean }> };
  };
}

export type TaskName = keyof ModelTasks;
export type TaskInput<T extends TaskName> = ModelTasks[T]['input'];
export type TaskOutput<T extends TaskName> = ModelTasks[T]['output'];

/** How the worker runs models, as it found the platform. */
export interface ModelRuntime {
  crossOriginIsolated: boolean;
  /** WASM threads; 1 when the page isn't cross-origin isolated. */
  threads: number;
  /** Whether a WebGPU adapter was found, for tasks with weights suited to it. */
  webgpu: boolean;
}

/** Offscreen document -> worker. */
export type ToWorker = { [T in TaskName]: { type: 'run'; id: number; task: T; input: TaskInput<T> } }[TaskName];

/** Worker -> offscreen document. */
export type FromWorker =
  | { type: 'runtime'; runtime: ModelRuntime }
  | { type: 'done'; id: number; output: unknown }
  | { type: 'failed'; id: number; error: string };
