<script lang="ts">
  // The first-run page (Chrome's in-extension consent), which stays available
  // as Privacy & data. Before the viewer agrees it shows what ClaimCatcher
  // hears, sends, keeps and never does, the choice of mode (local mode
  // preselected where Chrome can run Gemini Nano, with its download) and, for
  // local mode, of search (TinyFish or Venice), and an Agree
  // button; after that, the same information plus key setup, the mode and
  // search, granted permissions with revoke buttons, credits, and the one
  // mention of Take9. Switching mode or search shows the consent view again,
  // for the new destination: nothing goes there until the viewer agrees.
  import { onMount, tick } from 'svelte';
  import { browser } from 'wxt/browser';
  import { offersLocalMode } from '../../local-model';
  import { sendMessage } from '../../messages';
  import type { Mode, SearchId } from '../../session/types';
  import { missing, needsOf, type Setup } from '../../settings';
  import { DEFAULT_LOCAL_SEARCH, LOCAL_SEARCHES, SEARCHES, searchFor } from '../../session/searches';
  import { LocalModelWatch } from '../../ui/local-model.svelte';
  import LocalModelStatus from '../../ui/LocalModelStatus.svelte';
  import {
    MODES,
    PROVIDER,
    afterAgreeing,
    costFor,
    judgedBy,
    keyGoesFor,
    modeName,
    searchNeeds,
    sendsFor,
  } from './copy';
  import { LICENCES, creditLines } from '../../notices';
  import KeySetup from './KeySetup.svelte';
  import { onGrantsChanged, optionalGrants, revoke, type Grant } from './permissions';

  let setup = $state<Setup | null>(null);
  let grants = $state<Grant[]>([]);
  let agreeing = $state(false);
  const local = new LocalModelWatch();
  /** First run: the mode being chosen. Preselected once Chrome has said whether it can run Gemini Nano. */
  let chosen = $state<Mode | null>(null);
  /** The search local mode would use, being chosen (first run, or a switch to local mode). */
  let chosenSearch = $state<SearchId>(DEFAULT_LOCAL_SEARCH);
  /** Privacy & data: the mode the viewer asked to switch to, waiting for their agreement. */
  let switchingTo = $state<Mode | null>(null);
  /** Privacy & data, in local mode: the search the viewer asked to switch to, waiting for their agreement. */
  let switchingSearch = $state<SearchId | null>(null);

  async function refresh() {
    setup = await sendMessage({ to: 'background', type: 'get-setup' });
  }
  async function refreshGrants() {
    grants = await optionalGrants();
  }

  onMount(() => {
    void refresh().then(async () => {
      await tick();
      if (location.hash === '#key') document.getElementById('key')?.scrollIntoView();
    });
    void refreshGrants();
    const stopLocal = local.start();
    // Setup can change elsewhere too (the panel, another copy of this page).
    const onStorage = () => void refresh();
    browser.storage.local.onChanged.addListener(onStorage);
    const offGrants = onGrantsChanged(() => {
      void refreshGrants();
      void refresh();
    });
    return () => {
      browser.storage.local.onChanged.removeListener(onStorage);
      offGrants();
      stopLocal();
    };
  });

  // Local mode is the default wherever it can run.
  $effect(() => {
    if (chosen === null && local.model) chosen = offersLocalMode(local.model) ? 'local' : 'cloud';
  });

  const consent = $derived(setup?.consent ?? null);
  const consented = $derived(consent !== null);
  /** The consent view: first run, or a mode or search switch waiting for agreement. */
  const asking = $derived(!consented || switchingTo !== null || switchingSearch !== null);
  const localOffered = $derived(local.model !== null && offersLocalMode(local.model));
  /** The other mode, which Privacy & data offers to switch to. */
  const otherMode = $derived<Mode>(consent?.mode === 'local' ? 'cloud' : 'local');
  /** What the consent view is about: the mode and search the viewer would agree to. */
  const proposed = $derived.by((): { mode: Mode; search: SearchId } => {
    if (switchingSearch) return { mode: 'local', search: switchingSearch };
    const mode = switchingTo ?? (consented ? (consent?.mode ?? 'cloud') : (chosen ?? 'cloud'));
    const search = searchFor(mode, asking ? chosenSearch : (consent?.search ?? chosenSearch));
    return { mode, search };
  });
  /** Choosing a search: on first run with local mode picked, or switching to local mode. */
  const choosingSearch = $derived(asking && switchingSearch === null && proposed.mode === 'local');
  const needs = $derived(consent ? needsOf(consent) : null);
  const ready = $derived(
    consent !== null && setup !== null && missing(setup).length === 0 && (consent.mode === 'cloud' || local.model?.state === 'available'),
  );
  const title = $derived(
    !consented
      ? 'Before ClaimCatcher listens'
      : switchingTo
        ? `Before ClaimCatcher switches to ${modeName[switchingTo].toLowerCase()}`
        : switchingSearch
          ? `Before ClaimCatcher searches at ${SEARCHES[switchingSearch].name}`
          : 'Privacy & data',
  );

  async function agree() {
    const { mode, search } = proposed;
    if (!consented && !chosen) return;
    const switching = switchingTo !== null || switchingSearch !== null;
    agreeing = true;
    try {
      setup = await sendMessage({ to: 'background', type: 'give-consent', mode, search });
      switchingTo = null;
      switchingSearch = null;
      await tick();
      document.getElementById(switching ? (mode === 'local' ? 'search-heading' : 'mode-heading') : 'key-heading')?.focus();
    } finally {
      agreeing = false;
    }
  }

  /** A mode switch: show what the new mode sends, and wait for the viewer to agree. */
  async function askToSwitch(mode: Mode) {
    switchingTo = mode;
    if (mode === 'local') chosenSearch = consent?.mode === 'local' ? consent.search : DEFAULT_LOCAL_SEARCH;
    await tick();
    window.scrollTo(0, 0);
    document.querySelector('h1')?.focus();
  }

  /** A search switch in local mode: show where the new search sends the claims, and wait for the viewer to agree. */
  async function askToSearch(search: SearchId) {
    switchingSearch = search;
    await tick();
    window.scrollTo(0, 0);
    document.querySelector('h1')?.focus();
  }

  async function keepCurrent() {
    const wasSearch = switchingSearch !== null;
    switchingTo = null;
    switchingSearch = null;
    await tick();
    document.getElementById(wasSearch ? 'search-heading' : 'mode-heading')?.focus();
  }

  async function revokeGrant(grant: Grant) {
    await revoke(grant);
    await refreshGrants();
  }
</script>

{#snippet policyLink(search: SearchId)}
  <p class="note">
    <a href={SEARCHES[search].policyUrl} target="_blank" rel="noopener noreferrer">{SEARCHES[search].policy}</a>
  </p>
{/snippet}

{#snippet searchChoice()}
  <fieldset class="searches">
    <legend>Where local mode searches</legend>
    {#each LOCAL_SEARCHES as search (search)}
      <div class="search" data-search={search}>
        <label>
          <input type="radio" name="search" value={search} bind:group={chosenSearch} />
          <strong>{SEARCHES[search].name}</strong>
        </label>
        <p class="note">{searchNeeds[search]}</p>
      </div>
    {/each}
  </fieldset>
  {@render policyLink(chosenSearch)}
{/snippet}

<main>
  {#if setup}
    <header>
      <h1 tabindex="-1">{title}</h1>
      <p class="lede">
        ClaimCatcher listens to political video in a tab and checks the claims speakers make, with sources. Here is what that
        involves, in plain words.
      </p>
    </header>

    <section aria-labelledby="hears">
      <h2 id="hears">What it hears</h2>
      <p>
        This tab's audio, only while it's listening. Listening starts when you click the ClaimCatcher icon on the tab with the
        video, and stops when you press Stop, close the tab or go to another site.
      </p>
      <p>
        While it listens, the icon on that tab shows LIVE and the side panel says Listening. If you close the panel or go full
        screen, a small pill on the video says Listening, with Show panel and Stop.
      </p>
    </section>

    <section aria-labelledby="sends">
      <h2 id="sends">What it sends, and to whom</h2>
      {#if !consented}
        <fieldset class="modes">
          <legend>Choose where claims are judged</legend>
          {#each MODES as mode (mode)}
            <div class="mode" data-mode={mode}>
              <label>
                <input type="radio" name="mode" value={mode} bind:group={chosen} disabled={mode === 'local' && !localOffered} />
                <strong>{modeName[mode]}</strong>
              </label>
              <p>{sendsFor(mode, chosenSearch)}</p>
              <p>{judgedBy[mode]}</p>
              {#if mode === 'local'}
                <LocalModelStatus watch={local} />
                {#if chosen === 'local'}{@render searchChoice()}{/if}
              {/if}
            </div>
          {/each}
        </fieldset>
      {:else}
        <div class="mode" data-mode={proposed.mode}>
          <h3>{modeName[proposed.mode]}{proposed.mode === 'local' ? `, searching at ${SEARCHES[proposed.search].name}` : ''}</h3>
          <p>{sendsFor(proposed.mode, proposed.search)}</p>
          {#if proposed.mode === 'local'}{@render policyLink(proposed.search)}{/if}
          <p>{judgedBy[proposed.mode]}</p>
          {#if switchingTo === 'local'}<LocalModelStatus watch={local} />{/if}
          {#if choosingSearch}{@render searchChoice()}{/if}
          {#if switchingSearch}<p class="note">{searchNeeds[switchingSearch]}</p>{/if}
        </div>
      {/if}
      <p>
        {keyGoesFor(proposed.mode, proposed.search)} Nothing is sent to ClaimCatcher: there is no ClaimCatcher server.
      </p>
    </section>

    <section aria-labelledby="keeps">
      <h2 id="keeps">What it keeps</h2>
      <p>
        Nothing after the session, unless you save it. While a session lasts, its full transcript, claims and verdicts are kept
        in memory. Save session writes them to one file on this computer; nothing is uploaded.
      </p>
      <p>
        Your API keys are stored in this browser, unencrypted, until you forget them. Only ClaimCatcher's own pages can read
        them; scripts on the pages you watch can't.
      </p>
    </section>

    <section aria-labelledby="never">
      <h2 id="never">What it never does</h2>
      <p>No account and no tracking. There is no sign-in, no analytics and no ads, and no record of what you watch.</p>
    </section>

    <section aria-labelledby="cost">
      <h2 id="cost">What it costs</h2>
      <p>{costFor(proposed.mode, proposed.search)}</p>
    </section>

    {#if asking}
      <section class="agree" aria-labelledby="agree-heading">
        <h2 id="agree-heading">Your agreement</h2>
        {#if switchingTo && consent}
          <p>
            Until you agree, ClaimCatcher stays in {modeName[consent.mode].toLowerCase()}, and nothing goes where
            {modeName[switchingTo].toLowerCase()} sends it. If ClaimCatcher is listening when you agree, it stops; click the
            ClaimCatcher icon to listen in {modeName[switchingTo].toLowerCase()}.
          </p>
          <div class="actions">
            <button type="button" class="primary" onclick={agree} disabled={agreeing}>I agree</button>
            <button type="button" class="secondary" onclick={keepCurrent}>Keep {modeName[consent.mode].toLowerCase()}</button>
          </div>
        {:else if switchingSearch && consent}
          <p>
            Until you agree, local mode keeps searching at {SEARCHES[consent.search].name}, and nothing goes to
            {SEARCHES[switchingSearch].name}. If ClaimCatcher is listening when you agree, it stops; click the ClaimCatcher icon to
            listen with {SEARCHES[switchingSearch].name}.
          </p>
          <div class="actions">
            <button type="button" class="primary" onclick={agree} disabled={agreeing}>I agree</button>
            <button type="button" class="secondary" onclick={keepCurrent}>Keep {SEARCHES[consent.search].name}</button>
          </div>
        {:else}
          <p>Until you agree, ClaimCatcher doesn't listen to anything. {afterAgreeing(proposed.mode, proposed.search)}</p>
          <button type="button" class="primary" onclick={agree} disabled={agreeing || chosen === null}>I agree</button>
        {/if}
      </section>
    {:else if consent}
      {#if ready}
        <p class="ready" role="status">
          ClaimCatcher is ready. On the tab with the video, click the ClaimCatcher icon or press Alt+Shift+L.
        </p>
      {/if}

      {#if needs?.venice || setup.keys.venice.hasKey}
        <section id={needs?.venice ? 'key' : 'venice-key'} aria-labelledby={needs?.venice ? 'key-heading' : 'venice-key-heading'}>
          <h2 id={needs?.venice ? 'key-heading' : 'venice-key-heading'} tabindex="-1">Your {PROVIDER.name} API key</h2>
          {#if !needs?.venice}
            <p class="note">Local mode searching at {SEARCHES[consent.search].name} doesn't use it.</p>
          {/if}
          <KeySetup status={setup.keys.venice} needed={needs?.venice ?? true} onchange={(next) => (setup = next)} />
        </section>
      {/if}

      {#if needs?.tinyfish || setup.keys.tinyfish.hasKey}
        <section id={needs?.tinyfish ? 'key' : 'tinyfish-key'} aria-labelledby={needs?.tinyfish ? 'key-heading' : 'tinyfish-key-heading'}>
          <h2 id={needs?.tinyfish ? 'key-heading' : 'tinyfish-key-heading'} tabindex="-1">Your TinyFish API key</h2>
          {#if !needs?.tinyfish}<p class="note">ClaimCatcher doesn't use it unless local mode searches at TinyFish.</p>{/if}
          <KeySetup which="tinyfish" status={setup.keys.tinyfish} needed={needs?.tinyfish ?? false} onchange={(next) => (setup = next)} />
        </section>
      {/if}

      <section aria-labelledby="mode-heading">
        <h2 id="mode-heading" tabindex="-1">Mode</h2>
        <p><strong>{modeName[consent.mode]}.</strong> {judgedBy[consent.mode]}</p>
        {#if consent.mode === 'local' || !localOffered}<LocalModelStatus watch={local} />{/if}
        <div class="actions">
          <button
            type="button"
            class="secondary"
            onclick={() => askToSwitch(otherMode)}
            disabled={otherMode === 'local' && !localOffered}
          >
            Switch to {modeName[otherMode].toLowerCase()}
          </button>
        </div>
      </section>

      {#if consent.mode === 'local'}
        <section aria-labelledby="search-heading">
          <h2 id="search-heading" tabindex="-1">Search</h2>
          <p><strong>{SEARCHES[consent.search].name}.</strong> {searchNeeds[consent.search]}</p>
          <div class="actions">
            {#each LOCAL_SEARCHES.filter((other) => other !== consent.search) as other (other)}
              <button type="button" class="secondary" onclick={() => askToSearch(other)}>Search at {SEARCHES[other].name} instead</button>
            {/each}
          </div>
        </section>
      {/if}

      <section aria-labelledby="permissions-heading">
        <h2 id="permissions-heading">Permissions you've granted</h2>
        {#if grants.length === 0}
          <p>None beyond what ClaimCatcher was installed with. It asks for more only when a feature needs it.</p>
        {:else}
          <ul class="grants">
            {#each grants as grant (grant.id)}
              <li>
                <div>
                  <strong>{grant.label}</strong>
                  {#if grant.detail}<p class="note">{grant.detail}</p>{/if}
                </div>
                <button type="button" class="secondary" aria-label={`Revoke ${grant.label}`} onclick={() => revokeGrant(grant)}>
                  Revoke
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        <p class="note">
          The permissions ClaimCatcher was installed with (the side panel, storage, and access to the tab whose icon you click)
          come with it; removing ClaimCatcher removes them.
        </p>
      </section>

      <section aria-labelledby="credits-heading">
        <h2 id="credits-heading">Credits</h2>
        <!-- The same entries as THIRD-PARTY-NOTICES.md, from src/notices.ts. -->
        <ul class="credits">
          {#each creditLines() as line (line.credit)}
            <li>
              {line.credit}:
              {#each line.notices as notice, i (notice.name)}
                {#if i > 0}{'; '}{/if}<a href={notice.origin} target="_blank" rel="noopener"><strong>{notice.name}</strong></a>
                by {notice.by} (<span data-testid="licence:{notice.name}">{LICENCES[notice.licence].short}</span>){/each}.
            </li>
          {/each}
        </ul>
        <p class="note">
          Who made each one, its licence and where it came from:
          <a href="/THIRD-PARTY-NOTICES.txt" target="_blank">Third-party notices</a>.
        </p>
      </section>

      <section aria-labelledby="take9-heading">
        <h2 id="take9-heading">Why it works this way</h2>
        <p>
          ClaimCatcher was built for the Congressional App Challenge, whose Take9 pledge asks entrants to consider what data an
          app collects, how that data is protected, and how to reduce security risks. That is why it asks for permissions only
          when needed, keeps nothing after a session unless you save it, and has no server of its own.
        </p>
      </section>
    {/if}
  {/if}
</main>

<style>
  main {
    max-width: 44rem;
    margin: 0 auto;
    padding: 32px 20px 64px;
    line-height: 1.5;
  }
  h1 {
    font-size: 1.8rem;
    margin: 0 0 8px;
  }
  h2 {
    font-size: 1.2rem;
    margin: 0 0 8px;
  }
  h3 {
    font-size: 1rem;
    margin: 0 0 4px;
  }
  h2:focus {
    outline: none;
  }
  .lede {
    margin: 0 0 24px;
    color: var(--ink-muted);
  }
  section {
    padding: 16px 20px;
    margin: 0 0 12px;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 10px;
  }
  section p {
    margin: 0 0 8px;
  }
  section p:last-child {
    margin-bottom: 0;
  }
  .mode {
    margin: 0 0 8px;
  }
  .modes {
    margin: 0 0 12px;
    padding: 0;
    border: 0;
    display: grid;
    gap: 12px;
  }
  .modes legend {
    padding: 0;
    margin: 0 0 8px;
    font-weight: 700;
  }
  .modes .mode {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--rule);
    border-radius: 8px;
  }
  .modes .mode:has(input:checked) {
    border-color: var(--ink);
  }
  .modes label {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 6px;
    cursor: pointer;
  }
  .searches {
    margin: 12px 0 0;
    padding: 10px 12px;
    border: 1px solid var(--rule);
    border-radius: 8px;
    display: grid;
    gap: 8px;
  }
  .searches legend {
    padding: 0 4px;
    font-weight: 700;
  }
  .searches label {
    margin: 0 0 2px;
  }
  .modes input:disabled + strong {
    color: var(--ink-muted);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  h1:focus {
    outline: none;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .agree {
    border-color: var(--ink);
  }
  .ready {
    padding: 12px 16px;
    margin: 0 0 12px;
    background: var(--surface);
    border: 1px solid var(--ink);
    border-radius: 10px;
    font-weight: 700;
  }
  button {
    font: inherit;
    font-weight: 700;
    padding: 8px 16px;
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
    padding: 6px 12px;
  }
  .secondary:hover {
    background: var(--frame);
  }
  button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .grants,
  .credits {
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 8px;
  }
  .grants li {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .credits li {
    padding-left: 1em;
    text-indent: -1em;
  }
  .credits a,
  .note a {
    color: var(--ink);
  }
  .credits a:focus-visible,
  .note a:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .credits li::before {
    content: '· ';
  }
  .note {
    font-size: 0.9em;
    color: var(--ink-muted);
  }
</style>
