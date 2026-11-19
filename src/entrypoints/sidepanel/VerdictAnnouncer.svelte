<script lang="ts">
  // A polite live region: each new verdict is read out once, as
  // "<Label>: <claim>. <conclusion>", whichever view is showing.
  import { untrack } from 'svelte';
  import type { Card } from '../../session/types';
  import { announcement } from '../../ui/card-text';
  import { labelledSince } from './labelled';

  let { cards, sessionId }: { cards: Card[]; sessionId: string | null } = $props();

  /** Only the latest few stay in the region; older ones have been read. */
  const KEEP = 5;
  let said = $state<Array<{ id: string; text: string }>>([]);
  const labelled = labelledSince();
  let count = 0;

  $effect(() => {
    const fresh = labelled.update(sessionId, cards);
    if (fresh.length === 0) return;
    const added = fresh.map((c) => ({ id: String(++count), text: announcement(c, c.check.verdict) }));
    untrack(() => (said = [...said, ...added].slice(-KEEP)));
  });
</script>

<div class="visually-hidden" aria-live="polite" aria-relevant="additions">
  {#each said as item (item.id)}<p>{item.text}</p>{/each}
</div>
