// Spots cards that have just got their label, for the "N new" count and the
// screen-reader announcements. Cards already labelled when a session is first
// seen (the panel opened mid-session) count as seen, not new. A card checked
// again (after "Who said this?") is new again when it gets its next label.

import type { Card, Verdict } from '../../session/types';

export type LabelledCard = Card & { check: { state: 'done'; verdict: Verdict } };

export function labelledSince() {
  let session: string | null | undefined;
  let seen = new Set<string>();
  return {
    /** The cards labelled since the last call. */
    update(sessionId: string | null, cards: Card[]): LabelledCard[] {
      const done = cards.filter((c): c is LabelledCard => c.check.state === 'done');
      if (sessionId !== session) {
        session = sessionId;
        seen = new Set(done.map((c) => c.id));
        return [];
      }
      for (const c of cards) if (c.check.state === 'checking') seen.delete(c.id);
      const fresh = done.filter((c) => !seen.has(c.id));
      for (const c of fresh) seen.add(c.id);
      return fresh;
    },
  };
}
