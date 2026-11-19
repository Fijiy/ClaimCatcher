// A fake `fetch` that plays the provider (Venice) for session tests. It speaks
// the provider's wire format: chat completions answered from the request's
// JSON-schema name, `/augment/search` answered by query, and the free key
// check (`/api_keys/rate_limits`). Every request is
// recorded as it left the device, so tests can check what was sent and where.

export interface SentRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The parsed JSON body. */
  body: unknown;
  /** The raw body text, for "this never left the device" checks. */
  text: string;
}

/** What a chat request asked: its system and user messages. */
export interface Asked {
  system: string;
  user: string;
}

export interface FakeSearchResult {
  title: string;
  url: string;
  content: string;
  date?: string;
}

/** A canned failure: an HTTP status with the provider's error body. */
export interface Failure {
  status: number;
  error?: string;
}

type Answer<T> = T | Failure | Promise<T | Failure>;

export interface FakeVenice {
  fetch: typeof fetch;
  requests: SentRequest[];
  /** Answers claim-breakdown requests. */
  onBreakdown(answer: (asked: Asked) => Answer<unknown>): void;
  /** Answers verdict requests. */
  onVerdict(answer: (asked: Asked) => Answer<unknown>): void;
  /** Answers claim-review requests. Defaults to keeping every claim (a checkable fact, nothing unclear). */
  onReview(answer: (asked: Asked) => Answer<unknown>): void;
  /** Answers "who or what does this refer to" requests (resolve.ts). Defaults to "can't tell" (null). */
  onReference(answer: (asked: Asked) => Answer<unknown>): void;
  /** Answers search requests. Unanswered queries get no results. */
  onSearch(answer: (query: string) => Answer<FakeSearchResult[]>): void;
  /** Answers the free key check (`GET /api_keys/rate_limits`) with its `data`. Defaults to a working key with $10. */
  onKeyCheck(answer: (authorization: string) => Answer<RateLimits>): void;
  /** Fails the next `count` requests whose path ends with `path` (e.g. '/augment/search'). */
  failNext(path: string, failure: Failure, count?: number): void;
  /** The `usage` (and `cost`, if `costUsd` is given) every chat reply carries from now on. Defaults to 100 in, 50 out, no cost. */
  replyUsage(usage: ReplyUsage): void;
}

/** What a chat reply says it used, and what it cost. */
export interface ReplyUsage {
  promptTokens: number;
  completionTokens: number;
  /** `cost.usd`; the reply has no `cost` without it. */
  costUsd?: number;
}

/** The `data` of Venice's `/api_keys/rate_limits` reply (the fields the key check reads). */
export interface RateLimits {
  accessPermitted: boolean;
  balances: { USD?: number; DIEM?: number; BUNDLED_CREDITS?: number };
  keyExpiration: string | null;
}

/** The claim review's answer for a claim worth checking. */
export const KEEP = { reason: 'A specific figure a source can settle.', kind: 'checkable fact', unclear: null };

export function isFailure(value: unknown): value is Failure {
  return typeof value === 'object' && value !== null && 'status' in value && typeof (value as Failure).status === 'number';
}

export function createFakeVenice(): FakeVenice {
  const requests: SentRequest[] = [];
  let breakdown: (asked: Asked) => Answer<unknown> = () => ({ claims: [], skipped: [] });
  let verdict: (asked: Asked) => Answer<unknown> = () => ({ status: 500, error: 'no verdict scripted' });
  let review: (asked: Asked) => Answer<unknown> = () => KEEP;
  let reference: (asked: Asked) => Answer<unknown> = () => ({ refers_to: null });
  let search: (query: string) => Answer<FakeSearchResult[]> = () => [];
  let keyCheck: (authorization: string) => Answer<RateLimits> = () => ({
    accessPermitted: true,
    balances: { USD: 10, DIEM: 0, BUNDLED_CREDITS: 0 },
    keyExpiration: null,
  });
  const failures: Array<{ path: string; failure: Failure; left: number }> = [];
  let usage: ReplyUsage = { promptTokens: 100, completionTokens: 50 };

  const json = (status: number, value: unknown) =>
    new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const text = typeof init?.body === 'string' ? init.body : '';
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
    const body: unknown = text ? JSON.parse(text) : undefined;
    requests.push({ url, method: init?.method ?? 'GET', headers, body, text });
    await Promise.resolve();

    const path = new URL(url).pathname;
    const failing = failures.find((f) => f.left > 0 && path.endsWith(f.path));
    if (failing) {
      failing.left--;
      return json(failing.failure.status, { error: failing.failure.error ?? 'failed' });
    }

    if (path === '/api/v1/augment/search') {
      const query = (body as { query: string }).query;
      const answer = await search(query);
      if (isFailure(answer)) return json(answer.status, { error: answer.error ?? 'failed' });
      return json(200, { query, results: answer.map((r) => ({ date: '', ...r })) });
    }

    if (path === '/api/v1/api_keys/rate_limits') {
      const answer = await keyCheck(headers.authorization ?? '');
      if (isFailure(answer)) return json(answer.status, { error: answer.error ?? 'failed' });
      return json(200, { data: { apiTier: { id: 'paid', isCharged: true }, nextEpochBegins: '', rateLimits: [], ...answer } });
    }

    if (path === '/api/v1/chat/completions') {
      const request = body as {
        messages: Array<{ role: string; content: string }>;
        response_format?: { json_schema?: { name?: string } };
      };
      const asked = {
        system: request.messages.find((m) => m.role === 'system')?.content ?? '',
        user: request.messages.find((m) => m.role === 'user')?.content ?? '',
      };
      const name = request.response_format?.json_schema?.name;
      const answer = await (
        name === 'claim_breakdown' ? breakdown : name === 'verdict' ? verdict : name === 'claim_review' ? review : name === 'reference' ? reference : () => ({ status: 400 })
      )(asked);
      if (isFailure(answer)) return json(answer.status, { error: answer.error ?? 'failed' });
      return json(200, {
        id: `chatcmpl-${requests.length}`,
        object: 'chat.completion',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer) } }],
        usage: {
          prompt_tokens: usage.promptTokens,
          completion_tokens: usage.completionTokens,
          total_tokens: usage.promptTokens + usage.completionTokens,
        },
        ...(usage.costUsd === undefined ? {} : { cost: { usd: usage.costUsd, diem: 0 } }),
      });
    }

    return json(404, { error: 'not found' });
  };

  return {
    fetch: fakeFetch as typeof fetch,
    requests,
    onBreakdown: (answer) => void (breakdown = answer),
    onVerdict: (answer) => void (verdict = answer),
    onReview: (answer) => void (review = answer),
    onReference: (answer) => void (reference = answer),
    onSearch: (answer) => void (search = answer),
    onKeyCheck: (answer) => void (keyCheck = answer),
    failNext: (path, failure, count = 1) => void failures.push({ path, failure, left: count }),
    replyUsage: (next) => void (usage = next),
  };
}
