import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleTenantTool } from '../tools/tenant.js';
import { jsonResponse, rootResponseFor, textOf } from './test-helpers.js';

const ENV_KEYS = ['PRINTIX_CLIENT_ID', 'PRINTIX_CLIENT_SECRET'] as const;

describe('handleTenantTool', () => {
  const fetchMock = vi.fn();
  let credCounter = 0;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    credCounter += 1;
    process.env.PRINTIX_CLIENT_ID = `CID-TENANT-${credCounter}`;
    process.env.PRINTIX_CLIENT_SECRET = 'CSEC1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('errors when credentials are missing', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const result = await handleTenantTool('printix_get_tenant', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No Printix credentials configured/);
  });

  it('printix_get_tenant resolves the tenant ID and link from the API root', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-7')));

    const result = await handleTenantTool('printix_get_tenant', {});

    const parsed = JSON.parse(textOf(result));
    expect(parsed.tenantId).toBe('T-7');
    expect(parsed.link.href).toContain('/tenants/T-7');
    const [rootUrl] = fetchMock.mock.calls[1];
    expect(rootUrl).toBe('https://api.printix.net/cloudprint');
  });

  it('surfaces a clear error when the root response has no tenant link', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse({ _links: {} }));

    const result = await handleTenantTool('printix_get_tenant', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no accessible tenant link/);
  });
});
