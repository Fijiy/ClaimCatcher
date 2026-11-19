// The free key check run when the viewer pastes a key (spec story 11). The
// provider is the fake `fetch` (testing/fake-venice.ts); tests assert on the
// result the viewer is shown and on what was sent.

import { describe, expect, it } from 'vitest';
import { createFakeVenice } from '../testing/fake-venice';
import { createFakeTinyFish } from '../testing/fake-search';
import { checkTinyFishKey } from './tinyfish';
import { checkVeniceKey } from './venice';

const KEY = 'venice-test-key-3f9a';

describe('checking a pasted key', () => {
  it('reports a working key with its balance and expiry, at no cost', async () => {
    const venice = createFakeVenice();
    venice.onKeyCheck(() => ({ accessPermitted: true, balances: { USD: 4.5, DIEM: 0 }, keyExpiration: '2026-12-31T00:00:00.000Z' }));

    const result = await checkVeniceKey(venice.fetch, KEY);

    expect(result).toEqual({ status: 'works', balanceUsd: 4.5, expires: '2026-12-31T00:00:00.000Z' });
    // One free request to the provider's own origin, with the key, and nothing else.
    expect(venice.requests).toHaveLength(1);
    expect(venice.requests[0]).toMatchObject({ url: 'https://api.venice.ai/api/v1/api_keys/rate_limits', method: 'GET' });
    expect(venice.requests[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it('reports a key Venice refuses as rejected', async () => {
    const venice = createFakeVenice();
    venice.onKeyCheck(() => ({ status: 401, error: 'Authentication failed' }));

    expect(await checkVeniceKey(venice.fetch, KEY)).toEqual({ status: 'rejected' });
  });

  it('reports an account with no credit, so the viewer can add some before listening', async () => {
    const venice = createFakeVenice();
    venice.onKeyCheck(() => ({ accessPermitted: true, balances: { USD: 0, DIEM: 0, BUNDLED_CREDITS: 0 }, keyExpiration: null }));

    expect(await checkVeniceKey(venice.fetch, KEY)).toEqual({ status: 'no-credit', expires: null });
  });

  it('reports a key that may not run models', async () => {
    const venice = createFakeVenice();
    venice.onKeyCheck(() => ({ accessPermitted: false, balances: { USD: 3 }, keyExpiration: null }));

    expect(await checkVeniceKey(venice.fetch, KEY)).toEqual({ status: 'not-permitted' });
  });

  it("says the key wasn't checked when Venice can't be reached", async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    expect(await checkVeniceKey(failing, KEY)).toMatchObject({ status: 'unchecked' });
  });

  it("says the key wasn't checked when Venice is down", async () => {
    const venice = createFakeVenice();
    venice.onKeyCheck(() => ({ status: 503, error: 'Service unavailable' }));

    expect(await checkVeniceKey(venice.fetch, KEY)).toMatchObject({ status: 'unchecked' });
  });
});

describe('checking a pasted TinyFish key', () => {
  const TINYFISH_KEY = 'tinyfish-test-key-7c2e';

  it('reports a working key from a request that lists past searches instead of running one', async () => {
    const tinyfish = createFakeTinyFish();

    expect(await checkTinyFishKey(tinyfish.fetch, TINYFISH_KEY)).toEqual({ status: 'works' });
    expect(tinyfish.requests).toHaveLength(1);
    expect(tinyfish.requests[0]).toMatchObject({ url: 'https://api.search.tinyfish.ai/usage?limit=1', method: 'GET' });
    expect(tinyfish.requests[0]!.headers['x-api-key']).toBe(TINYFISH_KEY);
  });

  it('reports a key TinyFish refuses as rejected', async () => {
    const tinyfish = createFakeTinyFish();
    tinyfish.onKeyCheck(() => ({ status: 401 }));
    expect(await checkTinyFishKey(tinyfish.fetch, TINYFISH_KEY)).toEqual({ status: 'rejected' });
  });

  it('reports an account without the search API as not permitted, and anything else as unchecked', async () => {
    const tinyfish = createFakeTinyFish();
    tinyfish.onKeyCheck(() => ({ status: 404 }));
    expect(await checkTinyFishKey(tinyfish.fetch, TINYFISH_KEY)).toEqual({ status: 'not-permitted' });
    tinyfish.onKeyCheck(() => ({ status: 503 }));
    expect(await checkTinyFishKey(tinyfish.fetch, TINYFISH_KEY)).toMatchObject({ status: 'unchecked' });
    const offline = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    expect(await checkTinyFishKey(offline, TINYFISH_KEY)).toMatchObject({ status: 'unchecked' });
  });
});
