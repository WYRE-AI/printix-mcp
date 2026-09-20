import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGroupTool } from '../tools/groups.js';
import { jsonResponse, rootResponseFor, textOf } from './test-helpers.js';

const ENV_KEYS = ['PRINTIX_CLIENT_ID', 'PRINTIX_CLIENT_SECRET'] as const;

describe('handleGroupTool', () => {
  const fetchMock = vi.fn();
  let credCounter = 0;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    credCounter += 1;
    process.env.PRINTIX_CLIENT_ID = `CID-GRP-${credCounter}`;
    process.env.PRINTIX_CLIENT_SECRET = 'CSEC1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('errors when credentials are missing', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const result = await handleGroupTool('printix_list_groups', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No Printix credentials configured/);
  });

  it('printix_get_group requires groupId', async () => {
    const result = await handleGroupTool('printix_get_group', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/groupId is required/);
  });

  it('printix_list_groups forwards query/page/pageSize as query params', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-1')))
      .mockResolvedValueOnce(jsonResponse({ success: true, groups: [{ id: 'G-1', name: 'Sales' }] }));

    const result = await handleGroupTool('printix_list_groups', { query: 'sales', page: 0, pageSize: 25 });

    expect(JSON.parse(textOf(result)).groups[0].name).toBe('Sales');
    const [url] = fetchMock.mock.calls[2];
    expect(url).toBe('https://api.printix.net/cloudprint/tenants/T-1/groups?query=sales&page=0&pageSize=25');
  });

  it('printix_get_group fetches group details by ID', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-1')))
      .mockResolvedValueOnce(jsonResponse({ id: 'G-1', name: 'Sales' }));

    const result = await handleGroupTool('printix_get_group', { groupId: 'G-1' });

    expect(JSON.parse(textOf(result)).name).toBe('Sales');
    const [url] = fetchMock.mock.calls[2];
    expect(url).toBe('https://api.printix.net/cloudprint/tenants/T-1/groups/G-1');
  });
});
