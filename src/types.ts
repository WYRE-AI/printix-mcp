/**
 * Long-lived credentials issued out-of-band, per tenant, through the Printix
 * Administrator dashboard (docs: printix.github.io, "The client ID and
 * secret necessary to authenticate with the API can be obtained through the
 * Printix Administrator dashboard"). Each MSP-managed customer tenant has
 * its own client_id/client_secret pair - there is no single WYRE-level
 * integration credential, and only one credential set is active per tenant
 * at a time (creating a new one invalidates the previous pair). Exchanged
 * for a short-lived OAuth access token at POST /oauth/token. See client.ts.
 */
export interface PrintixCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Response body of POST /oauth/token (OAuth2 client_credentials shape).
 * Printix's docs (2024-12-17 update) explicitly state refresh tokens are
 * "no longer supported" - a fresh client_id/client_secret exchange is the
 * only way to get a new access token, same as when one merely expires.
 */
export interface OAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** A HAL link as used throughout Printix's Cloud Print API response envelopes. */
export interface PrintixLink {
  href: string;
  templated?: boolean;
  [key: string]: unknown;
}

/**
 * Body of the root request (GET /cloudprint), the API's HATEOAS entry
 * point. Printix's docs describe it only as returning "a list of links to
 * accessible tenants" with no worked example - resolveTenantId() in
 * client.ts scans `_links` for the first href matching `/tenants/{id}` and
 * treats that as the tenant this credential pair is scoped to (a
 * per-tenant client_id/client_secret has exactly one accessible tenant in
 * practice).
 */
export interface PrintixRootResponse {
  _links?: Record<string, PrintixLink | PrintixLink[]>;
  [key: string]: unknown;
}

/** Common paging envelope Printix's list endpoints wrap results in. */
export interface PrintixPage {
  size?: number;
  totalElements?: number;
  totalPages?: number;
  number?: number;
}

export interface PrintixListParams {
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface PrintixPrinter {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface PrintixPrintersResponse {
  success?: boolean;
  message?: string;
  printers?: PrintixPrinter[];
  page?: PrintixPage;
  _links?: Record<string, PrintixLink | PrintixLink[]>;
  [key: string]: unknown;
}

export interface PrintixSite {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface PrintixSitesResponse {
  success?: boolean;
  message?: string;
  sites?: PrintixSite[];
  page?: PrintixPage;
  [key: string]: unknown;
}

export interface PrintixWorkstation {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface PrintixWorkstationsResponse {
  success?: boolean;
  message?: string;
  workstations?: PrintixWorkstation[];
  page?: PrintixPage;
  [key: string]: unknown;
}

export interface PrintixUser {
  id?: string;
  email?: string;
  fullName?: string;
  role?: string;
  [key: string]: unknown;
}

export interface PrintixUsersResponse {
  success?: boolean;
  message?: string;
  users?: PrintixUser[];
  page?: PrintixPage;
  [key: string]: unknown;
}

export interface PrintixGroup {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface PrintixGroupsResponse {
  success?: boolean;
  message?: string;
  groups?: PrintixGroup[];
  page?: PrintixPage;
  [key: string]: unknown;
}
