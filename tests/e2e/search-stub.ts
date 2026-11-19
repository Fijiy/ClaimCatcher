// Stands in for local mode's TinyFish search API in e2e tests, so no request
// reaches it. Like
// venice-stub.ts it uses CDP `Fetch` on a browser-level session, so it covers
// extension pages and the offscreen document created after it (reload a page
// that was already open). Every request is recorded.

import type { BrowserContext } from '@playwright/test';

export interface SearchStubRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

export interface SearchStub {
  requests: SearchStubRequest[];
}

export async function stubSearch(
  context: BrowserContext,
  answers: {
    /** TinyFish's key check (`GET /usage`): the status to answer with. Defaults to 200 (the key works). */
    tinyfishKeyCheck?: (key: string) => number;
  } = {},
): Promise<SearchStub> {
  const requests: SearchStubRequest[] = [];
  const cdp = await context.browser()!.newBrowserCDPSession();
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: 'https://api.search.tinyfish.ai/*' }],
  });
  cdp.on('Fetch.requestPaused', (event: { requestId: string; request: { url: string; method: string; headers: Record<string, string> } }) => {
    const { requestId, request } = event;
    const headers = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v]));
    requests.push({ url: request.url, method: request.method, headers });
    const url = new URL(request.url);
    const cors = [
      { name: 'access-control-allow-origin', value: '*' },
      { name: 'access-control-allow-headers', value: '*' },
    ];
    if (request.method === 'OPTIONS') {
      void cdp.send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: cors, body: '' }).catch(() => {});
      return;
    }
    let status = 200;
    let body: unknown = { query: url.searchParams.get('query'), results: [], total_results: 0, page: 0 };
    if (url.hostname === 'api.search.tinyfish.ai' && url.pathname === '/usage') {
      status = answers.tinyfishKeyCheck?.(headers['x-api-key'] ?? '') ?? 200;
      body = status === 200 ? { items: [], total: 0, limit: 1, page: 1, total_pages: 0, has_more: false } : { error: { code: 'INVALID_API_KEY', message: 'Invalid or expired API key' } };
    }
    void cdp
      .send('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        responseHeaders: [...cors, { name: 'content-type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(body)).toString('base64'),
      })
      .catch(() => {});
  });
  return { requests };
}
