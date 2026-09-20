# Printix MCP Server

MCP server for [Printix](https://www.printix.net)'s Cloud Print API (now part of Tungsten Automation) - printer/queue, site, workstation, and read-only user/group lookups - for AI assistants and the WYRE Conduit gateway.

## Authentication

Printix issues a `client_id`/`client_secret` pair **per tenant**, obtained through the Printix Administrator dashboard - there is no single WYRE-level integration credential; each MSP-managed customer tenant supplies its own pair, and only one pair is active per tenant at a time (issuing a new one invalidates the previous pair).

The pair is exchanged for a short-lived (~1-hour) OAuth access token via `POST https://auth.printix.net/oauth/token` (`grant_type=client_credentials`, `client_id`/`client_secret` in a form body). This server handles that exchange internally, and re-authenticates the same way when a token expires or is rejected - **Printix does not support refresh tokens** (removed 2024-12-17; the docs describe the prior refresh-token approach as "not standard OAuth2").

Callers only ever need to supply the two long-lived values below - not the short-lived access token.

Every resource in Printix's Cloud Print API is scoped under a tenant path (`/cloudprint/tenants/{tenantId}/...`). This server resolves the tenant ID once per credential pair by calling the API root (`GET /cloudprint`, the documented HATEOAS entry point that "returns a list of links to accessible tenants") and caching it alongside the access token.

## Configuration

| Env var | Description |
|---|---|
| `PRINTIX_CLIENT_ID` | Client ID from the Printix Administrator dashboard. |
| `PRINTIX_CLIENT_SECRET` | Client secret paired with the client ID. |
| `MCP_TRANSPORT` | `stdio` (default) or `http`. |
| `AUTH_MODE` | `env` (default, reads the vars above) or `gateway` (credentials arrive per-request via `X-Printix-*` headers, injected by the Conduit gateway). |
| `CONDUIT_S2S_SECRET` | When set, the HTTP transport requires a valid `X-Gateway-S2S` header (Conduit sidecar auth) on every `/mcp` request. |
| `LOG_LEVEL` | `debug` \| `info` (default) \| `warn` \| `error`. |

## Tools

### Tenant
- `printix_get_tenant` - get the tenant this credential pair is scoped to (tenant ID and its API root link).

### Printers / Queues
- `printix_list_printers` - list print queues/printers, optionally filtered and paged.
- `printix_get_printer` - get a single printer/queue and its properties/capabilities.

### Sites
- `printix_list_sites` - list sites (physical locations), paged.
- `printix_get_site` - get a single site's details.

### Workstations
- `printix_list_workstations` - list workstation monitoring data, paged.
- `printix_get_workstation` - get a single workstation's details.

### Users (read-only)
- `printix_list_users` - list users, optionally filtered by query/role, paged.
- `printix_get_user` - find a single user by ID.

### Groups (read-only)
- `printix_list_groups` - list/search groups, paged.
- `printix_get_group` - fetch a single group's details.

## Scope

This is a v1 surface covering the MSP fleet-monitoring/admin value of Printix's Cloud Print API, not end-user print-job workflow. Explicitly out of scope for now:

- **Print Jobs** (submit/retrieve/delete) - end-user print workflow, not MSP admin value.
- **Cards** (register/search/delete) - a niche auth-card identity feature.
- **Networks** and **SNMP Configurations** - provisioning-heavy, higher-risk write surfaces.
- **User and group mutation** (create/delete) - real account-management consequences (licensing, access removal); only read (list/get) is exposed for both. Worth a deliberate separate decision later.

They can be added as a follow-up once there's a clear MSP workflow need.

This server was built against the **Cloud Print API** (`printix.github.io`), not the narrower **Partner API** (`printix.bitbucket.io`), which is scoped to tenant provisioning rather than day-to-day fleet management.

## Development

```bash
npm install
npm run build
npm test
npm run lint   # tsc --noEmit
```

## Docker

```bash
docker build -t printix-mcp .
docker run -p 8080:8080 \
  -e PRINTIX_CLIENT_ID=... \
  -e PRINTIX_CLIENT_SECRET=... \
  printix-mcp
```
