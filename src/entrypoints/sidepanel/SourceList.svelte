<script lang="ts">
  // A verdict's sources: the count across the spectrum (L / LC / C / RC / R,
  // plus Primary), one row per piece of evidence (pill, title, real domain,
  // stance, reliability note, opened mark), then any partisan sources, marked
  // context only. A professional fact-check is highlighted ("PolitiFact rated
  // this…"). Links are already cleaned by the session; each opens in a new
  // tab with noopener and noreferrer, and gets the opened mark.
  // The card (#31 owns its design) includes this as a block.
  import type { Bias, ShownSource, SourceRating, Verdict } from '../../session/types';
  import { sourceLinks } from './source-links';

  let { verdict }: { verdict: Verdict } = $props();
  const links = sourceLinks();

  /** Left or middle click: both open the link in a new tab. */
  function onOpen(url: string) {
    return (event: MouseEvent) => {
      if (event.type === 'click' || event.button === 1) links.opened(url);
    };
  }

  const SPECTRUM: readonly Bias[] = ['L', 'LC', 'C', 'RC', 'R'];
  const BIAS_NAME: Record<Bias | 'pro-science', string> = {
    L: 'Left',
    LC: 'Left-center',
    C: 'Least biased (center)',
    RC: 'Right-center',
    R: 'Right',
    'pro-science': 'Pro-science',
  };
  const stanceText = { supports: 'supports', contradicts: 'contradicts', neither: "doesn't settle it" } as const;

  const context = $derived(verdict.context ?? []);
  const counts = $derived.by(() => {
    const byBias = new Map<Bias | 'primary', number>();
    for (const { rating } of verdict.sources) {
      const key = rating.kind === 'primary' ? 'primary' : rating.kind === 'mbfc' && rating.bias !== 'pro-science' ? rating.bias : null;
      if (key) byBias.set(key, (byBias.get(key) ?? 0) + 1);
    }
    return byBias;
  });
  const countLabel = $derived(
    `Sources by MBFC bias rating: ${SPECTRUM.map((b) => `${counts.get(b) ?? 0} ${BIAS_NAME[b]}`).join(', ')}; ${counts.get('primary') ?? 0} Primary`,
  );

  /** Why a source counts less, when it does. */
  function reliabilityNote(source: { rating: SourceRating; weight: string }): string | null {
    if (source.weight === 'full') return null;
    if (source.rating.kind === 'mbfc' && source.rating.reliability === 'mixed') return 'mixed reliability · counts less';
    if (source.rating.kind === 'mbfc' && source.rating.reliability === 'mostly factual') return 'mostly factual · counts less';
    return 'reliability not rated · counts less';
  }

  function pillTitle(rating: Extract<SourceRating, { kind: 'mbfc' }>): string {
    const reporting = rating.reliability ? `${rating.reliability.toUpperCase()} factual reporting` : 'no factual-reporting rating';
    return `MBFC: ${rating.name}, ${BIAS_NAME[rating.bias]} bias · ${reporting}.${rating.page ? ' Opens MBFC’s page.' : ''}`;
  }
</script>

{#snippet title(source: ShownSource)}
  <a class="title" href={source.url} target="_blank" rel="noopener noreferrer" onclick={onOpen(source.url)} onauxclick={onOpen(source.url)}
    >{source.title}</a
  >
{/snippet}

{#snippet openedMark(source: ShownSource)}
  {#if links.isOpened(source.url)}<span class="opened-mark">opened</span>{/if}
{/snippet}

{#snippet pill(source: ShownSource)}
  {@const rating = source.rating}
  {#if rating.kind === 'primary'}
    <span class="pill b-P" title="Primary source: counts in full">Primary</span>
  {:else if rating.kind === 'mbfc'}
    {@const code = rating.bias === 'pro-science' ? 'PS' : rating.bias}
    {#if rating.page}
      <a class="pill b-{code}" href={rating.page} target="_blank" rel="noopener noreferrer" title={pillTitle(rating)} aria-label={pillTitle(rating)}
        >{code}</a
      >
    {:else}
      <span class="pill b-{code}" title={pillTitle(rating)} aria-label={pillTitle(rating)}>{code}</span>
    {/if}
  {:else}
    <span class="pill b-U" title="Not rated by MBFC" aria-label="Not rated by MBFC">–</span>
  {/if}
{/snippet}

{#if verdict.sources.length > 0 || context.length > 0}
  <section class="sources" aria-label="Sources">
    <p class="head">
      <strong>Sources</strong>
      <span class="spectrum" role="img" aria-label={countLabel} title="Sources by MBFC bias rating, plus primary sources">
        {#each SPECTRUM as bias (bias)}
          <span class="b-{bias}" class:has={counts.has(bias)}>{bias} {counts.get(bias) ?? 0}</span>
        {/each}
        <span class="b-P" class:has={counts.has('primary')}>Primary {counts.get('primary') ?? 0}</span>
      </span>
    </p>
    {#if verdict.sources.length > 0}
      <ul aria-label="Evidence">
        {#each verdict.sources as source (source.n)}
          {@const note = reliabilityNote(source)}
          <li class="src" class:fact-check={source.factCheck} class:opened={links.isOpened(source.url)}>
            {@render pill(source)}
            {#if source.factCheck}
              <span class="fact-check-note" title="A professional fact-check found by the search. The label above is ClaimCatcher's own check."
                >{source.factCheck} rated this…</span
              >
            {/if}
            {@render title(source)}
            <span class="meta">
              <span class="domain">{source.domain}</span>
              <span class="stance" data-stance={source.stance}>{stanceText[source.stance]}</span>
              {#if note}<span class="note">{note}</span>{/if}
              {@render openedMark(source)}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if context.length > 0}
      <ul aria-label="Context only">
        {#each context as source (source.url)}
          <li class="src context" class:opened={links.isOpened(source.url)}>
            {@render pill(source)}
            {@render title(source)}
            <span class="meta">
              <span class="domain">{source.domain}</span>
              <span class="note">partisan · context only, not used for the verdict</span>
              {@render openedMark(source)}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .sources {
    margin: 8px 0 6px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin: 0 0 6px;
    font-size: 0.85em;
  }
  .spectrum {
    display: inline-flex;
    gap: 3px;
  }
  .spectrum > span {
    padding: 2px 5px;
    border-radius: 4px;
    font-weight: 700;
    font-size: 11px;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
    opacity: 0.3;
  }
  .spectrum > span.has {
    opacity: 1;
  }
  ul {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
  }
  .src {
    display: grid;
    grid-template-columns: 52px 1fr;
    column-gap: 8px;
    margin-bottom: 6px;
  }
  .pill {
    grid-row: span 2;
    align-self: start;
    padding: 3px 0;
    border-radius: 4px;
    font-weight: 700;
    font-size: 11px;
    line-height: 1;
    text-align: center;
    text-decoration: none;
  }
  a.pill:hover,
  a.pill:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  .title {
    color: var(--ink);
  }
  .meta {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
    font-size: 12px;
    color: var(--ink-muted);
  }
  .domain {
    font-weight: 700;
    color: var(--ink);
  }
  .stance[data-stance='contradicts'] {
    color: var(--ink);
  }
  .context .title {
    color: var(--ink-muted);
  }
  .opened .title {
    color: var(--ink-muted);
  }
  .opened-mark {
    font-style: italic;
  }
  /* A professional fact-check: highlighted, still one source among the others. */
  .fact-check {
    margin-left: -6px;
    padding: 4px 6px;
    border-left: 3px solid var(--ink);
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.04);
  }
  .fact-check .pill {
    grid-row: span 3;
  }
  .fact-check-note {
    grid-column: 2;
    font-size: 12px;
    font-weight: 700;
  }
  /* Bias pills: blue for left, red for right (spec "Frame and colour"). */
  .b-L {
    background: #1d4ed8;
    color: #fff;
  }
  .b-LC {
    background: #d7e3fd;
    color: #1e3a8a;
  }
  .b-C {
    background: #e9e7ef;
    color: #45435a;
  }
  .b-RC {
    background: #fcdcda;
    color: #9f1d1d;
  }
  .b-R {
    background: #b91c1c;
    color: #fff;
  }
  .b-P,
  .b-PS,
  .b-U {
    background: rgba(0, 0, 0, 0.07);
    color: var(--ink-muted);
  }
</style>
