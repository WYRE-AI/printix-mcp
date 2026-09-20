import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleWorkstationTool } from '../tools/workstations.js';
import { jsonResponse, rootResponseFor, textOf } from './test-helpers.js';

const ENV_KEYS = ['PRINTIX_CLIENT_ID', 'PRINTIX_CLIENT_SECRET'] as const;

describe('handleWorkstationTool', () => {
  const fetchMock = vi.fn();
  let credCounter = 0;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    credCounter += 1;
    process.env.PRINTIX_CLIENT_ID = `CID-WS-${credCounter}`;
    process.env.PRINTIX_CLIENT_SECRET = 'CSEC1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('errors when credentials are missing', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const result = await handleWorkstationTool('printix_list_workstations', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No Printix credentials configured/);
  });

  it('printix_get_workstation requires workstationId', async () => {
    const result = await handleWorkstationTool('printix_get_workstation', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/workstationId is required/);
  });

  it('printix_list_workstations paginates via page/pageSize query params', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-1')))
      .mockResolvedValueOnce(jsonResponse({ success: true, workstations: [{ id: 'W-1', name: 'Front Desk' }] }));

    const result = await handleWorkstationTool('printix_list_workstations', { page: 0, pageSize: 50 });

    expect(JSON.parse(textOf(result)).workstations[0].name).toBe('Front Desk');
    const [url] = fetchMock.mock.calls[2];
    expect(url).toBe('https://api.printix.net/cloudprint/tenants/T-1/workstations?page=0&pageSize=50');
  });

  it('printix_get_workstation fetches a single workstation by ID', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-1')))
      .mockResolvedValueOnce(jsonResponse({ id: 'W-1', name: 'Front Desk' }));

    const result = await handleWorkstationTool('printix_get_workstation', { workstationId: 'W-1' });

    expect(JSON.parse(textOf(result)).name).toBe('Front Desk');
    const [url] = fetchMock.mock.calls[2];
    expect(url).toBe('https://api.printix.net/cloudprint/tenants/T-1/workstations/W-1');
  });
});
