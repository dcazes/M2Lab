# Federated MCP operations

M2Lab treats an application and its MCP integration as separate health domains. A running app can legitimately report `authentication_required` or `unavailable` for MCP without being rolled back.

## Sources of truth

- `catalog.yaml` contains reviewed MCP manifests, provenance, authentication requirements, minimum tool risks, and harness compatibility.
- `.state/mcp-overrides.json` contains local enablement, context, harness exposure, and stricter policy overrides. It is mode `0600` and gitignored.
- `.state/mcp-harnesses/` contains generated, secret-free OpenCode and Open WebUI profiles. Credentials are environment-variable references, never values.
- `/api/mcp/servers?verify=true` is the runtime truth. Catalog capabilities are never presented as live unless their endpoint verifies.

## Security invariants

- Official/native servers are preferred. Community servers require a pinned version and remain disabled until explicitly reviewed.
- Overrides may make risk stricter but never weaker than the tracked manifest.
- Endpoint, schema, and authentication-header edits are not accepted through the dashboard.
- Vaultwarden remains human-controlled and exposes no MCP tools.
- MCP mutations use the same two-minute approval tokens and audit trail as service lifecycle actions.

## Harness synchronization

Settings → MCP → **Sync harnesses** writes managed profiles without overwriting user-owned harness configuration. OpenCode consumes the remote server map; Open WebUI consumes Streamable HTTP connection records. Import/apply automation can be added per harness once its admin API and dedicated credential have been configured.

## Adding an adapter

Use a documented public API, a dedicated least-privilege credential, and an isolated HTTP MCP process. Add read-only tools first. The server must enumerate successfully before its tools become discoverable through `discover_app_capabilities`; database and private storage coupling are prohibited.
