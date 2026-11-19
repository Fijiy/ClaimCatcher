// How a card's source links reach the session: the panel provides this once
// (App.svelte), and SourceList.svelte uses it for the "opened" mark. Without a
// provider (a card rendered on its own) links still open; nothing is marked.

import { getContext, setContext } from 'svelte';

export interface SourceLinks {
  isOpened(url: string): boolean;
  /** Called when the viewer opens a source's link. */
  opened(url: string): void;
}

const KEY = Symbol('source-links');
const NONE: SourceLinks = { isOpened: () => false, opened: () => {} };

export function provideSourceLinks(links: SourceLinks) {
  setContext(KEY, links);
}

export function sourceLinks(): SourceLinks {
  return getContext<SourceLinks | undefined>(KEY) ?? NONE;
}
