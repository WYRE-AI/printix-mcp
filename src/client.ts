import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from './utils/logger.js';
import type {
  OAuthTokenResponse,
  PrintixCredentials,
  PrintixGroup,
  PrintixGroupsResponse,
  PrintixLink,
  PrintixListParams,
  PrintixPrinter,
  PrintixPrintersResponse,
  PrintixRootResponse,
  PrintixSite,
  PrintixSitesResponse,
  PrintixUser,
  PrintixUsersResponse,
  PrintixWorkstation,
  PrintixWorkstationsResponse,
} from './types.js';

const AUTH_BASE_URL = 'https://auth.printix.net';
const API_BASE_URL = 'https://api.printix.net';

// Refresh the OAuth access token this far ahead of its documented
// expires_in (3599s) so a slow downstream call never races a token that
// expires mid-request.
const REFRESH_SKEW_MS = 60_000;

// Conservative fallback TTL if a token response is missing/has an
// unparseable `expires_in` - well under the documented ~1-hour lifetime.
const FALLBACK_TOKEN_TTL_MS = 10 * 60_000;

// Request-scoped credential store. In gateway mode the HTTP layer runs each
// request inside runWithCredentials({clientId, clientSecret}); getCredentials()
// reads from it. Falls back to process.env for stdio/single-tenant mode.
const credStore = new AsyncLocalStorage<PrintixCredentials>();

export function runWithCredentials<T>(creds: PrintixCredentials, fn: () => T): T {
  return credStore.run(creds, fn);
}

export function getCredentials(): PrintixCredentials | null {
  const scoped = credStore.getStore();
  if (scoped?.clientId && scoped?.clientSecret) return scoped;
  const clientId = process.env.PRINTIX_CLIENT_ID;
  const clientSecret = process.env.PRINTIX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    logger.warn('Missing credentials', { hasClientId: !!clientId, hasClientSecret: !!clientSecret });
    return null;
  }
  return { clientId, clientSecret };
}

/** Thrown when the vendor API rejects the current access token - triggers exactly one refresh-and-retry in withAccessToken(). */
export class PrintixAuthError extends Error {}

/** Thrown for any other non-2xx / unexpected vendor response. */
export class PrintixApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

interface TokenState {
  accessToken: string;
  expireAt: number; // epoch ms
}

// Keyed by the FULL credential pair (clientId, clientSecret) so multiple
// tenants sharing one gateway process (AsyncLocalStorage swaps credentials
// per request) never cross-pollinate cached access tokens or resolved
// tenant IDs. JSON.stringify (not a colon-join) so a delimiter character
// inside either credential value can never collapse two distinct tenants
// onto the same cache key - Printix's docs don't constrain the charset of
// client_id/client_secret, so that's a live possibility on a secret cache
// shared across tenants.
const tokenCache = new Map<string, TokenState>();
const tenantIdCache = new Map<string, string>();

function cacheKeyFor(creds: PrintixCredentials): string {
  return JSON.stringify([creds.clientId, creds.clientSecret]);
}

/**
 * Exchange client_id/client_secret for a short-lived OAuth access token via
 * POST /oauth/token (grant_type=client_credentials, form-urlencoded body
 * carrying client_id and client_secret - NOT HTTP Basic auth, per Printix's
 * documented curl example). A 2xx response with no `access_token` is
 * treated as invalid credentials, same as any non-2xx. Printix's docs
 * (2024-12-17 update) state refresh tokens are "no longer supported", so
 * there is no separate refresh path - re-authenticating with
 * client_id/client_secret is how a stale token is replaced, same as a
 * first-time exchange.
 */
export async function requestAccessToken(creds: PrintixCredentials): Promise<TokenState> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const res = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 400 || res.status === 403) {
      throw new PrintixAuthError(`Printix rejected the client ID/secret (HTTP ${res.status})`);
    }
    throw new PrintixApiError(`Printix oauth/token failed: HTTP ${res.status}`, res.status);
  }

  const data = (await res.json()) as OAuthTokenResponse;
  if (!data.access_token) {
    throw new PrintixAuthError(
      `Printix rejected credentials: ${data.error_description || data.error || 'no access_token returned'}`
    );
  }

  const ttlMs = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in * 1000 : NaN;
  return {
    accessToken: data.access_token,
    expireAt: Number.isFinite(ttlMs) ? Date.now() + ttlMs : Date.now() + FALLBACK_TOKEN_TTL_MS,
  };
}

async function getAccessToken(creds: PrintixCredentials, forceRefresh = false): Promise<string> {
  const key = cacheKeyFor(creds);
  const cached = tokenCache.get(key);
  if (!forceRefresh && cached && cached.expireAt - REFRESH_SKEW_MS > Date.now()) {
    return cached.accessToken;
  }
  const fresh = await requestAccessToken(creds);
  tokenCache.set(key, fresh);
  return fresh.accessToken;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Runs `fn` with a fresh/cached access token, and retries it exactly once
 * with a forced refresh if `fn` throws PrintixAuthError (the vendor
 * rejected the token as expired/invalid mid-call). request() below
 * translates a 401/403 response directly into PrintixAuthError so every
 * real API call in this file goes through this wrapper and the refresh
 * logic lives in one place.
 */
async function withAccessToken<T>(
  creds: PrintixCredentials,
  fn: (headers: Record<string, string>) => Promise<T>
): Promise<T> {
  const token = await getAccessToken(creds);
  try {
    return await fn(authHeaders(token));
  } catch (err) {
    if (err instanceof PrintixAuthError) {
      logger.warn('Access token rejected mid-call, refreshing and retrying once');
      const refreshed = await getAccessToken(creds, true);
      return await fn(authHeaders(refreshed));
    }
    throw err;
  }
}

function buildQuery(params: object): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function request<T>(
  path: string,
  headers: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { ...headers, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 401 || res.status === 403) {
    throw new PrintixAuthError(`Printix rejected the access token (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PrintixApiError(`Printix GET ${path} failed: HTTP ${res.status}${text ? ` - ${text.slice(0, 300)}` : ''}`, res.status);
  }
  return (await res.json()) as T;
}

const TENANT_HREF_RE = /\/tenants\/([^/?]+)/;

function findTenantLink(root: PrintixRootResponse): PrintixLink | null {
  const links = root._links;
  if (!links) return null;
  for (const value of Object.values(links)) {
    const candidates = Array.isArray(value) ? value : [value];
    for (const link of candidates) {
      if (link?.href && TENANT_HREF_RE.test(link.href)) return link;
    }
  }
  return null;
}

/**
 * Resolves the tenant this credential pair is scoped to by fetching the API
 * root (GET /cloudprint), the documented HATEOAS entry point that "returns
 * a list of links to accessible tenants". Credentials are issued per-tenant
 * through the Printix Administrator dashboard, so in practice exactly one
 * tenant link is accessible per client_id/client_secret pair - this takes
 * the first `_links` entry whose href matches `/tenants/{id}` (the docs
 * give no worked example of the exact relation name, so the match is on
 * href shape rather than a specific rel key).
 */
export async function resolveTenantId(creds: PrintixCredentials): Promise<string> {
  const cacheKey = cacheKeyFor(creds);
  const cached = tenantIdCache.get(cacheKey);
  if (cached) return cached;

  const root = await withAccessToken(creds, (headers) => request<PrintixRootResponse>('/cloudprint', headers));
  const tenantLink = findTenantLink(root);
  const match = tenantLink ? TENANT_HREF_RE.exec(tenantLink.href) : null;
  if (!match) {
    throw new PrintixApiError('Printix root request returned no accessible tenant link.');
  }
  const tenantId = match[1];
  tenantIdCache.set(cacheKey, tenantId);
  return tenantId;
}

/** Root request (GET /cloudprint) with the resolved tenant's link, for tenant metadata lookups. */
export async function getTenant(creds: PrintixCredentials): Promise<{ tenantId: string; link: PrintixLink }> {
  const root = await withAccessToken(creds, (headers) => request<PrintixRootResponse>('/cloudprint', headers));
  const tenantLink = findTenantLink(root);
  const match = tenantLink ? TENANT_HREF_RE.exec(tenantLink.href) : null;
  if (!tenantLink || !match) {
    throw new PrintixApiError('Printix root request returned no accessible tenant link.');
  }
  const cacheKey = cacheKeyFor(creds);
  tenantIdCache.set(cacheKey, match[1]);
  return { tenantId: match[1], link: tenantLink };
}

async function tenantScopedRequest<T>(
  creds: PrintixCredentials,
  resourcePath: string,
): Promise<T> {
  const tenantId = await resolveTenantId(creds);
  return withAccessToken(creds, (headers) =>
    request<T>(`/cloudprint/tenants/${encodeURIComponent(tenantId)}${resourcePath}`, headers)
  );
}

// ---------------------------------------------------------------------
// Printers / Queues
// ---------------------------------------------------------------------

/** GET /tenants/{tenantId}/printers - list print queues, optionally filtered/paged. */
export async function listPrinters(creds: PrintixCredentials, params: PrintixListParams = {}): Promise<PrintixPrintersResponse> {
  return tenantScopedRequest(creds, `/printers${buildQuery(params)}`);
}

/** GET /tenants/{tenantId}/printers/{printerId} - a single printer/queue's properties. */
export async function getPrinter(creds: PrintixCredentials, printerId: string): Promise<PrintixPrinter> {
  return tenantScopedRequest(creds, `/printers/${encodeURIComponent(printerId)}`);
}

// ---------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------

/** GET /tenants/{tenantId}/sites - query sites (physical locations), paged. */
export async function listSites(creds: PrintixCredentials, params: PrintixListParams = {}): Promise<PrintixSitesResponse> {
  return tenantScopedRequest(creds, `/sites${buildQuery(params)}`);
}

/** GET /tenants/{tenantId}/sites/{siteId} - a single site's details. */
export async function getSite(creds: PrintixCredentials, siteId: string): Promise<PrintixSite> {
  return tenantScopedRequest(creds, `/sites/${encodeURIComponent(siteId)}`);
}

// ---------------------------------------------------------------------
// Workstations
// ---------------------------------------------------------------------

/** GET /tenants/{tenantId}/workstations - query workstation monitoring data, paged. */
export async function listWorkstations(creds: PrintixCredentials, params: PrintixListParams = {}): Promise<PrintixWorkstationsResponse> {
  return tenantScopedRequest(creds, `/workstations${buildQuery(params)}`);
}

/** GET /tenants/{tenantId}/workstations/{workstationId} - a single workstation's details. */
export async function getWorkstation(creds: PrintixCredentials, workstationId: string): Promise<PrintixWorkstation> {
  return tenantScopedRequest(creds, `/workstations/${encodeURIComponent(workstationId)}`);
}

// ---------------------------------------------------------------------
// Users (read-only in this v1 surface - see README Scope)
// ---------------------------------------------------------------------

/** GET /tenants/{tenantId}/users - list users, optionally filtered by query/role, paged. */
export async function listUsers(
  creds: PrintixCredentials,
  params: PrintixListParams & { role?: string } = {}
): Promise<PrintixUsersResponse> {
  return tenantScopedRequest(creds, `/users${buildQuery(params)}`);
}

/** GET /tenants/{tenantId}/users/{userId} - find a single user by ID. */
export async function getUser(creds: PrintixCredentials, userId: string): Promise<PrintixUser> {
  return tenantScopedRequest(creds, `/users/${encodeURIComponent(userId)}`);
}

// ---------------------------------------------------------------------
// Groups (read-only in this v1 surface - see README Scope)
// ---------------------------------------------------------------------

/** GET /tenants/{tenantId}/groups - list/search groups, paged. */
export async function listGroups(creds: PrintixCredentials, params: PrintixListParams = {}): Promise<PrintixGroupsResponse> {
  return tenantScopedRequest(creds, `/groups${buildQuery(params)}`);
}

/** GET /tenants/{tenantId}/groups/{groupId} - fetch a single group's details. */
export async function getGroup(creds: PrintixCredentials, groupId: string): Promise<PrintixGroup> {
  return tenantScopedRequest(creds, `/groups/${encodeURIComponent(groupId)}`);
}
