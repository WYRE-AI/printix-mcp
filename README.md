# Printix MCP Server

MCP server for [Printix](https://www.printix.net)'s Cloud Print API (now part of Tungsten Automation) - printer/queue, site, workstation, and read-only user/group lookups - for AI assistants and the WYRE Conduit gateway.

## Authentication

Printix issues a `client_id`/`client_secret` pair **per tenant**, obtained through the Printix Administrator dashboard - there is no single WYRE-level integration credential; each MSP-managed customer tenant supplies its own pair, and only one pair is active per tenant at a time (issuing a new one invalidates the previous pair).

The pair is exchanged for a short-lived (~1-hour) OAuth access token via `POST https://auth.printix.net/oauth/token` (`grant_type=client_credentials`, `client_id`/`client_secret` in a form body). This server handles that exchange internally, and re-authenticates the same way when a token expires or is rejected - **Printix does not support refresh tokens** (removed 2024-12-17; the docs describe the prior refresh-token approach as "not standard OAuth2").

Callers only ever need to supply the two long-lived values below - not the short-lived access token.

Every resource in Printix's Cloud Print API is scoped under a tenant path (`/cloudprint/tenants/{tenantId}/...`). This server resolves the tenant ID once per credential pair by calling the API root (`GET /cloudprint`, the documented HATEOAS entry point that "returns a list of links to accessible tenants") and caching it alongside the access token.

## Configuration

Copy [`.env.example`](.env.example) and set the variables below.

| Env var | Description |
|---|---|
| `PRINTIX_CLIENT_ID` | Client ID from the Printix Administrator dashboard. Used by stdio and by HTTP when `AUTH_MODE=env`. |
| `PRINTIX_CLIENT_SECRET` | Client secret paired with the client ID. Used by stdio and by HTTP when `AUTH_MODE=env`. |
| `MCP_TRANSPORT` | `stdio` (default) or `http`. |
| `AUTH_MODE` | `env` (default; reads `PRINTIX_*`) or `gateway` (credentials arrive per request on `X-Printix-Client-ID` and `X-Printix-Client-Secret` and never fall back to the environment). The Docker image and Compose file default to `gateway`. |
| `CONDUIT_S2S_SECRET` | Required to start the HTTP transport. HMAC secret checked against `X-Gateway-S2S` on `/mcp`. Generate with `openssl rand -hex 32`. If it is empty or a known placeholder (for example `replace-with-a-real-secret`), the process logs an error and exits non-zero. The value is never logged. Compose will not start when it is unset. |
| `MCP_ALLOW_INSECURE_DEV` | Set to exactly `1` only for local development to start HTTP without `CONDUIT_S2S_SECRET`. The process logs a warning, does not enforce `X-Gateway-S2S`, and binds `127.0.0.1` only. A non-loopback `MCP_HTTP_HOST` (including `0.0.0.0`) is ignored and the override is logged. A known placeholder secret is still refused. |
| `MCP_HTTP_HOST` | Bind address when a real `CONDUIT_S2S_SECRET` is set. Defaults to `127.0.0.1` when unset. The container image sets `0.0.0.0`. Without a secret, the listener is forced to `127.0.0.1`. |
| `MCP_HTTP_PORT` | HTTP port. Defaults to `8080`. |
| `LOG_LEVEL` | `debug` \| `info` (default) \| `warn` \| `error`. |

`/health` stays unauthenticated and does not read credentials. The stdio transport does not use `CONDUIT_S2S_SECRET`.

### HTTP authentication

With `MCP_TRANSPORT=http` and a real `CONDUIT_S2S_SECRET`, every `/mcp` request must include `X-Gateway-S2S`. The check is `verifyS2sHeader` in [`src/s2s-verify.ts`](src/s2s-verify.ts): the header value is `t=<unix seconds>,v1=<hex>`, where the hex is HMAC-SHA256 of the literal string `t=<unix seconds>` keyed with `CONDUIT_S2S_SECRET` (64 lowercase hex characters). The timestamp must be within 300 seconds of the server clock. A missing or invalid header is HTTP 401, before vendor credentials are read.

```bash
TS=$(date +%s)
SIG=$(printf 't=%s' "$TS" | openssl dgst -sha256 -hmac "$CONDUIT_S2S_SECRET" -hex | awk '{print $NF}')
curl -sS http://127.0.0.1:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "X-Gateway-S2S: t=${TS},v1=${SIG}" \
  -H 'X-Printix-Client-ID: your-client-id' \
  -H 'X-Printix-Client-Secret: your-client-secret' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

In `AUTH_MODE=gateway`, `/mcp` also requires `X-Printix-Client-ID` and `X-Printix-Client-Secret`. Those headers are the only credential source for that request. A request missing either header returns 401 and does not fall back to `PRINTIX_CLIENT_ID` / `PRINTIX_CLIENT_SECRET` in the process environment.

In `AUTH_MODE=env` (single-tenant HTTP), `/mcp` still requires a valid `X-Gateway-S2S` header. Vendor credentials come from `PRINTIX_CLIENT_ID` and `PRINTIX_CLIENT_SECRET`.

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

# HTTP refuses to start until CONDUIT_S2S_SECRET is set
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" npm run start:http
```

## Docker

The image listens on `0.0.0.0` inside the container (`MCP_HTTP_HOST`) and defaults to `AUTH_MODE=gateway`. Publish the port on loopback and pass the S2S secret. In gateway mode, Printix credentials arrive on each request as headers; they are not read from the environment.

```bash
# Generate the secret first: openssl rand -hex 32
docker build -t printix-mcp .
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -p 127.0.0.1:8080:8080 \
  printix-mcp
```

Compose refuses to start when `CONDUIT_S2S_SECRET` is unset. The checked-in service is gateway mode: it does not set `PRINTIX_CLIENT_ID` or `PRINTIX_CLIENT_SECRET` and does not use `env_file`, so a project `.env` cannot inject static vendor credentials into the container. It publishes `127.0.0.1:8080:8080`.

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" docker compose up
```

Single-tenant HTTP (`AUTH_MODE=env`) still requires the S2S secret, then uses `PRINTIX_CLIENT_ID` and `PRINTIX_CLIENT_SECRET`. Keep this off the gateway Compose service.

```bash
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -e AUTH_MODE=env \
  -e PRINTIX_CLIENT_ID=your-client-id \
  -e PRINTIX_CLIENT_SECRET=your-client-secret \
  -p 127.0.0.1:8080:8080 \
  printix-mcp
```

Local HTTP without a secret is development-only. It binds `127.0.0.1` only (a wider `MCP_HTTP_HOST` is overridden and logged) and logs a warning:

```bash
MCP_ALLOW_INSECURE_DEV=1 npm run start:http
```
