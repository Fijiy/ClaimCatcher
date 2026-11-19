<script lang="ts">
  // The Full transcript view: every line with its time and where its words
  // came from (and who spoke it, when voices are told apart). Lines with nothing checked are grey with "Skipped: <reason>",
  // and hovering or focusing one shows "Check this", which asks the session
  // for a forced check. Cards sit under the line they came from.
  import { sendMessage } from '../../messages';
  import type { Card, SkippedPart, TranscriptLine } from '../../session/types';
  import ClaimCard from './ClaimCard.svelte';
  import { SOURCE_TEXT, skippedText } from '../../ui/card-text';
  import { mediaTime } from './format';
  import { speakerAnswers } from './speaker-answers';

  const answers = speakerAnswers();

  let {
    lines,
    cards,
    listening,
    pageUrl,
    onreplay,
  }: {
    lines: TranscriptLine[];
    cards: Card[];
    listening: boolean;
    /** For the cards: the listened page's address and Replay. */
    pageUrl: string;
    onreplay: (seconds: number) => Promise<boolean>;
  } = $props();

  const cardsByLine = $derived(
    cards.reduce((byLine, card) => byLine.set(card.lineId, [...(byLine.get(card.lineId) ?? []), card]), new Map<string, Card[]>()),
  );
  /** Lines the viewer has asked to check, until their card arrives. */
  let asked = $state(new Set<string>());

  /** "Skipped: opinion", quoting the skipped words when they're only part of the line. */
  function why(part: SkippedPart, line: TranscriptLine): string {
    return part.text === line.text ? `Skipped: ${skippedText(part)}` : `Skipped: ${skippedText(part)} · “${part.text}”`;
  }

  function checkThis(line: TranscriptLine) {
    asked = new Set(asked).add(line.id);
    void sendMessage({ to: 'offscreen', type: 'force-check', lineId: line.id });
  }
</script>

{#if lines.length === 0}
  <p class="empty">{listening ? 'Listening. The transcript builds here as words are heard.' : 'No transcript yet.'}</p>
{:else}
  <ol class="transcript" aria-label="Transcript">
    {#each lines as line (line.id)}
      {@const lineCards = cardsByLine.get(line.id) ?? []}
      {@const skipped = line.skipped ?? []}
      {@const forced = lineCards.some((c) => c.forced) || asked.has(line.id)}
      <li class="line" class:skip={skipped.length > 0 && lineCards.length === 0} class:claimline={lineCards.some((c) => !c.forced)}>
        <time class="time" datetime={`PT${Math.floor(line.time)}S`}>{mediaTime(line.time)}</time>
        <p class="text">{line.text}</p>
        <!-- No whitespace between these: it would trail the line's text. -->
        <span class="meta"
          >{[answers.voiceText(line.voice), SOURCE_TEXT[line.source]].filter(Boolean).join(' · ')}</span
        >{#each skipped as part, i (i)}<span class="why"
            >{why(part, line)}</span
          >{/each}{#if skipped.length > 0 && !forced && listening}<button
            type="button"
            class="force"
            aria-label={`Check this: ${line.text}`}
            onclick={() => checkThis(line)}>Check this</button
          >{/if}{#if lineCards.length > 0}<ol class="cards" aria-label="Claims from this line">
            {#each lineCards as card (card.id)}
              <li><ClaimCard {card} {pageUrl} {onreplay} /></li>
            {/each}
          </ol>{/if}
      </li>
    {/each}
  </ol>
{/if}

<style>
  .transcript {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .line {
    position: relative;
    display: grid;
    grid-template-columns: 3.5em 1fr;
    column-gap: 8px;
    row-gap: 2px;
    padding: 8px 0;
    border-bottom: 1px solid var(--rule);
    line-height: 1.45;
  }
  .time {
    font-size: 12px;
    padding-top: 2px;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
  .text {
    margin: 0;
  }
  .skip .text {
    color: var(--ink-muted);
  }
  .claimline .text {
    font-weight: 700;
  }
  .meta,
  .why {
    grid-column: 2;
    font-size: 12px;
    color: var(--ink-muted);
  }
  /* Shown on hover, and whenever it has keyboard focus. */
  .force {
    position: absolute;
    top: 6px;
    right: 0;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    padding: 3px 10px;
    border: 1px solid var(--ink);
    border-radius: 6px;
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .line:hover .force,
  .force:focus-visible {
    opacity: 1;
  }
  .force:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .force {
      transition: none;
    }
  }
  .cards {
    grid-column: 1 / -1;
    display: grid;
    gap: 8px;
    list-style: none;
    margin: 6px 0 0;
    padding: 0 0 0 calc(3.5em + 8px);
  }
  .empty {
    color: var(--ink-muted);
  }
</style>
