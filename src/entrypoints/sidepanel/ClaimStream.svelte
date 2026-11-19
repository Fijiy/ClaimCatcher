<script lang="ts">
  // The Claims stream: cards in the order the claims were said, newest at the
  // bottom. It follows live (stays scrolled to the bottom) until the viewer
  // scrolls up or opens a card; then cards labelled since are counted on
  // "↓ N new · Jump to live", which scrolls back down and follows again.
  // Scrolling back to the bottom by hand follows again too.
  import { untrack, type Snippet } from 'svelte';
  import type { Card } from '../../session/types';
  import ClaimCard from './ClaimCard.svelte';
  import { labelledSince } from './labelled';

  let {
    cards,
    sessionId,
    pageUrl,
    onreplay,
    empty,
  }: {
    cards: Card[];
    sessionId: string | null;
    pageUrl: string;
    onreplay: (seconds: number) => Promise<boolean>;
    /** Shown while there are no cards. */
    empty?: Snippet;
  } = $props();

  /** Within this many pixels of the bottom counts as at the bottom. */
  const BOTTOM_SLACK = 24;

  let scroller = $state<HTMLElement>();
  let following = $state(true);
  let unseen = $state<string[]>([]);
  let lastTop = 0;
  const labelled = labelledSince();

  // Count cards that get their label while not following.
  $effect(() => {
    const fresh = labelled.update(sessionId, cards);
    untrack(() => {
      if (!following && fresh.length > 0) unseen = [...unseen, ...fresh.map((c) => c.id).filter((id) => !unseen.includes(id))];
    });
  });

  // While following, every change keeps the newest card in view.
  $effect(() => {
    void cards;
    if (following && scroller) toBottom(scroller);
  });

  function toBottom(el: HTMLElement) {
    el.scrollTop = el.scrollHeight;
    lastTop = el.scrollTop;
  }

  function pause() {
    if (!following) return;
    following = false;
    unseen = [];
  }

  function followLive() {
    following = true;
    unseen = [];
    if (scroller) toBottom(scroller);
  }

  function onscroll() {
    const el = scroller!;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
    const movedUp = el.scrollTop < lastTop;
    lastTop = el.scrollTop;
    if (atBottom) {
      if (!following) followLive();
    } else if (movedUp) {
      pause();
    }
  }
</script>

<div class="stream">
  <div class="scroller" bind:this={scroller} {onscroll}>
    {#if cards.length > 0}
      <ol class="cards" aria-label="Claims">
        {#each cards as card (card.id)}
          <li>
            <ClaimCard {card} {pageUrl} {onreplay} ontoggle={(open) => open && pause()} />
          </li>
        {/each}
      </ol>
    {:else}
      {@render empty?.()}
    {/if}
  </div>
  {#if !following && unseen.length > 0}
    <button type="button" class="jump" onclick={followLive}><span aria-hidden="true">↓</span> {unseen.length} new · Jump to live</button>
  {/if}
</div>

<style>
  .stream {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }
  .scroller {
    flex: 1;
    min-height: 0;
    overflow: auto;
    /* The stream decides where it scrolls; the browser mustn't shift it as cards grow. */
    overflow-anchor: none;
    padding: 4px 14px 56px;
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .jump {
    position: absolute;
    bottom: 14px;
    left: 50%;
    transform: translateX(-50%);
    height: 32px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: #fff;
    font: inherit;
    font-size: 13px;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgb(0 0 0 / 18%);
    cursor: pointer;
  }
  .jump:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
</style>
