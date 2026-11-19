<script lang="ts">
  // The cost and footprint footer (spec stories 81–82; the live-panel
  // prototype's `fp=footer`): the session's estimated energy, carbon and cost
  // as ranges, and, on a click, the breakdown above it. The only place the
  // estimate is shown. The numbers come from the pure estimator
  // (src/footprint); this only lays them out.
  import { COEFFICIENTS, coefficientEntries } from '../../footprint/coefficients';
  import { estimateFootprint } from '../../footprint/estimate';
  import { formatAmount, formatCost, formatRange } from '../../footprint/format';
  import { SEARCHES } from '../../session/searches';
  import type { SearchId, SessionCounters } from '../../session/types';
  import { PROVIDER } from '../welcome/copy';

  let {
    counters,
    startedAt,
    stoppedAt,
  }: {
    counters: SessionCounters;
    /** When listening started and (once stopped) ended, ms since epoch: the length of video to compare with. */
    startedAt: number;
    stoppedAt: number | null;
  } = $props();

  let open = $state(false);
  // The time now, for a session still listening: fresh when the breakdown opens, then every 15 s.
  let now = $state(Date.now());
  $effect(() => {
    if (!open || stoppedAt !== null) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(timer);
  });
  const listenedMinutes = $derived(Math.max(0, (stoppedAt ?? now) - startedAt) / 60_000);
  const f = $derived(estimateFootprint({ counters, listenedMinutes }));
  const energy = $derived(`${formatRange(f.energyWh)} Wh`);
  const carbon = $derived(`${formatRange(f.carbonG)} g`);
  const cost = $derived(formatCost(f.costCents));
  const minutes = $derived(f.streaming.minutes < 1 ? 'under a minute' : `${Math.round(f.streaming.minutes)} min`);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  // Each source once (the per-search energy figures share one).
  const sources = coefficientEntries()
    .map(([, entry]) => entry)
    .filter((entry, i, all) => all.findIndex((other) => (other.url ?? other.source) === (entry.url ?? entry.source)) === i);
  /** The searches that cost nothing, by name ("TinyFish"). */
  const freeSearches = (Object.keys(SEARCHES) as SearchId[])
    .filter((id) => COEFFICIENTS.searchPrice[id].high === 0)
    .map((id) => SEARCHES[id].name)
    .join(' and ');
</script>

<div class="footprint">
  {#if open}
    <section class="sheet" id="footprint-breakdown" aria-label="Cost and footprint of this session">
      <dl>
        <div class="row">
          <dt><span class="em" aria-hidden="true">⚡</span>Energy</dt>
          <dd>≈ {energy}</dd>
        </div>
        <div class="row">
          <dt><span class="em" aria-hidden="true">🌍</span>Carbon</dt>
          <dd>≈ {formatRange(f.carbonG)} g CO₂e</dd>
        </div>
        <div class="row">
          <dt><span class="em" aria-hidden="true">🪙</span>Cost on your API key</dt>
          <dd>≈ {cost}</dd>
        </div>
      </dl>
      <p class="compare">
        <span class="em" aria-hidden="true">📺</span>Streaming the same length of video ({minutes}) uses about {formatAmount(f.streaming.energyWh)} Wh.
      </p>
      <p class="counts">
        {plural(f.claims, 'claim', 'claims')} checked, {plural(f.searches, 'search', 'searches')}. Estimates, shown as ranges.
      </p>
      <details>
        <summary>How this is estimated</summary>
        <p>
          The cloud model's energy follows the EcoLogits method; work on this device is its time at a laptop's likely extra
          power draw. Carbon uses the US average grid, location-based, at {COEFFICIENTS.grid.low} g/kWh. {PROVIDER.name} publishes no
          energy figures of its own. Cost is what {PROVIDER.name}'s replies say they charged, plus each search at {PROVIDER.name}{freeSearches
            ? `; ${freeSearches} searches are free`
            : ''}.
        </p>
        <ul>
          {#each sources as entry (entry.source)}
            <li>
              <a href={entry.url} target="_blank" rel="noopener noreferrer">{entry.source}</a>
            </li>
          {/each}
        </ul>
      </details>
    </section>
  {/if}
  <button
    type="button"
    class="bar"
    aria-expanded={open}
    aria-controls="footprint-breakdown"
    title="This session's estimated footprint and cost"
    onclick={() => (open = !open)}
  >
    <span aria-hidden="true">⚡</span><span class="visually-hidden">Energy</span> <b>{energy}</b>
    <span class="dsep" aria-hidden="true">·</span>
    <span aria-hidden="true">🌍</span><span class="visually-hidden">Carbon</span> <b>{carbon}</b>
    <span class="dsep" aria-hidden="true">·</span>
    <span aria-hidden="true">🪙</span><span class="visually-hidden">Cost</span> <b>{cost}</b>
    <span class="sp"></span><span aria-hidden="true">{open ? '▾' : '▴'}</span>
  </button>
</div>

<style>
  .footprint {
    flex: none;
  }
  /* The prototype's footer: the panel's own ground, 42 px. */
  .bar {
    display: flex;
    gap: 7px;
    align-items: center;
    width: 100%;
    height: 42px;
    padding: 0 14px;
    border: 0;
    border-top: 1px solid var(--border);
    background: var(--frame);
    color: var(--ink-muted);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .bar:hover {
    background: #f1f1f1;
  }
  .bar:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  .bar b {
    color: var(--ink);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .dsep {
    color: #b5b5b5;
  }
  .sp {
    flex: 1;
  }
  .sheet {
    max-height: 60vh;
    overflow: auto;
    padding: 6px 14px 12px;
    border-top: 1px solid var(--border);
    background: var(--frame);
  }
  dl {
    margin: 0;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 0;
    border-bottom: 1px solid var(--rule);
    font-size: 13.5px;
  }
  dt {
    color: var(--ink-muted);
  }
  dd {
    margin: 0;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .em {
    margin-right: 7px;
  }
  .compare {
    margin: 10px 0 0;
    font-size: 13px;
  }
  .counts,
  details {
    margin: 10px 0 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  summary {
    cursor: pointer;
  }
  summary:focus-visible,
  details a:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  details p {
    margin: 6px 0;
  }
  details ul {
    margin: 0;
    padding-left: 18px;
  }
  details a {
    color: var(--ink-muted);
  }
</style>
