# Staged SSO rollout

This repository keeps public tailnet URLs stable. Caddy receives traffic on a
new loopback listener, and Tailscale Serve is moved one port at a time only
after a local preflight succeeds. The previous direct target is the rollback.

## Initial bootstrap

The normal path is **Settings → Apps → Start identity setup**. OmniLab creates
the protected env files, generates infrastructure-only credentials, starts
PostgreSQL, Authentik, Caddy, Ollama and the core services, publishes the
private Authentik URL, and shows every stage in Workspace. It pauses only for
the first owner account, MFA/passkey enrollment, and recovery codes.

The commands below are the owner recovery path, not the normal installation
experience.

1. Copy `authentik/.env.example` to `authentik/.env`, generate its two random
   values, and copy `ingress/.env.example` to `ingress/.env`.
2. Add the same `OMNILAB_INGRESS_TOKEN` to the root `.env`; leave
   `OMNILAB_REQUIRE_IDENTITY=false` during setup.
3. Start and validate the two stacks:

   ```bash
   make up SERVICE=authentik
   make up SERVICE=sso-ingress
   docker compose -f authentik/docker-compose.yml ps
   docker compose -f ingress/docker-compose.yml exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   ```

4. Route Authentik through Caddy: `scripts/sso-ingress.sh apply authentik`.
   Create the first owner, enroll MFA/passkeys, store recovery codes outside
   OmniLab, and load the `omnilab-owners` / `omnilab-members` blueprint.
5. Create the dashboard provider and Caddy outpost in Authentik. Its forward
   auth endpoint is `http://127.0.0.1:9001/outpost.goauthentik.io/auth/caddy`.
6. In a second tailnet browser, run `scripts/sso-ingress.sh apply dashboard`,
   sign in, confirm `/api/identity/status` reports the signed-in owner, then
   set `OMNILAB_REQUIRE_IDENTITY=true` in root `.env` and restart
   `homelab-ctl.service`.

Never set enforcement before the Caddy dashboard route and second-device test
pass. Roll back immediately with `scripts/sso-ingress.sh rollback dashboard`.

## Native applications

The dashboard API exposes safe inventory and reachability checks at
`/api/identity/status`, `/api/identity/apps`, and
`/api/identity/apps/<id>/verify`. It intentionally does not manufacture OAuth
configuration from guessed settings. For every native app, create an Authentik
OIDC provider with its exact current product documentation, retain one local
break-glass admin, and only then use `scripts/sso-ingress.sh apply <app>`.

SurfSense is intentionally an Authentik access-gate plus its documented local
login. Its configuration supports `LOCAL` and Google OAuth, not generic OIDC;
do not automate a password login or inject Vaultwarden credentials.

## Scope boundary

This rollout does not change MCP adapters, ToolMesh, browsers, memory, or
workflow behaviour. Service APIs and MCP endpoints remain unexposed by these
Caddy routes.
