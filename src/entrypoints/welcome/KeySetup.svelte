<script lang="ts">
  // Key setup (spec story 8–11): how to make the key at its service, then a
  // free check that it works. With a key set, it shows the key masked, with
  // Forget key. Two keys use it: the provider's (Venice: an inference-only key
  // with a spending limit and an optional expiry) and TinyFish's (local mode's
  // free search, ticket #45).
  import type { Snippet } from 'svelte';
  import { sendMessage } from '../../messages';
  import { checkTinyFishKey, type TinyFishKeyCheck } from '../../session/checks/tinyfish';
  import { checkVeniceKey, type VeniceKeyCheck } from '../../session/checks/venice';
  import { normalizeApiKey, type KeyId, type KeyStatus, type Setup } from '../../settings';
  import { PROVIDER, TINYFISH_KEYS_URL } from './copy';

  let {
    status,
    onchange,
    which = 'venice',
    needed = true,
  }: {
    status: KeyStatus;
    onchange: (setup: Setup) => void;
    which?: KeyId;
    /** Listening needs this key in the current mode and search; otherwise it's only kept, and can be forgotten. */
    needed?: boolean;
  } = $props();

  /** Everything that differs between the two keys, in one place. */
  /** A key check's answer, as this page shows it. */
  interface Checked {
    works: boolean;
    /** Whether the key is kept (refused keys aren't). */
    save: boolean;
    message: string;
  }
  /** Refused keys aren't saved; any other answer keeps the key. */
  const saved = (status: string) => status !== 'rejected' && status !== 'not-permitted';

  interface KeyCopy {
    name: string;
    /** The form field's id, and the masked key's test id. */
    inputId: string;
    maskedTestId: string;
    /** Where the key is sent, as the note says. */
    sentTo: string;
    /** The free check, from this page, and what its answer means. */
    check: (fetchFn: typeof fetch, key: string) => Promise<Checked>;
    /** What listening can't do without it (after Forget key, when it is needed). */
    withoutIt: string;
    /** The same, said before Forget key is clicked. */
    forgetMeans: string;
    /** How to make the key at its service. */
    steps: Snippet;
  }

  const COPY: Record<KeyId, KeyCopy> = {
    venice: {
      name: PROVIDER.name,
      inputId: 'api-key',
      maskedTestId: 'masked-key',
      sentTo: PROVIDER.name,
      check: async (fetchFn, key) => {
        const result = await checkVeniceKey(fetchFn, key);
        return { works: result.status === 'works', save: saved(result.status), message: veniceMessage(result) };
      },      withoutIt: "ClaimCatcher can't listen until you add a key.",
      forgetMeans: "ClaimCatcher can't listen again until you add a key.",
      steps: veniceSteps,
    },
    tinyfish: {
      name: 'TinyFish',
      inputId: 'tinyfish-api-key',
      maskedTestId: 'masked-tinyfish-key',
      sentTo: "TinyFish's search",
      check: async (fetchFn, key) => {
        const result = await checkTinyFishKey(fetchFn, key);
        return { works: result.status === 'works', save: saved(result.status), message: tinyfishMessage(result) };
      },      withoutIt: "Local mode can't search at TinyFish until you add a key.",
      forgetMeans: "Local mode can't search at TinyFish until you add a key.",
      steps: tinyfishSteps,
    },
  };
  const copy = $derived(COPY[which]);
  const name = $derived(copy.name);
  const inputId = $derived(copy.inputId);

  function veniceMessage(result: VeniceKeyCheck): string {
    switch (result.status) {
      case 'works':
        return `The key works. ${result.balanceUsd === null ? '' : `Your ${PROVIDER.name} balance is ${money(result.balanceUsd)}. `}${expiry(result.expires)}`;
      case 'no-credit':
        return `${PROVIDER.name} accepted the key, but the account has no credit yet. The key is saved; add credit at ${PROVIDER.name} before you start listening. ${expiry(result.expires)}`;
      case 'not-permitted':
        return `${PROVIDER.name} accepted the key but won't let it run checks. Look at the key's settings at ${PROVIDER.name}, or create a new one. The key wasn't saved.`;
      case 'rejected':
        return `${PROVIDER.name} didn't accept this key. Check that you copied all of it, or create a new one. The key wasn't saved.`;
      case 'unchecked':
        return `ClaimCatcher couldn't reach ${PROVIDER.name} to check the key, so it's saved unchecked. If listening stops with a message about the key, check it here again.`;
    }
  }

  function tinyfishMessage(result: TinyFishKeyCheck): string {
    switch (result.status) {
      case 'works':
        return "The key works. TinyFish's search is free, up to 500 searches an hour.";
      case 'not-permitted':
        return "TinyFish accepted the key, but its search isn't available to this account. Look at the key at TinyFish, or create a new one. The key wasn't saved.";
      case 'rejected':
        return "TinyFish didn't accept this key. Check that you copied all of it, or create a new one. The key wasn't saved.";
      case 'unchecked':
        return "ClaimCatcher couldn't reach TinyFish to check the key, so it's saved unchecked. If listening stops with a message about the key, check it here again.";
    }
  }

  let key = $state('');
  let checking = $state(false);
  let error = $state('');
  let result = $state<Checked | null>(null);
  let forgotten = $state(false);

  async function check(event: SubmitEvent) {
    event.preventDefault();
    // Pasted keys often bring quotes or a `Bearer ` prefix. Never send an
    // empty key: Venice answers that with a payment challenge.
    const cleaned = normalizeApiKey(key);
    if (!cleaned) {
      error = 'Paste your key first.';
      return;
    }
    checking = true;
    error = '';
    result = null;
    forgotten = false;
    try {
      // Checked from this page, not the worker: a service is never called
      // from the service worker (a slow reply would outlive it).
      const fetchFn: typeof fetch = (input, init) => fetch(input, init);
      const check = await copy.check(fetchFn, cleaned);
      if (check.save) {
        onchange(await sendMessage({ to: 'background', type: 'save-api-key', key: cleaned, which }));
        key = '';
      }
      result = check;
    } catch {
      error = "The key couldn't be checked or saved. Try again.";
    } finally {
      checking = false;
    }
  }

  async function forget() {
    const setup = await sendMessage({ to: 'background', type: 'forget-api-key', which });
    result = null;
    forgotten = true;
    onchange(setup);
  }

  function day(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }

  function expiry(expires: string | null): string {
    return expires ? `It expires on ${day(expires)}.` : 'It has no expiry date.';
  }

  function money(usd: number): string {
    return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  const resultMessage = $derived(result?.message ?? '');
  /** What Forget key means for listening. */
  const forgetMeans = $derived(
    `Forget key removes the key from this browser. ${needed ? copy.forgetMeans : "ClaimCatcher doesn't use it in this mode."}`,
  );
  const resultOk = $derived(result?.works === true);
</script>

{#snippet tinyfishSteps()}
    <ol class="steps">
      <li>
        Sign in or sign up at TinyFish and open
        <a href={TINYFISH_KEYS_URL} target="_blank" rel="noopener noreferrer">API keys</a>. Search is free: no payment
        details are needed.
      </li>
      <li>Create a key and copy it. Paste it below.</li>
    </ol>
{/snippet}

{#snippet veniceSteps()}
  <ol class="steps">
    <li>
      Sign in at {PROVIDER.name} and open
      <a href={PROVIDER.keysUrl} target="_blank" rel="noopener noreferrer">API settings</a>. {PROVIDER.name} has no free tier, so
      add a little credit to the account first.
    </li>
    <li>
      Create a new key and choose <strong>Inference Only</strong> as its type. That kind of key can run checks, but it can't
      manage your account or make other keys.
    </li>
    <li>
      Set a <strong>spending limit</strong> ({PROVIDER.name} calls it the key's <code>consumptionLimit</code>). Checking costs about
      $1–2 per hour of video, so $5 covers a few hours. If the key ever leaks, the limit caps what it can cost. A lifetime
      limit is the firmest cap; a daily one starts again each day.
    </li>
    <li>
      If you like, set an <strong>expiry date</strong> (<code>expiresAt</code>), so the key stops working on its own.
    </li>
    <li>If {PROVIDER.name} offers it, allow the key private models only.</li>
    <li>Copy the key. {PROVIDER.name} shows it only once. Paste it below.</li>
  </ol>
{/snippet}

{#snippet form(label: string)}
  <form class="key" onsubmit={check}>
    <label for={inputId}>{name} API key</label>
    <div class="row">
      <input
        id={inputId}
        type="password"
        autocomplete="off"
        spellcheck="false"
        bind:value={key}
        aria-describedby={error ? `${inputId}-error` : undefined}
      />
      <button type="submit" class="primary" disabled={checking}>{checking ? 'Checking…' : label}</button>
    </div>
    {#if error}<p id="{inputId}-error" class="error" role="alert">{error}</p>{/if}
    <p class="note">
      The key is stored in this browser, unencrypted, and sent only to {copy.sentTo}. Checking it is
      free.
    </p>
  </form>
{/snippet}

{#if status.hasKey}
  <div class="current">
    <p>Your key: <span class="masked" data-testid={copy.maskedTestId}>{status.masked}</span></p>
    <button type="button" class="secondary" onclick={forget}>Forget key</button>
  </div>
  <p class="note">{forgetMeans}</p>
  <details>
    <summary>Use a different key</summary>
    {@render copy.steps()}
    {@render form('Check and save key')}
  </details>
{:else}
  {#if forgotten}
    <p class="result" role="status">
      The key is forgotten.{needed ? ` ${copy.withoutIt}` : ''}
    </p>
  {/if}
  {#if needed}
    {@render copy.steps()}
    {@render form('Check and save key')}
  {/if}
{/if}

{#if resultMessage}
  <p class="result" class:ok={resultOk} role="status">{resultMessage}</p>
{/if}

<style>
  .steps {
    margin: 0 0 16px;
    padding-left: 1.4em;
    display: grid;
    gap: 8px;
  }
  code {
    font-size: 0.9em;
    background: var(--frame);
    padding: 0 3px;
    border-radius: 3px;
  }
  .key {
    display: grid;
    gap: 6px;
  }
  label {
    font-weight: 700;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 6px 8px;
    border: 1px solid var(--ink-muted);
    border-radius: 6px;
  }
  button {
    font: inherit;
    font-weight: 700;
    padding: 6px 12px;
    border: 1px solid var(--ink);
    border-radius: 6px;
    cursor: pointer;
  }
  .primary {
    background: var(--ink);
    color: var(--surface);
  }
  .secondary {
    background: var(--surface);
    color: var(--ink);
  }
  .secondary:hover {
    background: var(--frame);
  }
  input:focus-visible,
  button:focus-visible,
  summary:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  a {
    color: var(--ink);
  }
  .error {
    margin: 0;
    color: var(--live);
  }
  .note {
    margin: 0;
    font-size: 0.9em;
    color: var(--ink-muted);
  }
  .current {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .current p {
    margin: 0;
  }
  .masked {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.05em;
  }
  details {
    margin-top: 12px;
  }
  summary {
    cursor: pointer;
    font-weight: 700;
    margin-bottom: 8px;
  }
  .result {
    margin: 12px 0 0;
    padding: 10px 12px;
    border: 1px solid var(--live);
    border-radius: 8px;
    background: var(--surface);
  }
  .result.ok {
    border-color: var(--ink);
  }
</style>
