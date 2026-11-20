# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The HTTP transport no longer exits on a malformed request (WYREAI-741).** The request
  target was parsed against the client-supplied `Host` header, and a value that does not parse
  (or a target such as `//`) threw inside the request listener before authentication. The
  target is now parsed against a fixed base, so `Host` is no longer consulted, and a target
  that still cannot be parsed gets a `400` JSON response while the server keeps running.

### Added
- Initial release: MCP server for Printix's Cloud Print API.
- Tenant tool: `printix_get_tenant` - resolves the tenant this credential pair is scoped to.
- Printer/queue tools: `printix_list_printers`, `printix_get_printer`.
- Site tools: `printix_list_sites`, `printix_get_site`.
- Workstation tools: `printix_list_workstations`, `printix_get_workstation`.
- User tools (read-only): `printix_list_users`, `printix_get_user`.
- Group tools (read-only): `printix_list_groups`, `printix_get_group`.
- Transparent OAuth2 client_credentials token exchange (`POST /oauth/token`) wrapping every tool call, with cache-key isolation per credential pair (per-tenant client_id/client_secret).
