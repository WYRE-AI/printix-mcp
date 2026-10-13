/**
 * HTTP transport fails closed (CWE-306).
 *
 * Startup refuses to listen when CONDUIT_S2S_SECRET is empty or a known
 * placeholder, unless MCP_ALLOW_INSECURE_DEV=1. That bypass binds 127.0.0.1
 * only. Gateway-mode /mcp requests without vendor credential headers are 401
 * and must not consult process.env credentials.
 */
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrintixCredentials } from '../types.js';

const getCredentialsMock = vi.hoisted(() => vi.fn());
const runWithCredentialsMock = vi.hoisted(() => vi.fn());

vi.mock('../client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client.js')>();
  return {
    ...actual,
    getCredentials: () => {
      const creds = actual.getCredentials();
      getCredentialsMock(creds);
      return creds;
    },
    runWithCredentials: <T>(creds: PrintixCredentials, fn: () => T): T => {
      runWithCredentialsMock(creds);
      return actual.runWithCredentials(creds, fn);
    },
  };
});

import { startHttpTransport } from '../http.js';

const TEST_SECRET = 'test-s2s-fail-closed-secret-do-not-use-in-prod';
const ENV_CLIENT_ID = 'env-client-id-must-not-be-used';
const ENV_CLIENT_SECRET = 'env-client-secret-must-not-be-used';

const ENV_KEYS = [
  'CONDUIT_S2S_SECRET',
  'MCP_ALLOW_INSECURE_DEV',
  'MCP_HTTP_PORT',
  'MCP_HTTP_HOST',
  'AUTH_MODE',
  'PRINTIX_CLIENT_ID',
  'PRINTIX_CLIENT_SECRET',
  'LOG_LEVEL',
  'MCP_TRANSPORT',
] as const;

const savedEnv = new Map<string, string | undefined>();
const servers: Server[] = [];

function mintS2sHeader(secret: string, unixSeconds = Math.floor(Date.now() / 1000)): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac('sha256', secret).update(message).digest('hex');
  return `${message},v1=${hex}`;
}

function captureStderr(): { text: () => string; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  });
  return {
    text: () => lines.join('\n'),
    restore: () => spy.mockRestore(),
  };
}

function exitSpy() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${String(code)}`);
  }) as typeof process.exit);
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function mcpHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...extra,
  };
}

function stubVendorFetch(): void {
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:') || url.startsWith('http://[::1]:')) {
      return realFetch(input, init);
    }
    return Promise.resolve(new Response(JSON.stringify({ error: 'nope' }), { status: 401 }));
  });
}

const toolsList = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
});

const tenantCall = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'printix_get_tenant', arguments: {} },
});

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
});

afterEach(async () => {
  while (servers.length > 0) {
    await closeServer(servers.pop());
  }
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function prepareEnv(): void {
  process.env.MCP_HTTP_PORT = '0';
  process.env.MCP_HTTP_HOST = '127.0.0.1';
  process.env.LOG_LEVEL = 'info';
  delete process.env.CONDUIT_S2S_SECRET;
  delete process.env.MCP_ALLOW_INSECURE_DEV;
  delete process.env.AUTH_MODE;
  delete process.env.PRINTIX_CLIENT_ID;
  delete process.env.PRINTIX_CLIENT_SECRET;
  delete process.env.MCP_TRANSPORT;
  getCredentialsMock.mockClear();
  runWithCredentialsMock.mockClear();
}

describe('HTTP startup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to start when CONDUIT_S2S_SECRET is empty', async () => {
    prepareEnv();
    delete process.env.MCP_HTTP_HOST;
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      await expect(startHttpTransport()).rejects.toThrow('process.exit:1');
      expect(exit).toHaveBeenCalledWith(1);
      const text = logs.text();
      expect(text).toContain('Refusing to start HTTP server');
      expect(text).toContain('CONDUIT_S2S_SECRET is empty');
      expect(text).toContain('MCP_ALLOW_INSECURE_DEV=1');
      expect(text).not.toContain(TEST_SECRET);
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it('refuses to start when CONDUIT_S2S_SECRET is whitespace', async () => {
    prepareEnv();
    process.env.CONDUIT_S2S_SECRET = '   ';
    process.env.MCP_ALLOW_INSECURE_DEV = 'true';
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      await expect(startHttpTransport()).rejects.toThrow('process.exit:1');
      expect(logs.text()).toContain('CONDUIT_S2S_SECRET is empty');
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it('still refuses when MCP_ALLOW_INSECURE_DEV is not exactly 1', async () => {
    prepareEnv();
    process.env.MCP_ALLOW_INSECURE_DEV = 'true';
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      await expect(startHttpTransport()).rejects.toThrow('process.exit:1');
      expect(logs.text()).toContain('Refusing to start HTTP server');
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it('refuses a known placeholder secret and does not log it', async () => {
    prepareEnv();
    process.env.CONDUIT_S2S_SECRET = 'replace-with-a-real-secret';
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      await expect(startHttpTransport()).rejects.toThrow('process.exit:1');
      expect(exit).toHaveBeenCalledWith(1);
      const text = logs.text();
      expect(text).toContain('known placeholder');
      expect(text).toContain('openssl rand -hex 32');
      expect(text).not.toContain('replace-with-a-real-secret');
      expect(text).not.toContain(TEST_SECRET);
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it.each(['secret', 'placeholder'])(
    'refuses the placeholder %s without echoing the configured value',
    async (placeholder) => {
      prepareEnv();
      process.env.CONDUIT_S2S_SECRET = placeholder;
      const logs = captureStderr();
      const exit = exitSpy();
      try {
        await expect(startHttpTransport()).rejects.toThrow('process.exit:1');
        const text = logs.text();
        expect(text).toContain('known placeholder');
        expect(text).not.toContain(`CONDUIT_S2S_SECRET=${placeholder}`);
      } finally {
        exit.mockRestore();
        logs.restore();
      }
    },
  );

  it.each(['changeme', 'change-me', 'example', 'replace-me', 's2s-secret', 'your-secret'])(
    'refuses the placeholder %s',
    async (placeholder) => {
      prepareEnv();
      process.env.CONDUIT_S2S_SECRET = placeholder;
      const logs = captureStderr();
      const exit = exitSpy();
      try {
        await expect(startHttpTransport()).rejects.toThrow('process.exit:1');
        expect(logs.text()).toContain('known placeholder');
        expect(logs.text()).not.toContain(placeholder);
      } finally {
        exit.mockRestore();
        logs.restore();
      }
    },
  );

  it('refuses a placeholder even when MCP_ALLOW_INSECURE_DEV=1', async () => {
    prepareEnv();
    process.env.CONDUIT_S2S_SECRET = '  Your-S2S-Secret  ';
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      await expect(startHttpTransport()).rejects.toThrow('process.exit:1');
      expect(exit).toHaveBeenCalledWith(1);
      const text = logs.text();
      expect(text).toContain('known placeholder');
      expect(text).not.toContain('Your-S2S-Secret');
      expect(text).not.toContain('SECURITY WARNING');
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it('allows startup with a warning when MCP_ALLOW_INSECURE_DEV=1 and binds 127.0.0.1', async () => {
    prepareEnv();
    delete process.env.MCP_HTTP_HOST;
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.LOG_LEVEL = 'error';
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      const server = await startHttpTransport();
      servers.push(server);
      expect(exit).not.toHaveBeenCalled();
      expect(server.address()).toMatchObject({ address: '127.0.0.1' });
      const text = logs.text();
      expect(text).toContain('SECURITY WARNING');
      expect(text).toContain('CONDUIT_S2S_SECRET');
      expect(text).toContain('MCP_ALLOW_INSECURE_DEV=1');
      expect(text).toContain('127.0.0.1');
      expect(text).toContain('DISABLED');
      expect(text).not.toContain(TEST_SECRET);
      expect(text).not.toContain('not a loopback address');
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it('forces 127.0.0.1 when the dev bypass is set and MCP_HTTP_HOST is localhost', async () => {
    prepareEnv();
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.MCP_HTTP_HOST = 'localhost';
    const logs = captureStderr();
    try {
      const server = await startHttpTransport();
      servers.push(server);
      expect(server.address()).toMatchObject({ address: '127.0.0.1' });
      const text = logs.text();
      expect(text).toContain('SECURITY WARNING');
      expect(text).toContain('listening on 127.0.0.1:');
      expect(text).not.toContain('listening on localhost');
      expect(text).not.toContain('not a loopback address');
    } finally {
      logs.restore();
    }
  });

  it('binds 127.0.0.1 when the dev bypass is set and MCP_HTTP_HOST is non-loopback', async () => {
    prepareEnv();
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      const server = await startHttpTransport();
      servers.push(server);
      expect(exit).not.toHaveBeenCalled();
      expect(server.address()).toMatchObject({ address: '127.0.0.1' });
      const text = logs.text();
      expect(text).toContain('MCP_HTTP_HOST=0.0.0.0 is not a loopback address');
      expect(text).toContain('Binding 127.0.0.1 only');
      expect(text).not.toContain(TEST_SECRET);
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it('honors a non-loopback MCP_HTTP_HOST when CONDUIT_S2S_SECRET is set', async () => {
    prepareEnv();
    process.env.CONDUIT_S2S_SECRET = TEST_SECRET;
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    const logs = captureStderr();
    try {
      const server = await startHttpTransport();
      servers.push(server);
      expect(server.address()).toMatchObject({ address: '0.0.0.0' });
      const text = logs.text();
      expect(text).toContain('listening on 0.0.0.0:');
      expect(text).not.toContain('not a loopback address');
      expect(text).not.toContain(TEST_SECRET);
    } finally {
      logs.restore();
    }
  });

  it('binds 127.0.0.1 when MCP_HTTP_HOST is unset and a secret is set', async () => {
    prepareEnv();
    delete process.env.MCP_HTTP_HOST;
    process.env.CONDUIT_S2S_SECRET = TEST_SECRET;
    const server = await startHttpTransport();
    servers.push(server);
    expect(server.address()).toMatchObject({ address: '127.0.0.1' });
  });

  it('does not enforce X-Gateway-S2S when the dev bypass is set', async () => {
    prepareEnv();
    delete process.env.MCP_HTTP_HOST;
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.AUTH_MODE = 'gateway';
    const server = await startHttpTransport();
    servers.push(server);
    const bound = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${bound.port}/mcp`, {
      method: 'POST',
      headers: mcpHeaders({
        'x-printix-client-id': 'header-client-id',
        'x-printix-client-secret': 'header-client-secret',
      }),
      body: toolsList,
    });
    expect(response.status).toBe(200);
    expect(runWithCredentialsMock).toHaveBeenCalledWith({
      clientId: 'header-client-id',
      clientSecret: 'header-client-secret',
    });
    expect(server.address()).toMatchObject({ address: '127.0.0.1' });
  });
});

describe('HTTP /mcp authentication', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    prepareEnv();
    delete process.env.MCP_HTTP_HOST;
    process.env.CONDUIT_S2S_SECRET = TEST_SECRET;
    process.env.AUTH_MODE = 'gateway';
    process.env.PRINTIX_CLIENT_ID = ENV_CLIENT_ID;
    process.env.PRINTIX_CLIENT_SECRET = ENV_CLIENT_SECRET;
    process.env.LOG_LEVEL = 'info';

    const logs = captureStderr();
    try {
      server = await startHttpTransport();
      const bound = server.address() as AddressInfo;
      expect(bound.address).toBe('127.0.0.1');
      port = bound.port;
      const text = logs.text();
      expect(text).toContain(`HTTP streaming server listening on 127.0.0.1:${port}`);
      expect(text).not.toContain(TEST_SECRET);
      expect(text).not.toContain(ENV_CLIENT_SECRET);
    } finally {
      logs.restore();
    }
  });

  afterAll(async () => {
    await closeServer(server);
  });

  afterEach(() => {
    getCredentialsMock.mockClear();
    runWithCredentialsMock.mockClear();
  });

  async function postMcp(headers: Record<string, string>, body = toolsList): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: mcpHeaders(headers),
      body,
    });
  }

  it('returns 401 when the S2S header is missing or invalid and does not read credentials', async () => {
    const missing = await postMcp({
      'x-printix-client-id': 'header-client-id',
      'x-printix-client-secret': 'header-client-secret',
    });
    const invalid = await postMcp({
      'x-gateway-s2s': mintS2sHeader('wrong-secret'),
      'x-printix-client-id': 'header-client-id',
      'x-printix-client-secret': 'header-client-secret',
    });

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    const missingBody = await missing.json() as { error: string };
    const invalidBody = await invalid.json() as { error: string };
    expect(missingBody.error).toContain('X-Gateway-S2S');
    expect(invalidBody.error).toContain('X-Gateway-S2S');
    expect(JSON.stringify(missingBody)).not.toContain(TEST_SECRET);
    expect(JSON.stringify(invalidBody)).not.toContain(TEST_SECRET);
    expect(JSON.stringify(missingBody)).not.toContain(ENV_CLIENT_ID);
    expect(JSON.stringify(missingBody)).not.toContain(ENV_CLIENT_SECRET);
    expect(getCredentialsMock).not.toHaveBeenCalled();
    expect(runWithCredentialsMock).not.toHaveBeenCalled();
  });

  it('returns 401 in gateway mode without credential headers and does not use env credentials', async () => {
    const response = await postMcp({ 'x-gateway-s2s': mintS2sHeader(TEST_SECRET) });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toContain('missing required gateway credential headers');
    expect(body.error).toContain('X-Printix-Client-ID');
    expect(body.error).toContain('X-Printix-Client-Secret');
    expect(JSON.stringify(body)).not.toContain(ENV_CLIENT_ID);
    expect(JSON.stringify(body)).not.toContain(ENV_CLIENT_SECRET);
    expect(JSON.stringify(body)).not.toContain(TEST_SECRET);
    expect(getCredentialsMock).not.toHaveBeenCalled();
    expect(runWithCredentialsMock).not.toHaveBeenCalled();
  });

  it('returns 401 when only one credential header is present', async () => {
    const response = await postMcp({
      'x-gateway-s2s': mintS2sHeader(TEST_SECRET),
      'x-printix-client-id': 'header-client-id',
    });
    expect(response.status).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('X-Printix-Client-Secret');
    expect(getCredentialsMock).not.toHaveBeenCalled();
    expect(runWithCredentialsMock).not.toHaveBeenCalled();
  });

  it('returns 401 when credential headers are blank', async () => {
    const response = await postMcp({
      'x-gateway-s2s': mintS2sHeader(TEST_SECRET),
      'x-printix-client-id': '   ',
      'x-printix-client-secret': 'header-client-secret',
    });
    expect(response.status).toBe(401);
    expect(runWithCredentialsMock).not.toHaveBeenCalled();
  });

  it('accepts a valid S2S header plus credential headers and uses those credentials', async () => {
    stubVendorFetch();
    try {
      const response = await postMcp(
        {
          'x-gateway-s2s': mintS2sHeader(TEST_SECRET),
          'x-printix-client-id': 'header-client-id',
          'x-printix-client-secret': 'header-client-secret',
        },
        tenantCall,
      );
      const raw = await response.text();

      expect(response.status).toBe(200);
      expect(raw).not.toContain(TEST_SECRET);
      expect(raw).not.toContain(ENV_CLIENT_ID);
      expect(raw).not.toContain(ENV_CLIENT_SECRET);
      expect(runWithCredentialsMock).toHaveBeenCalledWith({
        clientId: 'header-client-id',
        clientSecret: 'header-client-secret',
      });
      expect(getCredentialsMock).toHaveBeenCalledWith({
        clientId: 'header-client-id',
        clientSecret: 'header-client-secret',
      });
      const sawEnv = getCredentialsMock.mock.calls.some((call) => {
        const creds = call[0] as PrintixCredentials | null;
        return creds?.clientId === ENV_CLIENT_ID || creds?.clientSecret === ENV_CLIENT_SECRET;
      });
      expect(sawEnv).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('serves /health without authentication and without reading credentials', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await response.json() as { status?: string; mode?: string; credentials?: unknown };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.mode).toBe('gateway');
    expect(body.credentials).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(TEST_SECRET);
    expect(JSON.stringify(body)).not.toContain(ENV_CLIENT_ID);
    expect(JSON.stringify(body)).not.toContain(ENV_CLIENT_SECRET);
    expect(getCredentialsMock).not.toHaveBeenCalled();
    expect(runWithCredentialsMock).not.toHaveBeenCalled();
  });
});

describe('HTTP env mode', () => {
  it('does not require vendor headers after a valid S2S proof and reads env credentials', async () => {
    prepareEnv();
    process.env.CONDUIT_S2S_SECRET = TEST_SECRET;
    process.env.AUTH_MODE = 'env';
    process.env.PRINTIX_CLIENT_ID = ENV_CLIENT_ID;
    process.env.PRINTIX_CLIENT_SECRET = ENV_CLIENT_SECRET;
    process.env.MCP_HTTP_HOST = '127.0.0.1';

    stubVendorFetch();
    const server = await startHttpTransport();
    servers.push(server);
    try {
      const bound = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${bound.port}/mcp`, {
        method: 'POST',
        headers: mcpHeaders({ 'x-gateway-s2s': mintS2sHeader(TEST_SECRET) }),
        body: tenantCall,
      });
      const raw = await response.text();

      expect(response.status).toBe(200);
      expect(raw).not.toContain(TEST_SECRET);
      expect(runWithCredentialsMock).not.toHaveBeenCalled();
      expect(getCredentialsMock).toHaveBeenCalledWith({
        clientId: ENV_CLIENT_ID,
        clientSecret: ENV_CLIENT_SECRET,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
