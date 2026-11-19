// What the quality gate's page offers its drivers (scripts/eval/local.ts for
// Gemini Nano, scripts/eval/on-device.ts for the bundled models), which call
// it through Playwright's `page.evaluate`, so everything crossing is plain
// JSON (audio and voiceprints as base64, see wire.ts).

import type { LocalModel } from '../../local-model';
import type { ModelRuntime, TaskName } from '../../models/protocol';
import type { FailureKind, FailureSource, JsonRequest } from '../../session/checks/provider';
import type { Wire } from './wire';

export type ModelReply = { ok: true; output: Wire } | { ok: false; message: string };

export type GenerateReply = { ok: true; value: unknown } | { ok: false; kind: FailureKind; source: FailureSource; message: string };

export interface EvalBridge {
  /** Local mode's state here, as the extension itself checks it. */
  localModel(): Promise<LocalModel>;
  /** Download progress from 0 to 1 once the Download button was clicked, `done`, or the download's error. */
  download(): number | 'done' | { error: string } | null;
  /** A fresh Gemini Nano model (`createNanoModel`); returns its handle. */
  newModel(): number;
  /** One prompt to that model. */
  generate(model: number, request: JsonRequest): Promise<GenerateReply>;
  /**
   * One task on the shipped model worker (started on first use). The input is
   * JSON of its `Wire` form; so is the reply, a `ModelReply`.
   */
  runModel(task: TaskName, input: string): Promise<string>;
  /** How that worker runs models here (threads, WebGPU). */
  modelRuntime(): Promise<ModelRuntime>;
  /** Shown on the page, for whoever watches the run. */
  status(text: string): void;
}

declare global {
  interface Window {
    claimcatcherEval?: EvalBridge;
  }
}
