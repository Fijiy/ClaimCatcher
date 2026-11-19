// Speech-to-text for the transcriber (src/audio/transcriber.ts), run in the
// model worker. The audio buffer is handed over, not copied.

import type { ModelClient } from './client';

export interface SpeechToText {
  /** The words in 16 kHz mono audio. Rejects if the model can't run. */
  transcribe(samples: Float32Array): Promise<string>;
  /** Loads the model now, so the first piece of audio doesn't wait for it. */
  warm(): Promise<void>;
}

export function createSpeechToText(models: Pick<ModelClient, 'run'>): SpeechToText {
  return {
    async transcribe(samples) {
      const { text } = await models.run('speech-to-text', { audio: samples }, [samples.buffer as ArrayBuffer]);
      return text;
    },
    async warm() {
      await models.run('speech-to-text', { audio: new Float32Array(0) });
    },
  };
}
