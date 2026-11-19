// Stands in for the provider (Venice) in e2e tests, so no request reaches
// the network. Chat completions are answered by their JSON-schema name;
// searches return one source unless scripted; the free key check says the
// key works with $10. Every request is recorded.
//
// The provider is called from the offscreen document, which Chrome lists as a
// `background_page` target. Playwright's `context.route` doesn't see those, so
// requests are intercepted with CDP `Fetch` on a browser-level session, which
// covers every target created after `stubVenice`. It doesn't reach a page
// that was already open (reload it, as privacy.spec does with the first-run
// page) or the service worker, which never calls the provider.

import type { BrowserContext, CDPSession, Worker } from '@playwright/test';

/**
 * Sets ClaimCatcher up the way the first-run page does: consent to cloud mode
 * at Venice, and the API key (that flow itself is tested in privacy.spec).
 */
export async function setApiKey(serviceWorker: Worker, key: string) {
  await serviceWorker.evaluate(
    (k) => chrome.storage.local.set({ apiKey: k, consent: { mode: 'cloud', provider: 'venice', givenAt: Date.now() } }),
    key,
  );
}

/** A provider answer that is an HTTP failure instead of JSON. */
export interface StubFailure {
  status: number;
  error: string;
}

export interface StubSearchResult {
  title: string;
  url: string;
  content: string;
  date?: string;
}

export interface StubbedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface VeniceStub {
  requests: StubbedRequest[];
  /** With `offline`: every request that tried to leave the machine other than to the provider, refused. */
  blocked: string[];
  /** Holds every verdict until `releaseVerdicts` is called, so "Checking…" can be seen. */
  holdVerdicts(): void;
  releaseVerdicts(): void;
}

export async function stubVenice(
  context: BrowserContext,
  answers: {
    breakdown?: (user: string) => unknown;
    verdict?: (user: string) => unknown | StubFailure;
    /** The claim review's answers; by default every claim is kept. */
    review?: (user: string) => unknown | StubFailure;
    /** Search results by query; by default every query finds one BLS page. */
    search?: (query: string) => StubSearchResult[];
    /** Refuses (and records in `blocked`) every request but the provider's, the fixture server's and the extension's own. */
    offline?: boolean;
    /** The `data` of `GET /api_keys/rate_limits`, or a failure. */
    keyCheck?: (authorization: string) => unknown | StubFailure;
    /** Every chat reply's `cost.usd`; without it, replies carry no cost. */
    chatCost?: number;
  } = {},
): Promise<VeniceStub> {
  const requests: StubbedRequest[] = [];
  const blocked: string[] = [];
  let hold: Promise<void> | null = null;
  let release = () => {};

  const cdp = await context.browser()!.newBrowserCDPSession();
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: answers.offline ? '*' : 'https://api.venice.ai/*' }] });
  cdp.on('Fetch.requestPaused', (event: PausedRequest) => void answer(cdp, event));

  async function answer(cdp: CDPSession, { requestId, request }: PausedRequest) {
    const { protocol, hostname } = new URL(request.url);
    if (hostname !== 'api.venice.ai') {
      const local = protocol === 'chrome-extension:' || hostname === '127.0.0.1' || hostname === 'localhost';
      if (local) return cdp.send('Fetch.continueRequest', { requestId });
      blocked.push(request.url);
      return cdp.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
    }
    const reply = (status: number, value: unknown) =>
      cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        responseHeaders: Object.entries(cors).map(([name, value]) => ({ name, value })),
        body: Buffer.from(JSON.stringify(value)).toString('base64'),
      });
    const path = new URL(request.url).pathname;
    if (request.method === 'OPTIONS') return reply(204, {});
    const body = request.postData ? (JSON.parse(request.postData) as Record<string, unknown>) : null;
    requests.push({ method: request.method, path, headers: lowerCase(request.headers), body });

    if (path === '/api/v1/augment/search') {
      const query = String(body?.query ?? '');
      const results = answers.search?.(query) ?? [
        { title: `BLS: ${query}`, url: 'https://www.bls.gov/news.release/empsit.nr0.htm', content: 'The unemployment rate was <strong>4.1</strong> percent.' },
      ];
      return reply(200, { query, results: results.map((r) => ({ date: '', ...r })) });
    }
    if (path === '/api/v1/api_keys/rate_limits') {
      const working = { accessPermitted: true, balances: { USD: 10, DIEM: 0, BUNDLED_CREDITS: 0 }, keyExpiration: null };
      const answer = answers.keyCheck ? answers.keyCheck(lowerCase(request.headers).authorization ?? '') : working;
      if (isFailure(answer)) return reply(answer.status, { error: answer.error });
      return reply(200, { data: answer });
    }
    if (path === '/api/v1/chat/completions') {
      const messages = (body?.messages ?? []) as Array<{ role: string; content: string }>;
      const user = messages.find((m) => m.role === 'user')?.content ?? '';
      const name = (body?.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema?.name;
      if (name === 'verdict' && hold) await hold;
      const noClaims = () => ({ claims: [], skipped: [] });
      const keep = () => ({ reason: 'A specific fact a source can settle.', kind: 'checkable fact', unclear: null });
      const answer =
        name === 'claim_breakdown' ? (answers.breakdown ?? noClaims)(user) : name === 'claim_review'
            ? (answers.review ?? keep)(user)
            : name === 'reference'
              ? { refers_to: null }
              : answers.verdict?.(user);
      if (isFailure(answer)) return reply(answer.status, { error: answer.error });
      return reply(200, {
        id: 'chatcmpl-stub',
        object: 'chat.completion',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        ...(answers.chatCost === undefined ? {} : { cost: { usd: answers.chatCost, diem: 0 } }),
      });
    }
    return reply(404, { error: 'not found' });
  }

  return {
    requests,
    blocked,
    holdVerdicts() {
      hold = new Promise((resolve) => (release = resolve));
    },
    releaseVerdicts() {
      release();
      hold = null;
    },
  };
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};

function isFailure(value: unknown): value is StubFailure {
  return typeof value === 'object' && value !== null && 'status' in value && 'error' in value;
}

interface PausedRequest {
  requestId: string;
  request: { url: string; method: string; headers: Record<string, string>; postData?: string };
}

function lowerCase(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}
