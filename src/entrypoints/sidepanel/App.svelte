<script lang="ts">
  // The live panel. Display only: it renders the mirrored session and sends
  // viewer commands back; it decides nothing itself.
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { sendMessage } from '../../messages';
  import { openPrivacyPage, type PrivacySection } from '../../privacy-page';
  import { exportSession, sessionFileName } from '../../session/export';
  import { voiceText } from '../../session/view';
  import type { StopReason } from '../../session/types';
  import { missing, type Setup } from '../../settings';
  import { SEARCHES } from '../../session/searches';
  import { LocalModelWatch } from '../../ui/local-model.svelte';
  import LocalModelStatus from '../../ui/LocalModelStatus.svelte';
  import { offersLocalMode } from '../../local-model';
  import { SOURCE_TEXT } from '../../ui/card-text';
  import { PROVIDER } from '../welcome/copy';
  import BlockedPlayer from './BlockedPlayer.svelte';
  import FootprintFooter from './FootprintFooter.svelte';
  import ClaimStream from './ClaimStream.svelte';
  import Menu, { type MenuItem } from './Menu.svelte';
  import { SessionMirror } from './mirror.svelte';
  import { saveFile } from './save-file';
  import { provideSourceLinks } from './source-links';
  import { provideSpeakerAnswers } from './speaker-answers';
  import TranscriptView from './TranscriptView.svelte';
  import VerdictAnnouncer from './VerdictAnnouncer.svelte';
  import ViewSwitch, { type PanelView } from './ViewSwitch.svelte';

  const mirror = new SessionMirror();
  provideSourceLinks({ isOpened: (url) => mirror.isOpened(url), opened: (url) => mirror.markOpened(url) });
  // The session shows a prompt only while it can act on the answer (after Stop too).
  provideSpeakerAnswers({
    answer: (cardId, name) => void sendMessage({ to: 'offscreen', type: 'speaker-answer', cardId, name }).catch(() => {}),
    nameVoice: (voice, name) => void sendMessage({ to: 'offscreen', type: 'voice-name', voice, name }).catch(() => {}),
    skipVoice: (voice) => void sendMessage({ to: 'offscreen', type: 'voice-skip', voice }).catch(() => {}),
    separateVoices: () => void sendMessage({ to: 'offscreen', type: 'separate-voices' }).catch(() => {}),
    voiceText: (voice) => voiceText(mirror.view.voices, voice),
  });
  let setup = $state<Setup | null>(null);
  let view = $state<PanelView>('claims');
  /** Local mode's model on this device: listening in local mode waits for its download. */
  const local = new LocalModelWatch();
  onMount(() => {
    const stopLocal = local.start();
    // Consent and the key are set on the first-run page / Privacy & data; ask
    // the worker again whenever they change there.
    const refresh = () => void sendMessage({ to: 'background', type: 'get-setup' }).then((s) => (setup = s));
    refresh();
    browser.storage.local.onChanged.addListener(refresh);
    const disconnect = mirror.connect();
    return () => {
      browser.storage.local.onChanged.removeListener(refresh);
      disconnect();
      stopLocal();
    };
  });

  const status = $derived(mirror.view.status);
  const lines = $derived(mirror.view.lines);
  const cards = $derived(mirror.view.cards);

  const TINYFISH = SEARCHES.tinyfish.name;

  // Why listening stopped, when it's something the viewer has to act on. Each
  // links to Privacy & data, where the key is set up.
  const stopMessages: Partial<Record<StopReason, string>> = {
    'key-rejected': `Listening stopped: ${PROVIDER.name} rejected the API key. Check it or add a new one in Privacy & data, then click the ClaimCatcher icon again.`,
    'no-credit':
      `Listening stopped: the API key has no credit left, or has reached its spending limit. Add credit at ${PROVIDER.name}, then click the ClaimCatcher icon again.`,
    'no-key': `Listening stopped: there is no ${PROVIDER.name} API key. Add one in Privacy & data, then click the ClaimCatcher icon again.`,
    'search-key-rejected': `Listening stopped: ${TINYFISH} rejected the search key. Check it or add a new one in Privacy & data, then click the ClaimCatcher icon again.`,
    'no-search-key': `Listening stopped: there is no ${TINYFISH} API key for search. Add one in Privacy & data, then click the ClaimCatcher icon again.`,
    'search-changed': 'Listening stopped because you chose another search. Click the ClaimCatcher icon to listen with it.',
    'left-site':
      'Listening stopped because this tab moved to another site. ClaimCatcher only listens on the site you started it on: click the ClaimCatcher icon to listen here.',
    'tab-closed': 'Listening stopped because the tab was closed.',
    'page-unavailable': "Listening stopped: ClaimCatcher can't read this page.",
    'local-model-unavailable':
      "Listening stopped: local mode needs Gemini Nano, the model built into Chrome, and it isn't ready on this device. See Privacy & data.",
    'mode-changed': 'Listening stopped because you switched mode. Click the ClaimCatcher icon to listen in the new mode.',
    'key-changed': 'Listening stopped because you saved a different API key. Click the ClaimCatcher icon to listen with it.',
    reopened: 'The video is open again in a new tab. Click the ClaimCatcher icon there to listen.',
  };
  const stopMessage = $derived(status.state === 'stopped' ? stopMessages[status.reason] : undefined);
  const stopped = $derived(status.state === 'stopped' ? status.after : null);
  const keyTrouble = $derived(stopped?.keyTrouble === true);
  // Listening is blocked until the viewer has agreed on the first-run page and set a key.
  // In local mode, also until Gemini Nano is on the device (never a quiet switch to cloud mode).
  const setupNeeded = $derived.by((): { message: string | null; action: string | null; section: PrivacySection; local?: true } | null => {
    // A refused or missing key is explained by its stop message; after a change of settings, the new ones' needs show.
    if (!setup || status.state === 'listening' || (stopMessage && stopped && !stopped.settingsChanged)) return null;
    if (!setup.consent)
      return {
        message: 'Before ClaimCatcher can listen, read what it hears, sends and keeps, and set it up.',
        action: 'Open setup',
        section: 'top',
      };
    const lacking = missing(setup)[0];
    if (lacking === 'venice')
      return {
        message: `ClaimCatcher needs your ${PROVIDER.name} API key before it can listen. Add it, then click the ClaimCatcher icon again.`,
        action: 'Add your key',
        section: 'key',
      };
    if (lacking === 'tinyfish')
      return {
        message: `Local mode searches at ${TINYFISH}, which needs your free ${TINYFISH} API key. Add it, then click the ClaimCatcher icon again.`,
        action: 'Add your key',
        section: 'key',
      };
    if (setup.consent.mode === 'local' && local.model && local.model.state !== 'available') {
      const offered = offersLocalMode(local.model);
      return {
        message: offered ? null : 'To listen here, switch to cloud mode in Privacy & data.',
        action: offered ? null : 'Privacy & data',
        section: 'top',
        local: true,
      };
    }
    return null;
  });

  function stop() {
    void sendMessage({ to: 'background', type: 'stop-listening' });
  }

  /** Replay: the background seeks the listened tab's video, through that tab's activeTab grant. */
  async function replay(time: number): Promise<boolean> {
    if (status.state === 'idle') return false;
    return (await sendMessage({ to: 'background', type: 'replay', tabId: status.tabId, time }).catch(() => false)) === true;
  }
  const pageUrl = $derived(status.state === 'idle' ? '' : status.page.url);

  const canListenAgain = $derived(stopped?.canListenAgain === true);
  let listenAgainRefused = $state(false);
  async function listenAgain() {
    if (status.state !== 'stopped') return;
    listenAgainRefused = false;
    const started = await sendMessage({ to: 'background', type: 'listen-again', tabId: status.tabId }).catch(() => false);
    listenAgainRefused = !started;
  }
  $effect(() => {
    if (status.state !== 'stopped') listenAgainRefused = false;
  });

  // One tab at a time: a click on another tab asks first.
  const switchRequest = $derived(
    mirror.switchRequest && status.state === 'listening' && mirror.switchRequest.tabId !== status.tabId ? mirror.switchRequest : null,
  );
  const firstTab = $derived(status.state === 'idle' ? '' : status.page.title.trim() || 'the other tab');
  function answerSwitch(confirm: boolean) {
    void sendMessage({ to: 'background', type: 'answer-switch', confirm });
  }

  // The page's player blocks direct listening, and tabCapture can't be used here yet.
  const blocked = $derived(status.state === 'listening' && mirror.view.audioCapture.via === 'blocked' ? mirror.view.audioCapture : null);

  const hasSession = $derived(mirror.view.lines.length > 0 || mirror.view.cards.length > 0);
  // The ⋯ menu. To add an entry, add an item here.
  const menuItems: MenuItem[] = $derived([
    { label: 'Save session…', onselect: saveSession, disabled: !hasSession },
    { label: 'Clear now', onselect: () => void mirror.clear(), disabled: !hasSession },
    { label: 'Privacy & data', onselect: () => void openPrivacyPage() },
  ]);

  /** One local JSON file through the browser's save flow; nothing is uploaded. */
  function saveSession() {
    const now = Date.now();
    saveFile(sessionFileName(now), JSON.stringify(exportSession(mirror.view, now), null, 2));
  }
</script>

<header class="bar">
  {#if status.state === 'listening'}
    <p class="state" role="status"><span class="dot" aria-hidden="true"></span>Listening</p>
    <!-- Where the transcript comes from now: captions, or the on-device transcript while they're missing. -->
    <p class="source" aria-live="polite" title="Where the transcript comes from">{SOURCE_TEXT[mirror.view.transcriptSource]}</p>
    <button type="button" class="stop" onclick={stop}>Stop</button>
  {:else if status.state === 'stopped'}
    <p class="state" role="status">Stopped</p>
    {#if canListenAgain}
      <button type="button" class="stop primary" onclick={listenAgain}>Listen again</button>
    {/if}
  {:else}
    <p class="state" role="status">Not listening</p>
  {/if}
  <Menu items={menuItems} />
</header>

{#if status.state !== 'idle'}
  <ViewSwitch bind:view {cards} />
{/if}

<div class="notices">
  {#if switchRequest}
    <div class="question" role="alertdialog" aria-labelledby="switch-question" tabindex="-1">
      <p id="switch-question">Stop listening on “{firstTab}” and listen here?</p>
      <div class="answers">
        <button type="button" class="stop primary" onclick={() => answerSwitch(true)}>Stop and listen here</button>
        <button type="button" class="stop" onclick={() => answerSwitch(false)}>Keep listening there</button>
      </div>
    </div>
  {/if}
  {#if blocked && status.state === 'listening'}
    <BlockedPlayer why={blocked.why} tabId={status.tabId} />
  {/if}
  {#if listenAgainRefused}
    <p class="stopped-why" role="alert">
      ClaimCatcher can't listen to that tab again from here. Click the ClaimCatcher icon on the tab with the video.
    </p>
  {/if}
  {#if stopMessage}
    <div class="stopped-why" role="alert">
      <p>{stopMessage}</p>
      {#if keyTrouble}
        <button type="button" class="link" onclick={() => openPrivacyPage('key')}>Privacy & data</button>
      {/if}
    </div>
  {/if}
  {#if setupNeeded}
    <div class="setup">
      {#if setupNeeded.local}<LocalModelStatus watch={local} />{/if}
      {#if setupNeeded.message}<p>{setupNeeded.message}</p>{/if}
      {#if setupNeeded.action}
        <button type="button" class="stop" onclick={() => openPrivacyPage(setupNeeded.section)}>{setupNeeded.action}</button>
      {/if}
    </div>
  {/if}
</div>

{#if view === 'transcript' && status.state !== 'idle'}
  <div class="transcript-view">
    <TranscriptView {lines} {cards} listening={status.state === 'listening'} {pageUrl} onreplay={replay} />
  </div>
{:else}
  <ClaimStream {cards} sessionId={mirror.view.sessionId} {pageUrl} onreplay={replay}>
    {#snippet empty()}
      {#if status.state === 'listening'}
        <p class="hint">
          Listening. Checkable claims appear here as they’re said. Opinions and procedure are skipped; see Full transcript
          to check any line.
        </p>
      {:else if status.state === 'idle' && !setupNeeded}
        <p class="hint">Click the ClaimCatcher icon, or press Alt+Shift+L, on the tab with the video.</p>
      {/if}
    {/snippet}
  </ClaimStream>
{/if}

{#if status.state !== 'idle'}
  <FootprintFooter
    counters={mirror.view.counters}
    startedAt={status.startedAt}
    stoppedAt={status.state === 'stopped' ? status.stoppedAt : null}
  />
{/if}

<VerdictAnnouncer {cards} sessionId={mirror.view.sessionId} />

<style>
  /* The panel is one full-height column; only the view below the header and
     switch scrolls, so they always show. */
  :global(body) {
    height: 100vh;
    overflow: hidden;
  }
  :global(#app) {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: var(--surface);
    border-bottom: 1px solid var(--rule);
  }
  .state {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-weight: 700;
  }
  .source {
    margin: 0;
    font-size: 13px;
    color: var(--ink-muted);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--live);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
      transform: scale(0.8);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
  }
  .stop {
    font: inherit;
    font-weight: 700;
    padding: 6px 14px;
    border: 1px solid var(--ink);
    border-radius: 6px;
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
  }
  .stop:hover {
    background: var(--frame);
  }
  .stop:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .stop.primary {
    background: var(--ink);
    color: var(--surface);
  }
  .stop.primary:hover {
    background: #2b2b2b;
  }
  .question {
    margin: 8px 0 12px;
    padding: 12px;
    background: var(--surface);
    border: 1px solid var(--ink);
    border-radius: 8px;
  }
  .question p {
    margin: 0 0 10px;
    font-weight: 700;
  }
  .answers {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .notices {
    padding: 0 14px;
  }
  .notices:empty {
    display: none;
  }
  .transcript-view {
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
    padding: 4px 14px 24px;
  }
  .hint {
    padding: 32px 6px;
    text-align: center;
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink-muted);
  }
  .stopped-why,
  .setup {
    padding: 10px 12px;
    margin: 8px 0 16px;
    background: var(--surface);
    border: 1px solid var(--live);
    border-radius: 8px;
  }
  .setup {
    border-color: var(--rule);
  }
  .stopped-why p,
  .setup p {
    margin: 0 0 8px;
  }
  .link {
    font: inherit;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    text-decoration: underline;
    cursor: pointer;
  }
  .link:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
</style>
