// Worker side of speech-to-text: Moonshine base (UsefulSensors, MIT; the
// onnx-community ONNX export), 8-bit weights, bundled by scripts/models.ts.
// It takes 16 kHz mono audio and gives its words. It has no timestamps; the
// caller times each piece of audio itself (src/audio/transcriber.ts).
//
// It runs on WASM even where WebGPU is there: the 8-bit weights use integer
// ops WebGPU runs on the CPU anyway, and Moonshine measured faster on WASM
// (4% of real time) than on WebGPU in the prototype.

import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { TaskInput, TaskOutput } from '../protocol';

/** The model's folder under public/models/. */
export const SPEECH_TO_TEXT_MODEL = 'onnx-community/moonshine-base-ONNX';

export function createSpeechToTextTask() {
  let asr: Promise<AutomaticSpeechRecognitionPipeline> | undefined;
  const load = () =>
    (asr ??= pipeline('automatic-speech-recognition', SPEECH_TO_TEXT_MODEL, { device: 'wasm', dtype: 'q8' }).catch((error: unknown) => {
      asr = undefined; // let a later call try again
      throw error;
    }));

  return async ({ audio }: TaskInput<'speech-to-text'>): Promise<TaskOutput<'speech-to-text'>> => {
    const transcribe = await load();
    if (audio.length === 0) return { text: '' };
    const result = await transcribe(audio);
    const text = (Array.isArray(result) ? result.map((r) => r.text).join(' ') : result.text).trim();
    return { text };
  };
}
