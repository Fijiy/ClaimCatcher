// Cloud mode's provider: Venice (see cac-notes external-venice.md). Chat
// completions with a strict JSON schema for the LLM steps, and its private
// search. The key goes in the Authorization header of requests to the
// provider's own origin, and nowhere else.

import {
  ProviderError,
  sitesIn,
  type KeyCheck,
  type JsonModel,
  type JsonRequest,
  type SearchOptions,
  type SearchProvider,
  type SearchResult,
  type SiteFilter,
  type UsageListener,
} from './provider';
import { domainOf, plainText } from './result-text';

export const PROVIDER_ORIGIN = 'https://api.venice.ai';
const API = `${PROVIDER_ORIGIN}/api/v1`;

/**
 * Cloud mode's model. Still provisional: a `private` (no retention),
 * non-reasoning model that supports response schemas, picked from Venice's
 * docs, not measured. The cloud run of the verdict gate (`pnpm eval:cloud`,
 * docs/quality-gate.md) picks the model that clears the bar; that needs the
 * entrant's API key and hasn't been run yet. Set its pick here and record the
 * run in docs/quality-gate.md.
 */
export const PROVISIONAL_MODEL = 'qwen3-235b-a22b-instruct-2507';

/** Search results asked for per query; later stages drop some, then keep 5 in all. */
const RESULTS_PER_QUERY = 10;
/** A request that hasn't answered by then counts as failed (and is retried once). */
const TIMEOUT_MS = 60_000;

export interface Venice {
  model: JsonModel;
  search: SearchProvider;
}

export interface VeniceOptions {
  /** Told of every answered chat and search request: tokens, and the price the reply gives (`cost.usd`). */
  onUsage?: UsageListener;
}

export function createVenice(fetchFn: typeof fetch, apiKey: string, model = PROVISIONAL_MODEL, options: VeniceOptions = {}): Venice {
  const onUsage = options.onUsage ?? (() => {});
  async function post(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchFn(`${API}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ProviderError('failed', `request to ${path} failed: ${String(error)}`);
    }
    // Branch on status first (Venice docs). A 401 can also mean a paid-plan-only
    // model; either way this key can't be used as is.
    if (response.status === 401) throw new ProviderError('key-rejected', (await errorOf(response)).message);
    if (response.status === 402) {
      // A missing or malformed key gets a 402 payment challenge (`x402Version`
      // in the body), which is a rejected key, not an empty balance.
      const error = await errorOf(response);
      throw new ProviderError(error.paymentChallenge ? 'key-rejected' : 'no-credit', error.message);
    }
    if (!response.ok) throw new ProviderError('failed', `${path} answered ${response.status}: ${(await errorOf(response)).message}`);
    try {
      return await response.json();
    } catch {
      throw new ProviderError('failed', `${path} answered with something that isn't JSON`);
    }
  }

  return {
    model: {
      async generate(request: JsonRequest) {
        const reply = (await post('/chat/completions', {
          model,
          temperature: 0.1,
          max_tokens: 2_000,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: request.name, strict: true, schema: request.schema },
          },
          venice_parameters: {
            // Venice adds its own system prompt unless told not to.
            include_venice_system_prompt: false,
            // ClaimCatcher searches on its own; the model gets no web access.
            enable_web_search: 'off',
            enable_web_citations: false,
            enable_web_scraping: false,
          },
        })) as ChatReply;
        // Answered, so run and billed, whatever the reply turns out to hold.
        onUsage({
          kind: 'llm',
          onDevice: false,
          tokensIn: count(reply?.usage?.prompt_tokens),
          tokensOut: count(reply?.usage?.completion_tokens),
          costUsd: priceOf(reply?.cost),
        });
        const choice = reply?.choices?.[0];
        if (choice?.finish_reason === 'length') throw new ProviderError('failed', 'the reply was cut off');
        const content = choice?.message?.content;
        if (typeof content !== 'string') throw new ProviderError('failed', 'the reply had no content');
        try {
          return JSON.parse(content) as unknown;
        } catch {
          throw new ProviderError('failed', 'the reply was not valid JSON');
        }
      },
    },
    search: {
      async search(query: string, options: SearchOptions = {}) {
        const reply = (await post('/augment/search', {
          query: withSites(query.slice(0, 400), options.sites),
          limit: RESULTS_PER_QUERY,
          search_provider: 'brave',
        })) as SearchReply;
        onUsage({ kind: 'search', search: 'venice' });
        if (!Array.isArray(reply?.results)) throw new ProviderError('failed', 'search answered without results');
        return reply.results.flatMap((r): SearchResult[] => {
          const domain = domainOf(r.url);
          if (!domain || typeof r.title !== 'string') return [];
          return [
            {
              title: plainText(r.title),
              url: r.url,
              domain,
              snippet: plainText(typeof r.content === 'string' ? r.content : ''),
              published: typeof r.date === 'string' && r.date ? r.date : null,
            },
          ];
        });
      },
    },
  };
}

interface ChatReply {
  choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  /** What the request was charged (Venice adds it to every chat reply). */
  cost?: { usd?: unknown; diem?: unknown };
}

/** A token count from the reply; 0 if it gives none. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The reply's charge in USD. A key spending DIEM (1 DIEM = $1 a day of
 * compute) may be charged in DIEM with `usd` 0, so that counts as dollars
 * then. Null when the reply gives no price.
 */
function priceOf(cost: ChatReply['cost']): number | null {
  const usd = typeof cost?.usd === 'number' && Number.isFinite(cost.usd) ? Math.max(0, cost.usd) : null;
  const diem = typeof cost?.diem === 'number' && Number.isFinite(cost.diem) ? Math.max(0, cost.diem) : null;
  if (usd === null && diem === null) return null;
  return usd || diem || 0;
}

/** Brave's operators, which Venice's search passes through: `query (site:a OR site:b …)`. */
function withSites(query: string, sites: SiteFilter | undefined): string {
  const all = sitesIn(sites);
  return all.length === 0 ? query : `${query} (${all.map((domain) => `site:${domain}`).join(' OR ')})`;
}

interface SearchReply {
  results?: Array<{ title?: unknown; url: string; content?: unknown; date?: unknown }>;
}

async function errorOf(response: Response): Promise<{ message: string; paymentChallenge: boolean }> {
  try {
    const body = (await response.json()) as { error?: unknown; x402Version?: unknown };
    const error = body?.error;
    const paymentChallenge = body?.x402Version !== undefined;
    if (typeof error === 'string') return { message: error, paymentChallenge };
    if (error && typeof error === 'object' && 'message' in error) return { message: String(error.message), paymentChallenge };
    return { message: `HTTP ${response.status}`, paymentChallenge };
  } catch {
    return { message: `HTTP ${response.status}`, paymentChallenge: false };
  }
}

// ---- The key check (spec story 11) -------------------------------------------

/** What checking a pasted key found, as the viewer is told it. */
/**
 * Venice's key check. A working key reports the account's USD balance (if
 * Venice says) and expiry; a key on an account with no credit is accepted but
 * checks would fail. `not-permitted`: it won't let the key run models.
 */
export type VeniceKeyCheck = KeyCheck<{ balanceUsd: number | null; expires: string | null }, { status: 'no-credit'; expires: string | null }>;

interface RateLimitsReply {
  data?: {
    accessPermitted?: unknown;
    balances?: Record<string, unknown>;
    keyExpiration?: unknown;
  };
}

/**
 * Checks a key with Venice's free `GET /api_keys/rate_limits` (it costs
 * nothing and works for inference-only keys), and reports what it found.
 */
export async function checkVeniceKey(fetchFn: typeof fetch, apiKey: string): Promise<VeniceKeyCheck> {
  let response: Response;
  try {
    response = await fetchFn(`${API}/api_keys/rate_limits`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { status: 'unchecked', reason: String(error) };
  }
  // Same reading of the status as the checks themselves (createVenice above).
  if (response.status === 401) return { status: 'rejected' };
  if (response.status === 402) return (await errorOf(response)).paymentChallenge ? { status: 'rejected' } : { status: 'no-credit', expires: null };
  if (response.status === 403) return { status: 'not-permitted' };
  if (!response.ok) return { status: 'unchecked', reason: `Venice answered ${response.status}: ${(await errorOf(response)).message}` };
  let data: RateLimitsReply['data'];
  try {
    data = ((await response.json()) as RateLimitsReply).data;
  } catch {
    data = undefined;
  }
  if (!data) return { status: 'unchecked', reason: 'Venice answered with something unexpected' };
  if (data.accessPermitted === false) return { status: 'not-permitted' };
  const expires = typeof data.keyExpiration === 'string' && data.keyExpiration ? data.keyExpiration : null;
  const balances = Object.values(data.balances ?? {}).filter((v): v is number => typeof v === 'number');
  if (balances.length > 0 && balances.every((v) => v <= 0)) return { status: 'no-credit', expires };
  const usd = data.balances?.USD;
  return { status: 'works', balanceUsd: typeof usd === 'number' ? usd : null, expires };
}
