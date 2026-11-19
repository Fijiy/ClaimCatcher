<script lang="ts">
  // One verdict card (live-panel prototype, variant A, palette 1).
  //
  //   collapsed  the label with its glyph, the time it was said (replays it),
  //              tags, the claim in bold and the conclusion
  //   expanded   the speaker's own words when the claim was rewritten to
  //              stand alone, what's missing (Misleading only), the sources, the
  //              judged-as-of date, Copy with sources and Replay
  //   checking   white, a spinner, "Checking…" and the stage
  //
  // "Said by <name>" when the speaker is known, else the voice ("Voice A")
  // when voices are told apart. A claim that depends on an unknown speaker
  // asks "Who said this?" with the names on the page as buttons (and "Someone
  // else…"); it stays Unverified until answered. On a captioned page that
  // prompt also offers "Tell voices apart for this video". A new voice's first
  // claim asks "Who is this?" (names, "Someone else…", Skip), once per voice.
  //
  // The disclosure button opens and closes the card from the keyboard; a click
  // anywhere else on a labelled card does the same for the mouse.
  import type { Card, Label } from '../../session/types';
  import {
    GLYPH,
    STAGE_TEXT,
    asSaid,
    cardTags,
    claimText,
    copyWithSources,
    detailSummary,
    judgedAsOfText,
    mediaClock,
    showsMissing,
    speakerText,
  } from '../../ui/card-text';
  import SourceList from './SourceList.svelte';
  import { speakerAnswers } from './speaker-answers';

  let {
    card,
    pageUrl,
    onreplay,
    ontoggle,
  }: {
    card: Card;
    /** The listened page's address, for the timestamped link in Copy with sources. */
    pageUrl: string;
    /** Seeks the video to `seconds`; resolves false if it couldn't. */
    onreplay: (seconds: number) => Promise<boolean>;
    ontoggle?: (open: boolean) => void;
  } = $props();

  const answers = speakerAnswers();
  let open = $state(false);
  /** The name the viewer just gave, until the card is checked again. */
  let answered = $state<string | null>(null);
  let typing = $state(false);
  let typed = $state('');
  let note = $state('');
  let noteTimer: ReturnType<typeof setTimeout> | undefined;

  const tintOf: Record<Label, string> = { True: 'true', Misleading: 'misleading', False: 'false', Unverified: 'unverified' };
  const verdict = $derived(card.check.state === 'done' ? card.check.verdict : null);
  const tint = $derived(verdict ? tintOf[verdict.label] : 'checking');
  const time = $derived(mediaClock(card.time));
  const detailId = $derived(`detail-${card.id}`);

  const whoSaid = $derived(answered === null ? card.whoSaid : undefined);
  const promptId = $derived(`who-${card.id}`);

  /** "Who is this?": what the viewer just did, until the card stops asking. */
  let voiceAnswered = $state<string | null>(null);
  let voiceTyping = $state(false);
  let voiceTyped = $state('');
  const whoIsThis = $derived(voiceAnswered === null ? card.whoIsThis : undefined);
  const voicePromptId = $derived(`voice-${card.id}`);
  const voiceLine = $derived(card.speaker ? null : answers.voiceText(card.voice));
  let offerTaken = $state(false);

  function nameVoice(name: string) {
    const trimmed = name.trim();
    if (!trimmed || !card.whoIsThis) return;
    voiceAnswered = trimmed;
    voiceTyping = false;
    answers.nameVoice(card.whoIsThis.voice, trimmed);
  }

  function skipVoice() {
    if (!card.whoIsThis) return;
    voiceAnswered = '';
    answers.skipVoice(card.whoIsThis.voice);
  }

  $effect(() => {
    if (!card.whoIsThis) voiceAnswered = null;
  });

  function separateVoices() {
    offerTaken = true;
    answers.separateVoices();
  }

  function answer(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    answered = trimmed;
    typing = false;
    answers.answer(card.id, trimmed);
  }

  // The session has taken the answer once the card stops asking.
  $effect(() => {
    if (!card.whoSaid) answered = null;
  });

  function toggle() {
    open = !open;
    ontoggle?.(open);
  }

  function onCardClick(event: MouseEvent) {
    if (!verdict) return;
    // Links and buttons do their own thing; selecting text isn't a click.
    if ((event.target as Element).closest('a, button, input, form, [role="group"]')) return;
    if (getSelection()?.toString()) return;
    toggle();
  }

  function say(text: string) {
    note = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => (note = ''), 4000);
  }

  async function replay() {
    if (!(await onreplay(card.time))) say('Couldn’t replay: the video’s page can’t be reached from here any more.');
  }

  async function copy() {
    if (!verdict) return;
    try {
      await navigator.clipboard.writeText(copyWithSources(card, verdict, pageUrl));
      const n = verdict.sources.length;
      say(`Copied with ${n} source${n === 1 ? '' : 's'}.`);
    } catch {
      say('Couldn’t copy to the clipboard.');
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article class="card {tint}" class:open aria-busy={!verdict} onclick={onCardClick}>
  <div class="row">
    {#if verdict}
      <span class="chip {tint}"><span aria-hidden="true">{GLYPH[verdict.label]}</span> <span>{verdict.label}</span></span>
    {:else}
      <span class="chip checking"><span class="spin" aria-hidden="true"></span>Checking…</span>
    {/if}
    <button type="button" class="time" aria-label="Replay from {time}" title="Replay this moment" onclick={replay}>{time}</button>
  </div>
  {#each cardTags(card) as tag (tag)}
    <p class="tag">{tag}</p>
  {/each}
  {#if speakerText(card)}
    <p class="speaker">{speakerText(card)}</p>
  {:else if voiceLine}
    <p class="speaker">{voiceLine}</p>
  {/if}
  <p class="claim">{claimText(card)}</p>
  {#if whoIsThis}
    <div class="who" role="group" aria-labelledby={voicePromptId}>
      <p class="ask" id={voicePromptId}>Who is this?</p>
      <p class="muted small">{answers.voiceText(whoIsThis.voice) ?? 'This voice'} hasn’t been named yet. Its later claims will carry the name.</p>
      <div class="names">
        {#each whoIsThis.names as name (name)}
          <button type="button" class="btn name" onclick={() => nameVoice(name)}>{name}</button>
        {/each}
        {#if !voiceTyping}
          <button type="button" class="btn name other" onclick={() => (voiceTyping = true)}>Someone else…</button>
        {/if}
        <button type="button" class="btn name other" onclick={skipVoice}>Skip</button>
      </div>
      {#if voiceTyping}
        <form
          class="other-name"
          onsubmit={(event) => {
            event.preventDefault();
            nameVoice(voiceTyped);
          }}
        >
          <!-- svelte-ignore a11y_autofocus -->
          <input type="text" bind:value={voiceTyped} aria-label="Who is this? Their name" placeholder="Their name" autocomplete="off" autofocus />
          <button type="submit" class="btn" disabled={!voiceTyped.trim()}>Name</button>
        </form>
      {/if}
    </div>
  {:else if voiceAnswered && card.whoIsThis}
    <p class="muted small">Naming this voice {voiceAnswered}…</p>
  {/if}
  {#if verdict}
    <p class="conclusion">{verdict.conclusion}</p>
    {#if whoSaid}
      <div class="who" role="group" aria-labelledby={promptId}>
        <p class="ask" id={promptId}>Who said this?</p>
        <div class="names">
          {#each whoSaid.names as name (name)}
            <button type="button" class="btn name" onclick={() => answer(name)}>{name}</button>
          {/each}
          {#if !typing}
            <button type="button" class="btn name other" onclick={() => (typing = true)}>Someone else…</button>
          {/if}
        </div>
        {#if typing}
          <form
            class="other-name"
            onsubmit={(event) => {
              event.preventDefault();
              answer(typed);
            }}
          >
            <!-- svelte-ignore a11y_autofocus -->
            <input type="text" bind:value={typed} aria-label="Who said this? Their name" placeholder="Their name" autocomplete="off" autofocus />
            <button type="submit" class="btn" disabled={!typed.trim()}>Check</button>
          </form>
        {/if}
        {#if whoSaid.offerVoices && !offerTaken}
          <button type="button" class="btn offer" onclick={separateVoices}>Tell voices apart for this video</button>
        {:else if whoSaid.offerVoices}
          <p class="muted small">Telling voices apart from now on…</p>
        {/if}
      </div>
    {:else if answered !== null && card.whoSaid}
      <p class="muted small">Checking with {answered}…</p>
    {/if}
    <button type="button" class="more" aria-expanded={open} aria-controls={detailId} onclick={toggle}>
      {detailSummary(verdict)}<span aria-hidden="true">{open ? ' ▴' : ' ▾'}</span>
    </button>
    {#if open}
      <div class="detail" id={detailId}>
        {#if asSaid(card)}
          <p class="said"><b>As said</b> “{asSaid(card)}”</p>
        {/if}
        {#if showsMissing(verdict)}
          <div class="missing"><b>What’s missing</b><p>{verdict.missing}</p></div>
        {/if}
        {#if verdict.sources.length > 0 || (verdict.context?.length ?? 0) > 0}
          <SourceList {verdict} />
        {:else}
          <p class="none">No sources found.</p>
        {/if}
        <p class="as-of">{judgedAsOfText(verdict)}</p>
        <div class="actions">
          <button type="button" class="btn" onclick={copy}>Copy with sources</button>
          <button type="button" class="btn" onclick={replay}>Replay {time}</button>
        </div>
      </div>
    {/if}
  {:else if card.check.state === 'checking'}
    <p class="conclusion muted">{STAGE_TEXT[card.check.stage]}</p>
  {/if}
  <p class="note" aria-live="polite">{note}</p>
</article>

<style>
  .card {
    margin: 8px 0;
    padding: 12px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    transition:
      background-color 0.12s,
      border-color 0.12s;
  }
  .card:not(.checking) {
    cursor: pointer;
  }
  .card.checking:hover {
    background: #fbfbfb;
  }
  .card.true {
    background: var(--true-card);
    border-color: var(--true-border);
  }
  .card.true:hover {
    background: var(--true-hover);
    border-color: var(--true-hover-border);
  }
  .card.misleading {
    background: var(--misleading-card);
    border-color: var(--misleading-border);
  }
  .card.misleading:hover {
    background: var(--misleading-hover);
    border-color: var(--misleading-hover-border);
  }
  .card.false {
    background: var(--false-card);
    border-color: var(--false-border);
  }
  .card.false:hover {
    background: var(--false-hover);
    border-color: var(--false-hover-border);
  }
  .card.unverified {
    background: var(--unverified-card);
    border-color: var(--unverified-border);
  }
  .card.unverified:hover {
    background: var(--unverified-hover);
    border-color: var(--unverified-hover-border);
  }
  p {
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .chip {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 5px;
    padding: 4px 7px;
    border-radius: 4px;
    font: 700 12px/1 var(--font);
    white-space: nowrap;
  }
  .chip.true {
    color: var(--true-ink);
    background: var(--true-fill);
  }
  .chip.misleading {
    color: var(--misleading-ink);
    background: var(--misleading-fill);
  }
  .chip.false {
    color: var(--false-ink);
    background: var(--false-fill);
  }
  .chip.unverified {
    color: var(--unverified-ink);
    background: var(--unverified-fill);
  }
  .chip.checking {
    color: var(--ink-muted);
    background: var(--raised);
  }
  .spin {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation-duration: 3s;
    }
    .card {
      transition: none;
    }
  }
  .time {
    margin-left: auto;
    padding: 2px 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--ink-muted);
    cursor: pointer;
  }
  .time:hover {
    color: var(--ink);
    text-decoration: underline;
  }
  .tag {
    display: inline-block;
    margin-top: 9px;
    margin-right: 6px;
    padding: 3px 7px;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.35;
    color: var(--ink-muted);
    background: rgb(0 0 0 / 6%);
  }
  .speaker {
    margin-top: 9px;
    font-size: 12px;
    color: var(--ink-muted);
  }
  .speaker + .claim {
    margin-top: 2px;
  }
  .who {
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 6px;
    background: rgb(255 255 255 / 65%);
    cursor: default;
  }
  .ask {
    font: 700 13px/1.3 var(--font);
  }
  .names {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .btn.name {
    background: var(--surface);
    border: 1px solid var(--unverified-border);
  }
  .btn.name:hover:not(:disabled) {
    background: var(--frame);
  }
  .btn:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .other {
    color: var(--ink-muted);
  }
  .btn.offer {
    margin-top: 8px;
    background: transparent;
    border: 1px dashed var(--unverified-border);
    color: var(--ink-muted);
  }
  .btn.offer:hover:not(:disabled) {
    background: var(--frame);
    color: var(--ink);
  }
  .other-name {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .other-name input {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font: inherit;
    font-size: 13px;
  }
  .other-name input:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  .small {
    margin-top: 6px;
    font-size: 12px;
  }
  .claim {
    margin: 9px 0 4px;
    font: 700 15px/1.4 var(--font);
  }
  .conclusion {
    font-size: 14px;
    line-height: 1.45;
  }
  .muted {
    color: var(--ink-muted);
  }
  .more {
    display: block;
    margin-top: 8px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 12px;
    color: var(--ink-muted);
    cursor: pointer;
  }
  .card:hover .more,
  .more:focus-visible {
    color: var(--ink);
  }
  .detail {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgb(0 0 0 / 8%);
    cursor: default;
  }
  .missing {
    margin-bottom: 12px;
    padding: 10px 12px;
    border-radius: 6px;
    background: rgb(255 255 255 / 65%);
    font-size: 14px;
    line-height: 1.45;
  }
  .missing b {
    font-size: 13px;
  }
  .missing p {
    margin-top: 2px;
  }
  .none {
    font-size: 12px;
    color: var(--ink-muted);
  }
  .said {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--ink-muted);
  }
  .said b {
    color: var(--ink);
    font-weight: 600;
    margin-right: 4px;
  }
  .as-of {
    margin-top: 10px;
    font-size: 12px;
    color: var(--ink-muted);
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .btn {
    height: 28px;
    padding: 0 11px;
    border: 0;
    border-radius: 6px;
    background: var(--raised);
    font: inherit;
    font-size: 13px;
    color: var(--ink);
    white-space: nowrap;
    cursor: pointer;
  }
  .btn:hover {
    background: #e3e3e3;
  }
  .time:focus-visible,
  .more:focus-visible,
  .btn:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .note {
    font-size: 12px;
    color: var(--ink-muted);
  }
  .note:not(:empty) {
    margin-top: 8px;
  }
</style>
