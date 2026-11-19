// A fake `fetch` for local mode's TinyFish search, for session tests:
// TinyFish's search API (JSON, `X-API-Key`). It records every request as it
// left the device. `network()` joins it with the fake provider
// (fake-venice.ts) into the one `fetch` a session gets, and records every request whatever its destination, so a
// test can check that nothing went anywhere else.

import { isFailure, type Failure, type SentRequest } from './fake-venice';

type Answer<T> = T | Failure | Promise<T | Failure>;

/** One result as TinyFish's search API gives it. */
export interface TinyFishResult {
  title: string;
  url: string;
  snippet: string;
  site_name?: string;
  date?: string;
}

export interface FakeTinyFish {
  fetch: typeof fetch;
  requests: SentRequest[];
  /** Answers searches by query; the request's other parameters (`include_domains`…) come too. Unanswered queries find nothing. */
  onSearch(answer: (query: string, params: URLSearchParams) => Answer<TinyFishResult[]>): void;
  /** Answers the key check (`GET /usage`). Defaults to a working key. */
  onKeyCheck(answer: (key: string) => Answer<'ok'>): void;
}

/** TinyFish's error body (checked against the live API: `{"error":{"code","message"},"request_id"}`). */
const TINYFISH_ERRORS: Record<number, { code: string; message: string }> = {
  401: { code: 'INVALID_API_KEY', message: 'Invalid or expired API key' },
  402: { code: 'FREE_ALLOWANCE_EXHAUSTED', message: 'Free allowance exhausted' },
  429: { code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded' },
};

export function createFakeTinyFish(): FakeTinyFish {
  const requests: SentRequest[] = [];
  let search: (query: string, params: URLSearchParams) => Answer<TinyFishResult[]> = () => [];
  let keyCheck: (key: string) => Answer<'ok'> = () => 'ok';
  const json = (status: number, value: unknown) =>
    new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const error = (failure: Failure) =>
    json(failure.status, { error: TINYFISH_ERRORS[failure.status] ?? { code: 'INTERNAL_ERROR', message: failure.error ?? 'failed' }, request_id: 'r' });

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const sent = record(requests, input, init);
    await Promise.resolve();
    const url = new URL(sent.url);
    const key = sent.headers['x-api-key'] ?? '';
    if (url.pathname === '/usage') {
      const answer = await keyCheck(key);
      return isFailure(answer) ? error(answer) : json(200, { items: [], total: 0, limit: 1, page: 1, total_pages: 0, has_more: false });
    }
    if (url.pathname === '/' || url.pathname === '') {
      const query = url.searchParams.get('query') ?? '';
      const answer = await search(query, url.searchParams);
      if (isFailure(answer)) return error(answer);
      return json(200, {
        query,
        results: answer.map((r, i) => ({ position: i + 1, site_name: new URL(r.url).hostname, ...r })),
        total_results: answer.length,
        page: 0,
      });
    }
    return error({ status: 404 });
  };

  return {
    fetch: fakeFetch as typeof fetch,
    requests,
    onSearch: (answer) => void (search = answer),
    onKeyCheck: (answer) => void (keyCheck = answer),
  };
}

export interface FakeNetwork {
  fetch: typeof fetch;
  /** Every request the session made, to any destination, in order. */
  requests: SentRequest[];
}

/**
 * One `fetch` that hands each request to the fake for its origin. A request to
 * any other origin is recorded and refused.
 */
export function network(byOrigin: Record<string, { fetch: typeof fetch }>): FakeNetwork {
  const requests: SentRequest[] = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const sent = record(requests, input, init);
    const fake = byOrigin[new URL(sent.url).origin];
    if (!fake) throw new TypeError(`Failed to fetch ${sent.url}`);
    return fake.fetch(input, init);
  };
  return { fetch: fakeFetch as typeof fetch, requests };
}

function record(requests: SentRequest[], input: RequestInfo | URL, init?: RequestInit): SentRequest {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const text = typeof init?.body === 'string' ? init.body : '';
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
  const sent: SentRequest = { url, method: init?.method ?? 'GET', headers, body: text ? safeJson(text) : undefined, text };
  requests.push(sent);
  return sent;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
