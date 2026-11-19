<script lang="ts">
  // Local mode's model, as the viewer sees it: why local mode can't run here,
  // or the one-click Gemini Nano download with its progress, or that it's ready.
  // Shared by the first-run page / Privacy & data and the side panel.
  import { LOCAL_MODEL_TEXT } from '../local-model';
  import type { LocalModelWatch } from './local-model.svelte';

  let { watch }: { watch: LocalModelWatch } = $props();

  const model = $derived(watch.model);
  const percent = $derived(watch.progress === null ? null : Math.round(watch.progress * 100));
</script>

{#if model}
  <div class="local-model" data-state={model.state}>
    {#if model.state === 'not-chrome'}
      <p class="why">{LOCAL_MODEL_TEXT.notChrome}</p>
    {:else if model.state === 'unavailable'}
      <p class="why">{LOCAL_MODEL_TEXT.unavailable}</p>
    {:else if model.state === 'downloadable'}
      <p>
        Local mode needs Gemini Nano on this device first. Chrome downloads it once, from Google (several gigabytes).
        Listening in local mode can start when it has finished.
      </p>
      {#if watch.error}
        <p class="why" role="alert">The download didn't finish: {watch.error} Try again.</p>
      {/if}
      <button type="button" class="download" onclick={() => watch.download()}>Download Gemini Nano</button>
    {:else if model.state === 'downloading'}
      {#if percent !== null}
        <label class="progress">
          <span>Downloading Gemini Nano: {percent}%</span>
          <progress max="1" value={watch.progress}></progress>
        </label>
      {:else}
        <label class="progress">
          <span>Chrome is downloading Gemini Nano.</span>
          <progress></progress>
        </label>
      {/if}
      <p class="note">Listening in local mode can start when the download has finished. It goes on if you close this page.</p>
    {:else}
      <p role="status">Gemini Nano is ready on this device.</p>
    {/if}
  </div>
{/if}

<style>
  .local-model p {
    margin: 0 0 8px;
  }
  .local-model p:last-child {
    margin-bottom: 0;
  }
  .why {
    color: var(--ink-muted);
  }
  .progress {
    display: grid;
    gap: 4px;
    margin: 0 0 8px;
    font-weight: 700;
  }
  progress {
    width: 100%;
    accent-color: var(--ink);
  }
  .note {
    font-size: 0.9em;
    color: var(--ink-muted);
  }
  .download {
    font: inherit;
    font-weight: 700;
    padding: 6px 14px;
    border: 1px solid var(--ink);
    border-radius: 6px;
    background: var(--ink);
    color: var(--surface);
    cursor: pointer;
  }
  .download:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
</style>
