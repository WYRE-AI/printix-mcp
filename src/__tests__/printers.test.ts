import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePrinterTool } from '../tools/printers.js';
import { jsonResponse, rootResponseFor, textOf } from './test-helpers.js';

const ENV_KEYS = ['PRINTIX_CLIENT_ID', 'PRINTIX_CLIENT_SECRET'] as const;

describe('handlePrinterTool', () => {
  const fetchMock = vi.fn();
  let credCounter = 0;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    // A unique clientId per test keeps client.ts's module-scoped token/tenant
    // caches from bleeding between tests (both are keyed on the full
    // credential pair, so a fresh id forces a real exchange/resolve every
    // time).
    credCounter += 1;
    process.env.PRINTIX_CLIENT_ID = `CID-${credCounter}`;
    process.env.PRINTIX_CLIENT_SECRET = 'CSEC1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('errors when credentials are missing', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const result = await handlePrinterTool('printix_list_printers', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No Printix credentials configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('printix_get_printer requires printerId', async () => {
    const result = await handlePrinterTool('printix_get_printer', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/printerId is required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('printix_list_printers forwards query/page/pageSize as query params, scoped to the resolved tenant', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-1')))
      .mockResolvedValueOnce(jsonResponse({ success: true, printers: [{ id: 'P-1', name: 'Lobby' }] }));

    const result = await handlePrinterTool('printix_list_printers', { query: 'lobby', page: 0, pageSize: 25 });

    expect(JSON.parse(textOf(result)).printers[0].name).toBe('Lobby');
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe('https://api.printix.net/cloudprint/tenants/T-1/printers?query=lobby&page=0&pageSize=25');
    expect(init.headers['Authorization']).toBe('Bearer tok');
  });

  it('printix_get_printer fetches a single printer by ID', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(rootResponseFor('T-1')))
      .mockResolvedValueOnce(jsonResponse({ id: 'P-1', name: 'Lobby Printer' }));

    const result = await handlePrinterTool('printix_get_printer', { printerId: 'P-1' });

    expect(JSON.parse(textOf(result)).name).toBe('Lobby Printer');
    const [url] = fetchMock.mock.calls[2];
    expect(url).toBe('https://api.printix.net/cloudprint/tenants/T-1/printers/P-1');
  });
});
