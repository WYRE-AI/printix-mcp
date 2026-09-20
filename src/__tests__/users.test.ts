import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleUserTool } from '../tools/users.js';
import { jsonResponse, rootResponseFor, textOf } from './test-helpers.js';

const ENV_KEYS = ['PRINTIX_CLIENT_ID', 'PRINTIX_CLIENT_SECRET'] as const;

describe('handleUserTool', () => {
  const fetchMock = vi.fn();
  let credCounter = 0;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    credCounter += 1;
    process.env.PRINTIX_CLIENT_ID = `CID-USER-${credCounter}`;
    process.env.PRINTIX_CLIENT_SECRET = 'CSEC1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('errors when credentials are missing', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const result = await handleUserTool('printix_list_users', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No Printix credentials configured/);
  });

  it('printix_get_user requires userId', async () => {
    const result = await handleUserTool('printix_get_user', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/userId is required/);
  });

  it('printix_list_users forwards query/role/page/pageSize as query params', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-1')))
      .mockResolvedValueOnce(jsonResponse({ success: true, users: [{ id: 'U-1', email: 'a@example.com' }] }));

    const result = await handleUserTool('printix_list_users', { query: 'a@example.com', role: 'admin', page: 0, pageSize: 25 });

    expect(JSON.parse(textOf(result)).users[0].email).toBe('a@example.com');
    const [url] = fetchMock.mock.calls[2];
    expect(url).toBe(
      'https://api.printix.net/cloudprint/tenants/T-1/users?query=a%40example.com&role=admin&page=0&pageSize=25'
    );
  });

  it('printix_get_user finds a single user by ID', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-1')))
      .mockResolvedValueOnce(jsonResponse({ id: 'U-1', email: 'a@example.com' }));

    const result = await handleUserTool('printix_get_user', { userId: 'U-1' });

    expect(JSON.parse(textOf(result)).email).toBe('a@example.com');
    const [url] = fetchMock.mock.calls[2];
    expect(url).toBe('https://api.printix.net/cloudprint/tenants/T-1/users/U-1');
  });
});
