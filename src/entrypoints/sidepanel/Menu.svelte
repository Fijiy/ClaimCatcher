<script lang="ts" module>
  /** One entry in the ⋯ menu. Add an item by adding one of these to the list. */
  export interface MenuItem {
    label: string;
    onselect: () => void;
    disabled?: boolean;
  }
</script>

<script lang="ts">
  // The panel's ⋯ menu: a button that opens a list of actions. It knows
  // nothing about the actions; App.svelte passes them in as `items`.
  import { tick } from 'svelte';

  let { items, label = 'More' }: { items: MenuItem[]; label?: string } = $props();
  let open = $state(false);
  let button: HTMLButtonElement;
  let list = $state<HTMLElement>();

  async function toggle() {
    open = !open;
    if (open) {
      await tick();
      entries()[0]?.focus();
    }
  }

  function close(returnFocus = true) {
    open = false;
    if (returnFocus) button.focus();
  }

  function entries(): HTMLButtonElement[] {
    return [...(list?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  }

  function choose(item: MenuItem) {
    close();
    item.onselect();
  }

  function onkeydown(event: KeyboardEvent) {
    const all = entries();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    };
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else if (event.key === 'Tab') close(false);
  }

  function onpointerdown(event: PointerEvent) {
    if (!open) return;
    const target = event.target as Node;
    if (!list?.contains(target) && !button.contains(target)) close(false);
  }
</script>

<svelte:document {onpointerdown} />

<div class="wrap">
  <button
    bind:this={button}
    type="button"
    class="icon"
    aria-label={label}
    title={label}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={toggle}>⋯</button
  >
  {#if open}
    <div bind:this={list} class="menu" role="menu" aria-label={label} tabindex="-1" {onkeydown}>
      {#each items as item (item.label)}
        <button type="button" role="menuitem" disabled={item.disabled} onclick={() => choose(item)}>{item.label}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  .icon {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--ink-muted);
    font: inherit;
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
  }
  .icon:hover,
  .icon[aria-expanded='true'] {
    background: var(--frame);
    color: var(--ink);
  }
  .icon:focus-visible,
  .menu button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 10;
    min-width: 190px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 10%);
  }
  .menu button {
    display: block;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover:not(:disabled) {
    background: var(--frame);
  }
  .menu button:disabled {
    color: var(--ink-muted);
    cursor: default;
  }
</style>
