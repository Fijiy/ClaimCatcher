// The seams between the check pipeline and whoever runs the LLM and search.
// Cloud mode implements both with the provider (venice.ts). Local mode
// implements `JsonModel` with Gemini Nano (nano.ts) and `SearchProvider` with
// the search the viewer chose: TinyFish (tinyfish.ts) or the provider's. The
// pipeline stages only ever see these two interfaces.

import type { SearchId } from '../types';

/** A JSON Schema object, as sent to the provider (strict subset). */
export type JsonSchema = { readonly [key: string]: unknown };

/** One prompt to an LLM whose reply is constrained to `schema`. */
export interface JsonRequest {
  /** Names the schema; the provider sees it as `json_schema.name`. */
  name: string;
  system: string;
  user: string;
  schema: JsonSchema;
}

/** An LLM that answers one prompt with JSON matching the request's schema. */
export interface JsonModel {
  /**
   * The model runs on this device (local mode), so its prompts may carry page
   * context that must not leave it, such as the video's description. Absent
   * or false for a provider's model: only the title and channel go there.
   */
  readonly onDevice?: boolean;
  /** Resolves to the parsed JSON reply; rejects with a `ProviderError`. */
  generate(request: JsonRequest): Promise<unknown>;
}

/** One search result, already cleaned to plain text. */
export interface SearchResult {
  title: string;
  url: string;
  /** Without `www.`. */
  domain: string;
  /** Plain text: highlight tags removed and entities decoded. */
  snippet: string;
  /** The result's date if the search gave one; a hint only. */
  published: string | null;
}

/**
 * Outlets to keep a search to (the balancing search, balance.ts): Center ones
 * and ones from the other side, in the order to prefer them. Each search
 * aims at them its own way (operators, a domain filter, one at a time).
 */
export interface SiteFilter {
  center: string[];
  otherSide: string[];
}

/** Every outlet the filter aims at, Center ones first; none without a filter. */
export function sitesIn(filter: SiteFilter | undefined): string[] {
  return filter ? [...filter.center, ...filter.otherSide] : [];
}

export interface SearchOptions {
  sites?: SiteFilter;
}

export interface SearchProvider {
  /** Rejects with a `ProviderError`. */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

/**
 * What one answered call used, as its adapter reports it (for the footer's
 * counters). A call counts once the model or search has answered, even if the
 * answer turns out unusable: it was run, and billed.
 */
export type Usage =
  | {
      kind: 'llm';
      /** Gemini Nano on this device, or the provider's model. */
      onDevice: boolean;
      tokensIn: number;
      tokensOut: number;
      /** How long the model took to answer; reported for Nano, whose energy is estimated from it. */
      seconds?: number;
      /** What the provider billed for it, in USD, when the reply says; null otherwise (always for Nano). */
      costUsd: number | null;
    }
  /** One search request answered, by this search. */
  | { kind: 'search'; search: SearchId };

export type UsageListener = (usage: Usage) => void;

/**
 * Why a provider call failed:
 * - `key-rejected` (401) and `no-credit` (402) stop listening, and so does
 *   `search-key-rejected` (the chosen search refused its key: TinyFish's 401);
 * - `failed` is anything else (network, 5xx, 429, a malformed reply, a search
 *   that blocked the request) and is retried once.
 */
export type FailureKind = 'key-rejected' | 'no-credit' | 'search-key-rejected' | 'failed';

/** Who failed: the provider (over the network), the model on this device (Gemini Nano), or local mode's chosen search when it isn't the provider's (TinyFish). */
export type FailureSource = 'provider' | 'on-device' | 'search';

export class ProviderError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly source: FailureSource = 'provider',
    /**
     * What the viewer is told on the card ("This couldn't be checked: <why>."),
     * when the generic wording for `kind` would hide what happened, e.g.
     * "TinyFish's free searches are used up for now". No final full stop.
     */
    readonly why?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function failureKind(error: unknown): FailureKind {
  return error instanceof ProviderError ? error.kind : 'failed';
}

/**
 * The free check of a pasted key, as every service answers it; each service
 * adds its own (`VeniceKeyCheck`, `TinyFishKeyCheck`). `Works` is what a
 * working key reports, `Extra` any answer only that service gives.
 */
export type KeyCheck<Works extends object = object, Extra extends { status: string } = never> =
  /** The service accepts the key. */
  | ({ status: 'works' } & Works)
  /** The service accepts the key but won't let it do what ClaimCatcher needs. */
  | { status: 'not-permitted' }
  /** The service refused the key: mistyped, revoked or expired. */
  | { status: 'rejected' }
  /** The service couldn't be reached, or answered something unexpected. */
  | { status: 'unchecked'; reason: string }
  | Extra;
