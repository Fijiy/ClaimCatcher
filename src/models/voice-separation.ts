// Voice separation for the offscreen document: the model worker finds the
// stretches of one voice and their voiceprints; the clusters here
// (src/audio/voice-clusters.ts) keep one voice per person for the page.

import { MODEL_RATE } from '../audio/pcm';
import { createVoiceClusters, type VoiceClusters } from '../audio/voice-clusters';
import type { VoiceId, VoiceTurn } from '../session/types';
import type { ModelClient } from './client';

/** Voice separation's result for a stretch of audio, in media seconds. */
export interface SeparatedVoices {
  span: { start: number; end: number };
  turns: VoiceTurn[];
  merged: Array<{ voice: VoiceId; into: VoiceId }>;
}

export interface VoiceSeparation {
  /** Who spoke when in 16 kHz mono audio starting at media time `time`. The buffer is handed over. Rejects if the models can't run. */
  separate(samples: Float32Array, time: number): Promise<SeparatedVoices>;
  /** Merges two voices (the viewer gave them one name). */
  merge(voice: VoiceId, into: VoiceId): void;
  /** Another page: other people. Voices start again (with new ids). */
  reset(): void;
  /** Loads the models now. */
  warm(): Promise<void>;
}

/** One per tab. `newId` must never repeat in the document's life. */
export function createVoiceSeparation(models: Pick<ModelClient, 'run'>, newId: () => VoiceId): VoiceSeparation {
  let clusters: VoiceClusters = createVoiceClusters({ newId });
  return {
    async separate(samples, time) {
      const length = samples.length / MODEL_RATE;
      const { segments } = await models.run('voice-separation', { audio: samples }, [samples.buffer as ArrayBuffer]);
      const { turns, merged } = clusters.add(segments.map((s) => ({ ...s, start: time + s.start, end: time + s.end })));
      return { span: { start: time, end: time + length }, turns, merged };
    },
    merge: (voice, into) => clusters.merge(voice, into),
    reset() {
      clusters = createVoiceClusters({ newId });
    },
    async warm() {
      await models.run('voice-separation', { audio: new Float32Array(0) });
    },
  };
}
