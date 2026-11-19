<script lang="ts">
  // The blocked-player fallback. With tabCapture allowed, it gets a stream ID
  // for the tab straight away and hands it to the offscreen document, which
  // takes the tab's audio from then on; nothing shows. (The panel asks, not
  // the service worker: Chrome ties the ID to the process that asked for it,
  // and the cross-origin isolated offscreen document shares its process with
  // extension pages, not with the service worker.)
  //
  // Otherwise "This player blocks direct listening". Without tabCapture: why,
  // what Chrome's prompt will say (before it shows), and Allow. With it, when
  // the tab can't use it: Chrome grants tabCapture only at an icon click made
  // since Allow, so the offer to reopen the video in a new tab, at the same
  // moment where the page's own player shows its time, then to click the icon there.
  import { onMount } from 'svelte';
  import { browser, type Browser } from 'wxt/browser';
  import { sendMessage } from '../../messages';
  import { openPrivacyPage } from '../../privacy-page';
  import type { BlockedPlayer } from '../../session/types';

  interface Props {
    why: BlockedPlayer;
    /** The listened tab. */
    tabId: number;
  }
  let { why, tabId }: Props = $props();

  const TAB_CAPTURE: Browser.permissions.Permissions = { permissions: ['tabCapture'] };

  /** Whether the viewer has allowed tabCapture (here, or earlier on another page). */
  let allowed = $state<boolean | null>(null);
  let refused = $state(false);
  let reopenFailed = $state(false);
  /** The tab's audio through tabCapture: being started (or started: the session then drops this notice), or not possible on this page. */
  let tabAudio = $state<'not-tried' | 'starting' | 'not-on-this-page'>('not-tried');

  onMount(() => {
    const check = () => void browser.permissions.contains(TAB_CAPTURE).then((held) => (allowed = held));
    check();
    browser.permissions.onAdded.addListener(check);
    browser.permissions.onRemoved.addListener(check);
    return () => {
      browser.permissions.onAdded.removeListener(check);
      browser.permissions.onRemoved.removeListener(check);
    };
  });

  const reason: Record<BlockedPlayer, string> = {
    'cross-origin': 'Its video comes from another site, which doesn’t let extensions hear it directly.',
    drm: 'Its video is copy-protected, which doesn’t let extensions hear it directly.',
    embed: 'The video is embedded from another site, which ClaimCatcher can’t reach directly.',
    other: 'ClaimCatcher couldn’t hear it directly.',
  };
  // Only the page's own player shows ClaimCatcher its time; an embed from another site doesn't.
  const sameMoment = $derived(why !== 'embed');

  // Chrome's prompt must come from this click, before anything is awaited.
  function allow() {
    refused = false;
    browser.permissions.request(TAB_CAPTURE).then(
      (granted) => {
        if (granted) allowed = true;
        else refused = true;
      },
      () => (refused = true),
    );
  }

  $effect(() => {
    if (allowed && tabAudio === 'not-tried') void useTabAudio();
  });

  async function useTabAudio() {
    tabAudio = 'starting';
    try {
      const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId });
      const used = await sendMessage({ to: 'offscreen', type: 'use-tab-stream', tabId, streamId });
      if (!used) tabAudio = 'not-on-this-page';
    } catch (error) {
      // "Extension has not been invoked for the current page": the icon was clicked here before Allow.
      // "Cannot capture a tab with an active stream": another window's panel got there first.
      if (!String(error).includes('active stream')) tabAudio = 'not-on-this-page';
    }
  }

  async function reopen() {
    reopenFailed = false;
    reopenFailed = !(await sendMessage({ to: 'background', type: 'reopen-in-new-tab', tabId }).catch(() => false));
  }
</script>

{#if allowed === false || tabAudio === 'not-on-this-page'}
  <section class="blocked" aria-labelledby="blocked-heading">
    <h2 id="blocked-heading">This player blocks direct listening</h2>
    <p>{reason[why]} Captions on the page are still read if it has any.</p>
    {#if allowed === false}
      <p>
        ClaimCatcher can still listen through Chrome’s tab audio capture. When you click Allow, Chrome will ask whether
        ClaimCatcher may “Read and change all your data on all websites”. That is how Chrome words this permission for every
        extension. ClaimCatcher uses it only to hear the tab you click its icon on, while it is listening. The sound is turned
        into text on this device and never sent anywhere.
      </p>
      <p>
        You only allow it once. You can take it back at any time in
        <button type="button" class="link" onclick={() => openPrivacyPage()}>Privacy & data</button>.
      </p>
      <button type="button" class="action primary" onclick={allow}>Allow</button>
      {#if refused}
        <p role="alert">Chrome didn’t allow it, so ClaimCatcher can’t hear this player.</p>
      {/if}
    {:else}
      <p>
        Tab audio capture is allowed. Chrome only lets ClaimCatcher use it on a page opened since, so open the video again in a
        new tab{sameMoment ? ', at the same moment' : ''}. Then click the ClaimCatcher icon there.
      </p>
      <button type="button" class="action primary" onclick={reopen}>
        {sameMoment ? 'Reopen in a new tab at the same moment' : 'Reopen in a new tab'}
      </button>
      {#if reopenFailed}
        <p role="alert">The video couldn’t be reopened from here. Open it in a new tab yourself, then click the ClaimCatcher icon there.</p>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .blocked {
    padding: 10px 12px;
    margin: 8px 0 16px;
    background: var(--surface);
    border: 1px solid var(--ink);
    border-radius: 8px;
  }
  h2 {
    font-size: 15px;
    margin: 0 0 8px;
  }
  p {
    margin: 0 0 8px;
  }
  .action {
    font: inherit;
    font-weight: 700;
    padding: 6px 14px;
    border: 1px solid var(--ink);
    border-radius: 6px;
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
  }
  .action.primary {
    background: var(--ink);
    color: var(--surface);
  }
  .action.primary:hover {
    background: #2b2b2b;
  }
  .action:focus-visible,
  .link:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
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
</style>
