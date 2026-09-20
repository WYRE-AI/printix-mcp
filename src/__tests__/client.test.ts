import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrinter, getTenant, requestAccessToken, resolveTenantId } from '../client.js';
import { jsonResponse, rootResponseFor } from './test-helpers.js';

describe('requestAccessToken', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs grant_type=client_credentials with client_id/client_secret in a form body (no HTTP Basic auth) and returns the token + parsed expiry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'tok-123', token_type: 'bearer', expires_in: 3599 }));

    const result = await requestAccessToken({ clientId: 'CID1', clientSecret: 'CSEC1' });

    expect(result.accessToken).toBe('tok-123');
    expect(result.expireAt).toBeGreaterThan(Date.now());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://auth.printix.net/oauth/token');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init.headers['Authorization']).toBeUndefined();
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('CID1');
    expect(body.get('client_secret')).toBe('CSEC1');
  });

  it('throws when the vendor returns 2xx with no access_token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client', error_description: 'Bad credentials' }));

    await expect(requestAccessToken({ clientId: 'bad', clientSecret: 'bad' })).rejects.toThrow(/Bad credentials/);
  });

  it('throws on a 401 response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));

    await expect(requestAccessToken({ clientId: 'CID1', clientSecret: 'CSEC1' })).rejects.toThrow(/HTTP 401/);
  });

  it('falls back to a conservative TTL when expires_in is missing', async () => {
    const before = Date.now();
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'tok-no-ttl' }));
    const result = await requestAccessToken({ clientId: 'CID1', clientSecret: 'CSEC1' });
    expect(result.expireAt).toBeGreaterThan(before);
    expect(result.expireAt).toBeLessThan(before + 11 * 60_000);
  });
});

describe('resolveTenantId / getTenant', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the API root with a Bearer token and extracts the tenant ID from the first /tenants/{id} link', async () => {
    const creds = { clientId: 'CID-TENANT', clientSecret: 'CSEC-TENANT' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-root', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-42')));

    const tenantId = await resolveTenantId(creds);

    expect(tenantId).toBe('T-42');
    const [rootUrl, rootInit] = fetchMock.mock.calls[1];
    expect(rootUrl).toBe('https://api.printix.net/cloudprint');
    expect(rootInit.headers['Authorization']).toBe('Bearer tok-root');
  });

  it('throws a clear error when the root response carries no tenant link', async () => {
    const creds = { clientId: 'CID-NOTENANT', clientSecret: 'CSEC-NOTENANT' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-root', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse({ _links: {} }));

    await expect(resolveTenantId(creds)).rejects.toThrow(/no accessible tenant link/);
  });

  it('getTenant returns the tenant ID and its link, and primes the tenant cache for later resource calls', async () => {
    const creds = { clientId: 'CID-GETTENANT', clientSecret: 'CSEC-GETTENANT' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-root', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-99')));

    const result = await getTenant(creds);
    expect(result.tenantId).toBe('T-99');
    expect(result.link.href).toContain('/tenants/T-99');

    // A subsequent resource call must reuse the primed tenant cache (and the
    // still-fresh token) and issue exactly one more fetch.
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'P-1', name: 'Lobby Printer' }));
    const printer = await getPrinter(creds, 'P-1');
    expect(printer.name).toBe('Lobby Printer');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [printerUrl] = fetchMock.mock.calls[2];
    expect(printerUrl).toBe('https://api.printix.net/cloudprint/tenants/T-99/printers/P-1');
  });
});

describe('getPrinter - access token caching, refresh, and cache-key isolation', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exchanges a token once, resolves the tenant once, sends the token as a Bearer header, and reuses both caches on a second call', async () => {
    const creds = { clientId: 'CID-CACHE', clientSecret: 'CSEC-CACHE' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-cache-1', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-1')))
      .mockResolvedValueOnce(jsonResponse({ id: 'P-1', name: 'Printer One' }));

    const result = await getPrinter(creds, 'P-1');

    expect(result.name).toBe('Printer One');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [printerUrl, printerInit] = fetchMock.mock.calls[2];
    expect(printerUrl).toBe('https://api.printix.net/cloudprint/tenants/T-1/printers/P-1');
    expect(printerInit.headers['Authorization']).toBe('Bearer tok-cache-1');

    // A second call with the same credentials must reuse the cached token
    // AND the cached tenant ID rather than re-exchanging/re-resolving either.
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'P-2', name: 'Printer Two' }));
    await getPrinter(creds, 'P-2');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('never shares a cached access token between two credential pairs that would collide under a naive colon-join', async () => {
    // clientId="A:B"/clientSecret="C" and clientId="A"/clientSecret="B:C"
    // both concatenate to "A:B:C" under a plain `${a}:${b}` join - this
    // guards the actual cache-key encoding (JSON.stringify) against that
    // collision.
    const tenantOne = { clientId: 'A:B', clientSecret: 'C' };
    const tenantTwo = { clientId: 'A', clientSecret: 'B:C' };

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-tenant-one', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-ONE')))
      .mockResolvedValueOnce(jsonResponse({ id: 'P-1' }));
    await getPrinter(tenantOne, 'P-1');

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-tenant-two', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-TWO')))
      .mockResolvedValueOnce(jsonResponse({ id: 'P-1' }));
    await getPrinter(tenantTwo, 'P-1');

    // 6 total fetches (token exchange + root resolve + resource request, per
    // tenant) means tenant two did its own token exchange and tenant
    // resolution rather than reusing tenant one's cached state - a
    // colon-join collision would collapse this below 6.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const [, tenantTwoTokenInit] = fetchMock.mock.calls[3];
    const tenantTwoBody = tenantTwoTokenInit.body as URLSearchParams;
    expect(tenantTwoBody.get('client_id')).toBe('A');
    expect(tenantTwoBody.get('client_secret')).toBe('B:C');
  });

  it('refreshes the access token exactly once when the vendor rejects it mid-call (401), then retries', async () => {
    const creds = { clientId: 'CID-REFRESH', clientSecret: 'CSEC-REFRESH' };
    fetchMock
      // Initial exchange
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-stale', expires_in: 3599 }))
      // Tenant resolution
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-1')))
      // First printer call: vendor says the token is invalid (HTTP 401)
      .mockResolvedValueOnce(jsonResponse({}, 401))
      // Forced re-exchange
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-fresh', expires_in: 3599 }))
      // Retried printer call succeeds
      .mockResolvedValueOnce(jsonResponse({ id: 'P-1', name: 'Printer One' }));

    const result = await getPrinter(creds, 'P-1');

    expect(result.name).toBe('Printer One');
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const [, retriedInit] = fetchMock.mock.calls[4];
    expect(retriedInit.headers['Authorization']).toBe('Bearer tok-fresh');
  });
});
