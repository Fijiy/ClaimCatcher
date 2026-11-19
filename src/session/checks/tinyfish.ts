// Local mode's TinyFish search (ticket #45): TinyFish's search API, free with
// a free key (30 searches a minute, 500 an hour; https://www.tinyfish.ai/pricing),
// documented at https://docs.tinyfish.ai/search-api/reference. Its CORS
// answers `*` and allows `X-API-Key`, so the offscreen document calls it
// without a host permission. The key goes in the `X-API-Key` header of
// requests to TinyFish's search API, and nowhere else.

import { ProviderError, sitesIn, type KeyCheck, type SearchOptions, type SearchProvider, type SearchResult, type UsageListener } from './provider';
import { domainOf, plainText } from './result-text';

export const TINYFISH_ORIGIN = 'https://api.search.tinyfish.ai';
const NAME = 'TinyFish';
/** A request that hasn't answered by then counts as failed (and is retried once). */
const TIMEOUT_MS = 30_000;

export interface TinyFishOptions {
  /** Told of every answered search. */
  onUsage?: UsageListener;
}

export function createTinyFishSearch(fetchFn: typeof fetch, apiKey: string, options: TinyFishOptions = {}): SearchProvider {
  const onUsage = options.onUsage ?? (() => {});
  return {
    async search(query: string, { sites }: SearchOptions = {}) {
      const params = new URLSearchParams({ query: query.slice(0, 400), location: 'US', language: 'en' });
      // TinyFish's own domain filter (its docs deprecate `site:` for this).
      const domains = sitesIn(sites);
      if (domains.length > 0) params.set('include_domains', domains.join(','));
      const response = await get(fetchFn, `${TINYFISH_ORIGIN}/?${params}`, apiKey);
      if (response.status === 401) throw new ProviderError('search-key-rejected', `${NAME} refused the key: ${await errorOf(response)}`, 'search');
      if (response.status === 402) {
        throw new ProviderError('failed', `${NAME} answered 402: ${await errorOf(response)}`, 'search', `${NAME}'s free searches are used up for now`);
      }
      if (response.status === 429) {
        throw new ProviderError('failed', `${NAME} answered 429: ${await errorOf(response)}`, 'search', `${NAME}'s limit of searches a minute was reached`);
      }
      if (!response.ok) {
        throw new ProviderError('failed', `${NAME} answered ${response.status}: ${await errorOf(response)}`, 'search', `${NAME}'s search did not answer`);
      }
      let reply: SearchReply;
      try {
        reply = (await response.json()) as SearchReply;
      } catch {
        throw new ProviderError('failed', `${NAME} answered with something that isn't JSON`, 'search', `${NAME}'s search did not answer`);
      }
      onUsage({ kind: 'search', search: 'tinyfish' });
      if (!Array.isArray(reply?.results)) throw new ProviderError('failed', `${NAME} answered without results`, 'search', `${NAME}'s search did not answer`);
      return reply.results.flatMap((r): SearchResult[] => {
        const domain = domainOf(r?.url);
        if (!domain || typeof r.title !== 'string') return [];
        return [
          {
            title: plainText(r.title),
            url: r.url as string,
            domain,
            snippet: plainText(typeof r.snippet === 'string' ? r.snippet : ''),
            published: typeof r.date === 'string' && r.date ? r.date : null,
          },
        ];
      });
    },
  };
}

interface SearchReply {
  results?: Array<{ title?: unknown; url?: unknown; snippet?: unknown; date?: unknown }>;
}

async function get(fetchFn: typeof fetch, url: string, apiKey: string): Promise<Response> {
  try {
    return await fetchFn(url, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProviderError('failed', `${NAME} couldn't be reached: ${String(error)}`, 'search', `${NAME}'s search couldn't be reached`);
  }
}

/** TinyFish's error body: `{"error":{"code","message"}}`. */
async function errorOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    const { code, message } = body?.error ?? {};
    return [code, message].filter((part) => typeof part === 'string' && part).join(': ') || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/**
 * Checks a TinyFish key with `GET /usage?limit=1`, which lists the key's past
 * searches instead of running one: a 200 means the key works. TinyFish has
 * no balance (search is free), so none is reported.
 */
/** TinyFish's key check: search is free, so a working key reports no balance, and there is no "no credit". */
export type TinyFishKeyCheck = KeyCheck;

export async function checkTinyFishKey(fetchFn: typeof fetch, apiKey: string): Promise<TinyFishKeyCheck> {
  let response: Response;
  try {
    response = await get(fetchFn, `${TINYFISH_ORIGIN}/usage?limit=1`, apiKey);
  } catch (error) {
    return { status: 'unchecked', reason: error instanceof Error ? error.message : String(error) };
  }
  if (response.status === 401) return { status: 'rejected' };
  // 403: forbidden; 404: the search API isn't available to this account.
  if (response.status === 403 || response.status === 404) return { status: 'not-permitted' };
  if (!response.ok) return { status: 'unchecked', reason: `${NAME} answered ${response.status}: ${await errorOf(response)}` };
  return { status: 'works' };
}
