<script lang="ts" module>
  export type PanelView = 'claims' | 'transcript';
</script>

<script lang="ts">
  // The Claims / Full transcript switch, with how busy the checks are
  // ("6 checked · 1 checking").
  import type { Card } from '../../session/types';

  let { view = $bindable(), cards }: { view: PanelView; cards: Card[] } = $props();

  const checking = $derived(cards.filter((c) => c.check.state === 'checking').length);
  const checked = $derived(cards.length - checking);
  const options: Array<{ id: PanelView; label: string }> = [
    { id: 'claims', label: 'Claims' },
    { id: 'transcript', label: 'Full transcript' },
  ];
</script>

<div class="switch">
  <div class="seg" role="group" aria-label="Show">
    {#each options as option (option.id)}
      <button type="button" aria-pressed={view === option.id} onclick={() => (view = option.id)}>{option.label}</button>
    {/each}
  </div>
  <p class="counts" aria-live="polite">{checked} checked{checking > 0 ? ` · ${checking} checking` : ''}</p>
</div>

<style>
  .switch {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: var(--surface);
    border-bottom: 1px solid var(--rule);
  }
  .seg {
    display: inline-flex;
    padding: 2px;
    border-radius: 6px;
    background: var(--frame);
    border: 1px solid var(--rule);
  }
  button {
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    padding: 4px 10px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ink-muted);
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 0 0 1px var(--rule);
  }
  button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  .counts {
    margin: 0 0 0 auto;
    font-size: 12px;
    color: var(--ink-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
