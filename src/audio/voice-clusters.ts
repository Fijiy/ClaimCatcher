// Online voice clustering, in the offscreen document: the model worker turns
// each stretch of speech into a voiceprint (WeSpeaker ResNet34, 256 numbers,
// L2-normalised), and this keeps one voice per person for the whole page.
// As measured in prototype/local-mode-eval (92-97% of speech on the right
// voice over four debate sessions):
//
//   1. each segment joins the voice whose voiceprint is most like it (cosine);
//   2. it starts a new voice instead if the best is below NEW_VOICE_BELOW and
//      the segment lasts at least NEW_VOICE_MIN_S (short ones are too unsteady);
//   3. a voice's voiceprint is the sum of its segments', weighted by length;
//   4. after each stretch, voices more alike than MERGE_ABOVE are merged into
//      the older one (0.3 merged Biden and Trump; the margin is thin);
//   5. a stretch of two voices at once (crosstalk) goes to the voice it is
//      most like, but never starts a voice or changes a voiceprint: it mixes
//      two people. Leaving it out left CBS's crosstalk with no voice (#41's
//      gate: 85% -> 90% of its speech on the right voice).
//
// Voice ids are made by `newId` and never reused, so a merged or forgotten
// voice can't come back as someone else.

import type { VoiceId, VoiceTurn } from '../session/types';

export const NEW_VOICE_BELOW = 0.4;
export const NEW_VOICE_MIN_S = 2;
export const MERGE_ABOVE = 0.5;

/** A stretch of one voice's speech, in media seconds, with its voiceprint. */
export interface VoiceSegment {
  start: number;
  end: number;
  /** L2-normalised. */
  embedding: Float32Array;
  /** Two voices at once: it joins a voice but never shapes one. */
  overlap?: boolean;
}

export interface VoiceClusters {
  /** One stretch of audio's segments, in time order: who spoke each, and voices found to be the same. */
  add(segments: VoiceSegment[]): { turns: VoiceTurn[]; merged: Array<{ voice: VoiceId; into: VoiceId }> };
  /** Merges `voice` into `into` (the viewer gave them one name). */
  merge(voice: VoiceId, into: VoiceId): void;
}

interface Cluster {
  id: VoiceId;
  /** Sum of its segments' voiceprints, each times its length. */
  sum: Float32Array;
}

export function createVoiceClusters({ newId }: { newId: () => VoiceId }): VoiceClusters {
  let clusters: Cluster[] = [];

  function absorb(into: Cluster, from: Cluster) {
    for (let i = 0; i < into.sum.length; i++) into.sum[i]! += from.sum[i]!;
    clusters = clusters.filter((c) => c !== from);
  }

  return {
    add(segments) {
      const turns: VoiceTurn[] = [];
      for (const segment of segments) {
        const length = segment.end - segment.start;
        if (length <= 0) continue;
        let best: Cluster | undefined;
        let bestSim = -Infinity;
        for (const cluster of clusters) {
          const sim = cosine(segment.embedding, cluster.sum);
          if (sim > bestSim) [best, bestSim] = [cluster, sim];
        }
        if (segment.overlap) {
          if (best) turns.push({ start: segment.start, end: segment.end, voice: best.id });
          continue;
        }
        if (!best || (bestSim < NEW_VOICE_BELOW && length >= NEW_VOICE_MIN_S)) {
          best = { id: newId(), sum: new Float32Array(segment.embedding.length) };
          clusters.push(best);
        }
        for (let i = 0; i < best.sum.length; i++) best.sum[i]! += (segment.embedding[i] ?? 0) * length;
        turns.push({ start: segment.start, end: segment.end, voice: best.id });
      }

      const merged: Array<{ voice: VoiceId; into: VoiceId }> = [];
      for (;;) {
        let pair: [Cluster, Cluster] | undefined;
        let most = MERGE_ABOVE;
        clusters.forEach((a, i) =>
          clusters.slice(i + 1).forEach((b) => {
            const sim = cosine(a.sum, b.sum);
            if (sim > most) [pair, most] = [[a, b], sim];
          }),
        );
        if (!pair) break;
        const [older, newer] = pair;
        absorb(older, newer);
        merged.push({ voice: newer.id, into: older.id });
        for (const turn of turns) if (turn.voice === newer.id) turn.voice = older.id;
        for (const m of merged) if (m.into === newer.id) m.into = older.id;
      }
      return { turns, merged };
    },
    merge(voice, into) {
      const from = clusters.find((c) => c.id === voice);
      const to = clusters.find((c) => c.id === into);
      if (from && to && from !== to) absorb(to, from);
    },
  };
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * (b[i] ?? 0);
    na += a[i]! * a[i]!;
    nb += (b[i] ?? 0) * (b[i] ?? 0);
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}
