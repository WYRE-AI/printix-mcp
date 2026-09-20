import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSiteTool } from '../tools/sites.js';
import { jsonResponse, rootResponseFor, textOf } from './test-helpers.js';

const ENV_KEYS = ['PRINTIX_CLIENT_ID', 'PRINTIX_CLIENT_SECRET'] as const;

describe('handleSiteTool', () => {
  const fetchMock = vi.fn();
  let credCounter = 0;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    credCounter += 1;
    process.env.PRINTIX_CLIENT_ID = `CID-SITE-${credCounter}`;
    process.env.PRINTIX_CLIENT_SECRET = 'CSEC1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('errors when credentials are missing', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const result = await handleSiteTool('printix_list_sites', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No Printix credentials configured/);
  });

  it('printix_get_site requires siteId', async () => {
    const result = await handleSiteTool('printix_get_site', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/siteId is required/);
  });

  it('printix_list_sites paginates via page/pageSize query params', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-1')))
      .mockResolvedValueOnce(jsonResponse({ success: true, sites: [{ id: 'S-1', name: 'HQ' }] }));

    const result = await handleSiteTool('printix_list_sites', { page: 1, pageSize: 10 });

    expect(JSON.parse(textOf(result)).sites[0].name).toBe('HQ');
    const [url] = fetchMock.mock.calls[2];
    expect(url).toBe('https://api.printix.net/cloudprint/tenants/T-1/sites?page=1&pageSize=10');
  });

  it('printix_get_site fetches a single site by ID', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-1')))
      .mockResolvedValueOnce(jsonResponse({ id: 'S-1', name: 'HQ' }));

    const result = await handleSiteTool('printix_get_site', { siteId: 'S-1' });

    expect(JSON.parse(textOf(result)).name).toBe('HQ');
    const [url] = fetchMock.mock.calls[2];
    expect(url).toBe('https://api.printix.net/cloudprint/tenants/T-1/sites/S-1');
  });
});
