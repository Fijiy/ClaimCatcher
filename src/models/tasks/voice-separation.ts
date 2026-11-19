// Worker side of voice separation: the two models, bundled by
// scripts/models.ts, both 8-bit and on WASM (CPU), as measured in
// prototype/local-mode-eval (3% of real time):
//
//   segmentation  onnx-community/pyannote-segmentation-3.0 (pyannote, MIT):
//                 who speaks when in up to 10 s of 16 kHz audio, as powerset
//                 classes per ~17 ms frame: 0 no one, 1-3 one local speaker,
//                 4-6 two at once
//   voiceprints   onnx-community/wespeaker-voxceleb-resnet34-LM (WeSpeaker,
//                 CC-BY-4.0): 256 numbers per stretch of one voice
//
// Local speakers are numbered per window only; the caller clusters the
// voiceprints into voices for the whole page (src/audio/voice-clusters.ts).
// Stretches of no one and under MIN_SEGMENT_S are left out: they make poor
// voiceprints. Stretches of two people at once are kept, marked `overlap`:
// the clustering gives them to the closest voice without learning from them.

import {
  AutoModel,
  AutoModelForAudioFrameClassification,
  AutoProcessor,
  type PreTrainedModel,
  type Processor,
  type Tensor,
} from '@huggingface/transformers';
import type { TaskInput, TaskOutput } from '../protocol';

/** The models' folders under public/models/. */
export const SEGMENTATION_MODEL = 'onnx-community/pyannote-segmentation-3.0';
export const VOICEPRINT_MODEL = 'onnx-community/wespeaker-voxceleb-resnet34-LM';

const RATE = 16_000;
/** pyannote segmentation-3.0 is trained on 10 s windows. */
const WINDOW_S = 10;
/** Shorter stretches aren't given a voiceprint. */
const MIN_SEGMENT_S = 0.6;
/** Powerset classes: 0 no one, 1-3 one speaker alone, 4-6 two at once. */
const NO_ONE = 0;
const TWO_AT_ONCE = new Set([4, 5, 6]);

interface Models {
  segProc: Processor;
  segModel: PreTrainedModel;
  embProc: Processor;
  embModel: PreTrainedModel;
}

export function createVoiceSeparationTask() {
  let models: Promise<Models> | undefined;
  const load = () =>
    (models ??= (async () => {
      const options = { device: 'wasm', dtype: 'q8' } as const;
      const [segProc, segModel, embProc, embModel] = await Promise.all([
        AutoProcessor.from_pretrained(SEGMENTATION_MODEL),
        AutoModelForAudioFrameClassification.from_pretrained(SEGMENTATION_MODEL, options),
        AutoProcessor.from_pretrained(VOICEPRINT_MODEL),
        AutoModel.from_pretrained(VOICEPRINT_MODEL, options),
      ]);
      return { segProc, segModel, embProc, embModel };
    })().catch((error: unknown) => {
      models = undefined; // let a later call try again
      throw error;
    }));

  return async ({ audio }: TaskInput<'voice-separation'>): Promise<TaskOutput<'voice-separation'>> => {
    const { segProc, segModel, embProc, embModel } = await load();
    const segments: TaskOutput<'voice-separation'>['segments'] = [];
    if (audio.length === 0) return { segments };
    // Equal windows of at most 10 s (a 15 s piece is two of 7.5 s).
    const count = Math.ceil(audio.length / (WINDOW_S * RATE));
    const size = Math.ceil(audio.length / count);
    for (let from = 0; from < audio.length; from += size) {
      const window = audio.subarray(from, Math.min(audio.length, from + size));
      const length = window.length / RATE;
      const { logits } = (await segModel(await segProc(window))) as { logits: Tensor };
      const found = (segProc as unknown as SegmentationProcessor).post_process_speaker_diarization(logits, window.length)[0] ?? [];
      for (const s of found) {
        const end = Math.min(s.end, length);
        if (s.id === NO_ONE || end - s.start < MIN_SEGMENT_S) continue;
        const clip = window.subarray(Math.floor(s.start * RATE), Math.floor(end * RATE));
        const { last_hidden_state } = (await embModel(await embProc(clip))) as { last_hidden_state: Tensor };
        segments.push({
          start: from / RATE + s.start,
          end: from / RATE + end,
          embedding: normalise(last_hidden_state.data as Float32Array),
          ...(TWO_AT_ONCE.has(s.id) ? { overlap: true } : {}),
        });
      }
    }
    return { segments };
  };
}

interface SegmentationProcessor {
  post_process_speaker_diarization(logits: Tensor, samples: number): Array<Array<{ id: number; start: number; end: number; confidence: number }>>;
}

function normalise(values: Float32Array): Float32Array {
  let sum = 0;
  for (const v of values) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  return Float32Array.from(values, (v) => v / norm);
}
