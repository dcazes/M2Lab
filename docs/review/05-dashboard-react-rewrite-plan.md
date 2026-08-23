# 05 — Dashboard React Rewrite Plan

> Status: **approved plan, awaiting build start**
> Companion research: [`dashboard-ui-trends-research.md`](./dashboard-ui-trends-research.md) (design trends, stack versions, log-viewer checklist — consulted for everything below)

## 1. Goal & constraints

Build a React SPA that replaces the retired ctl-web UI as the *functional* dashboard of this homelab, while **leaving the existing Homepage (gethomepage.dev) completely untouched**. Both live side by side:

| Door | Serves | Changes? |
|---|---|---|
| Tailscale root `:443` | Homepage (loopback `8083`) | **No changes ever** |
| Tailscale `:8460` (new) | React SPA + its API (loopback `8787`) | New |

Hard rules inherited from AGENTS.md: loopback-only binds, Tailscale Serve is the only public door, no new Docker networks, CI gates (gitleaks/yamllint/trivy) must stay green.

### Locked decisions (user-approved)

1. **Backend = revive `ctl/app.py` FastAPI** (:8787). No Portainer-proxy calls from the new UI.
2. **Design = designer freedom**, grounded in the companion trend research.
3. **Scope v1 = feature parity + natural upgrades** (inline logs instead of Portainer link, service detail drawer, live status).

## 2. Current state inventory (verified 2026-08-22)

- `ctl/app.py` (180 lines) — full API, healthy, unauthenticated. Endpoints in §5.
- `ctl/registry.py` — loads `services.yaml` → `SETTINGS`, `SERVICES`; compose runner with overlay support (`compose_files:`).
- `ctl-web/index.html` — 15-line redirect page to Homepage. Will remain as fallback.
- `deploy/homelab-ctl.service` — systemd user unit: `WorkingDirectory=~/Desktop/Programs/HomeServer`, `ExecStart=.venv/bin/python -m ctl.app`. Already running the API today.
- `services.yaml` — 16 services. `settings.dashboard_port: 8787`, `settings.tailnet_base: https://home.taile2cc7a.ts.net`.
- Homepage config (`homepage/config/*`) — read-only reference for parity inventory (§4). Never edited by this project except the optional tile in D6.
- Git baseline: `main` == `origin/main`, clean tree.

### Known backend deficiencies (fixed in Phase 0)

- `GET /api/services` runs up to 16 serial HTTP health probes × 2s timeout → multi-second responses. Must parallelize + cache.
- `/api/system` lacks uptime/load.
- Static mount points at `ctl-web/` (redirect page) — must point at the new build output.

## 3. Architecture

```
Browser (tailnet device)
   │  https://home.taile2cc7a.ts.net:8460
   ▼
Tailscale Serve ──► http://127.0.0.1:8787   (uvicorn, systemd user unit homelab-ctl)
                        ├─ /api/*            FastAPI routes (existing + Phase 0 additions)
                        └─ /*                static files: ctl-web-next/dist  ← built SPA
```

- **Same origin** → zero CORS anywhere. SSE works without proxy hacks.
- SPA has **no client-side router** (tabs are component state) → plain `StaticFiles(html=True)` mount suffices; no history-fallback needed.
- Deploy model: build locally, **commit `dist/`**, host does `git pull` + unit restart. Node never installed on server.
- Rollback = `git revert` + restart; old redirect page stays in tree as fallback.

## 4. Feature parity inventory

Source of truth for "same functionality" = what Homepage + `custom.js` do today.

| # | Today (Homepage) | New React version | Backend |
|---|---|---|---|
| P1 | Service tiles grouped Media/Productivity/AI & Research/Infrastructure | Same 4 groups, mapped from `category` (table below) | `GET /api/services` |
| P2 | Status dot per card (green/red/yellow/grey) | Same colors + richer: container count, HTTP-health badge, per-container rows in detail drawer | same |
| P3 | Start/Stop/Restart/Update buttons w/ confirm() | Icon buttons w/ pending→success→error states, toast feedback, typed destroy dialog | `POST /api/services/{id}/{action}`, `/destroy` |
| P4 | Logs button → opens Portainer tab | **Inline log viewer** (SSE follow, virtualized, level filters, pause/search) | `GET /api/services/{id}/logs` |
| P5 | Resources widget: CPU/Mem/Disk/Uptime | Gauge strip + client-side sparklines (5-min ring buffer) | `GET /api/system` (+uptime added P0) |
| P6 | Header clock + weather (open-meteo) | Same; open-meteo is CORS-friendly, fetched client-side | none |
| P7 | DDG search bar | Same (opens `https://duckduckgo.com/?q=` new tab) | none |
| P8 | Bookmarks + Links tabs | Explore tab: bookmarks grid + repo links | static TS data file |
| P9 | GitHub stars widget, TechCrunch RSS | **Cut** (decision D2 default: cut; RSS would need a CORS proxy) | — |
| P10 | Tabs: Services / System / Explore | Same IA | — |
| P11 | (none) | Natural upgrade: typed destroy confirm (`confirm:"<id>"`) | existing endpoint |

### Category → group mapping (from services.yaml, verified)

| UI group | categories | services |
|---|---|---|
| Media | `photos` | immich |
| Productivity | `productivity` | mealie, actual-budget, paperless-ngx, adventurelog, nextcloud |
| AI & Research | `ai`, `research`, `graph` | litellm, ollama, open-webui, firecrawl, surfsense, puppygraph |
| Infrastructure | `infra`, `security` | homepage, beszel, portainer, vaultwarden |

Group order fixed as above. Unknown categories → "Other" group appended last.

## 5. API contracts (exact, from ctl/app.py — frontend codes against these)

### GET /api/services
```jsonc
{
  "services": [{
    "id": "immich",            // == compose project name
    "display_name": "Immich",
    "description": "Photo library",
    "category": "photos",      // see mapping §4
    "icon": "📷",              // emoji fallback; real icons vendored client-side
    "port": 2283,
    "url": "http://localhost:2283",                       // use when browsing from host
    "tailnet_url": "https://home.taile2cc7a.ts.net:8443/",// use when source != local
    "state": "running",        // running | stopped | degraded | absent
    "containers": [{ "container": "immich_server", "service": "server",
                     "state": "running", "health": "healthy" }], // health may be null
    "healthy": true            // bool | null (null = no http health mode)
  }],
  "source": "tailnet"          // local | tailnet | other:<ip>
}
```

### POST /api/services/{sid}/{action} — action ∈ `up | stop | restart | pull | update`
```jsonc
// 200 or 500
{ "ok": true, "output": "<last 8000 chars of compose output>" }
```

### POST /api/services/{sid}/destroy — body must be `{"confirm":"<sid>"}`
```jsonc
{ "ok": true, "output": "<last 4000 chars>" }   // 400 if confirm mismatch
```

### GET /api/services/{sid}/logs?tail=200&follow=true → text/event-stream
```
event: meta
data: {"container": "immich_server"}          // once per container, in order

data: {"c": "immich_server", "line": "..." }  // repeated; stream ends when all containers' streams end
```

### GET /api/system
```jsonc
{ "cpu_percent": 12.3,
  "mem": { "total": 0, "available": 0, "percent": 0, "used": 0, "free": 0 },
  "disk": { "total": 0, "used": 0, "percent": 0 },
  "docker_ok": true }
// Phase 0 adds: "uptime_seconds": 0, "load_avg": [0.1, 0.2, 0.3]
```

## 6. Stack (versions per companion research; pin exact at scaffold time)

| Layer | Choice |
|---|---|
| Build | Vite (latest stable) + TypeScript `strict` |
| UI | React 19, Tailwind CSS v4, shadcn/ui, lucide-react |
| Data | TanStack Query v5 (`refetchInterval`: services 15s, system 5s) |
| Motion | motion (Framer Motion 12) |
| Logs | native `EventSource` + react-virtuoso |
| Toasts | sonner |
| Fonts | `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` (self-hosted) |
| Icons | service logos vendored from walkxcode/dashboard-icons into `public/icons/<id>.png`; emoji `icon` field as fallback |
| Package mgr | npm only (no pnpm/yarn); Node ≥ 20 LTS |

## 7. Design direction & tokens (@designer owns interpretation)

From research brief: bento-grid, near-black surfaces, ONE semantic accent used sparingly, glass only on overlays/sticky nav, status-first quiet design (nothing pulses unless something is wrong), 150–300ms micro-interactions honoring `prefers-reduced-motion`.

Starting tokens (designer may revise before Phase 2):

```css
--bg-base:   #0B0F14;   /* page */
--surface-1: #0F1419;   /* cards */
--surface-2: #161C24;   /* hover / raised */
--border:    rgba(255,255,255,0.08);
--accent:    #14b8a6;   /* teal-500 — healthy/primary/active ONLY */
--ok:        #3fb950;  --warn: #d29922;  --err: #f85149;  --unknown: #8b949e;
/* status palette intentionally matches custom.js today for continuity */
--font-ui: Inter Variable;  --font-mono: JetBrains Mono Variable (tabular-nums for metrics/logs);
--radius-card: 12px;  --radius-btn: 8px;  spacing on 8pt grid;
motion: 150–300ms cubic-bezier(0.4, 0, 0.2, 1); no springs/bounce;
grid: services auto-fill minmax(280px, 1fr); system strip spans full width (hero row).
```

References to steal from: shadcn dashboard blocks (tile anatomy), Cordum design language (status-first, accent discipline), Glance (information density). Full checklist for the log viewer: research doc §4.

## 8. Repo layout (all new files)

```
ctl-web-next/
├── package.json  vite.config.ts  tsconfig.json  index.html
├── dist/                      # committed build output (deploy artifact)
├── public/icons/<id>.png      # ~16 vendored service logos
└── src/
    ├── main.tsx  App.tsx
    ├── lib/
    │   ├── api.ts             # typed fetch wrappers (§5 shapes)
    │   ├── types.ts           # Service, SystemStats, LogEvent …
    │   ├── sse.ts             # EventSource helper w/ reconnect backoff
    │   └── format.ts          # bytes, uptime, relative time
    ├── hooks/
    │   ├── useServices.ts     # ['services'], 15s
    │   ├── useSystem.ts       # ['system'], 5s + sparkline ring buffer (60 pts)
    │   ├── useServiceLogs.ts  # per-sid EventSource, pause/resume
    │   ├── useClock.ts  useWeather.ts
    ├── components/
    │   ├── layout/AppShell.tsx HeaderBar.tsx TabNav.tsx
    │   ├── services/GroupSection.tsx ServiceCard.tsx StatusDot.tsx
    │   │         ActionRow.tsx DestroyDialog.tsx ServiceDrawer.tsx ContainerTable.tsx
    │   ├── logs/LogViewer.tsx LogRow.tsx LevelChips.tsx
    │   ├── system/SystemStrip.tsx GaugeCard.tsx Sparkline.tsx
    │   ├── explore/BookmarksGrid.tsx SearchBar.tsx WeatherWidget.tsx
    │   └── ui/                # shadcn generated
    └── data/bookmarks.ts      # mirrors homepage/config/bookmarks.yaml content
```

Modified existing files (complete list — nothing else may change):

| File | Change |
|---|---|
| `ctl/app.py` | Phase 0 items below (~40 lines) |
| `.gitignore` | add `ctl-web-next/node_modules/` |
| `Makefile` | add `dashboard-install`, `dashboard-build`, `dashboard-dev` targets |
| `docs/ADDING_APPS.md` | append `8460 ctl dashboard` to used-ports list |
| `docs/SETUP.md` | add tailscale serve line + dashboard section |

### Makefile additions
```make
dashboard-install:  ; cd ctl-web-next && npm ci
dashboard-build:    ; cd ctl-web-next && npm run build
dashboard-dev:      ; cd ctl-web-next && npm run dev   # proxies /api -> 127.0.0.1:8787
```

### vite.config.ts essentials
```ts
server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } } },
build:  { outDir: 'dist' }
```

## 9. Phase 0 — backend fixes (spec)

All in `ctl/app.py`, backward-compatible:

1. **Parallel health checks**: wrap `http_health` in `loop.run_in_executor(None, ...)`, fan out with `asyncio.gather` over services; make `list_services` async. Add module-level `{sid: (result, timestamp)}` cache, TTL 10s, so 15s polling never re-probes hot.
2. **`/api/system` additions**: `"uptime_seconds": time.time() - psutil.boot_time()`, `"load_avg": list(os.getloadavg())`.
3. **Static mount switch**:
   ```python
   dist = ROOT / "ctl-web-next" / "dist"
   web_dir = dist if dist.is_dir() else ROOT / "ctl-web"
   app.mount("/", StaticFiles(directory=str(web_dir), html=True), name="web")
   ```
4. **Optional auth (decision D1, default: yes)**: `CTL_TOKEN` env var; FastAPI dependency on mutating routes only (`destroy` + `action`) checking `Authorization: Bearer <token>`; 401 otherwise. When env unset → open (current behavior). UI shows one-time token modal on 401, stores in `localStorage['hs-ctl-token']`.

**Acceptance**: `curl -s localhost:8787/api/services | jq '.services | length'` == 16; warm response < 300ms (time it); actions still work via `python3 ctl/registry.py status` unaffected; `yamllint . && gitleaks detect --no-banner` clean.

## 10. Phases 1–6

| Phase | Content | Owner | Acceptance gate |
|---|---|---|---|
| **1 Scaffold & shell** | Init Vite app per §8; Tailwind v4 + shadcn init; fonts; AppShell + TabNav + HeaderBar (clock/weather/search stubs); theme tokens §7; dev proxy verified against live API | @fixer (scaffold) after @designer confirms tokens | `npm run build` clean; dev server renders shell with real `/api/services` JSON in a placeholder |
| **2 Service grid** | GroupSection/ServiceCard/StatusDot/ActionRow/DestroyDialog/ServiceDrawer+ContainerTable; URL logic: `source=="local"` ? `url` : `tailnet_url`; toasts; optimistic pending states | @designer visuals → @fixer wiring | All 16 tiles correct groups/states; start/stop/restart/update verified against test target (D5, default firecrawl); destroy dialog requires typing service id |
| **3 Log viewer** | EventSource hook w/ reconnect; virtualized rows; level detection (`ERROR/FATAL`→err, `WARN`→warn, `DEBUG/TRACE`→muted, else info); level chips w/ counts; autoscroll-follow w/ jump-to-bottom + pause; search highlight (`useDeferredValue`); wrap toggle; copy line | @fixer | 30-min soak following immich logs: no freeze, memory flat, reconnect survives `docker restart immich` |
| **4 System & Explore** | SystemStrip gauges + sparklines (60-pt ring @5s); uptime + load display; docker_ok badge; BookmarksGrid from data file; WeatherWidget (open-meteo, coords D3 default 40.71/-74.00); SearchBar | @fixer | CPU/mem/disk within ±2% of `htop`/`df -h /`; weather renders or graceful error card |
| **5 Design polish** | Entrance stagger, skeletons, empty/error states per card, responsive (single column < 640px), focus-visible rings, reduced-motion pass, icon polish | @designer | User visual sign-off screenshot review |
| **6 Deploy & docs** | Commit dist; Makefile targets; on host: `git pull && systemctl --user restart homelab-ctl`; `sudo tailscale serve --bg --https=8460 http://127.0.0.1:8787`; update ADDING_APPS.md ports + SETUP.md runbook | @fixer | Reachable from second tailnet device; Homepage root :443 untouched and loading; CI green (`yamllint .`, `gitleaks detect --no-banner`, trivy) |

Parallelization: Phase 0 (backend) and Phase 1 scaffold are independent → run concurrently. Phases 2–4 sequential after 1. Phase 5 after 4. Phase 6 last.

## 11. Open decisions (defaults apply unless overridden)

| ID | Decision | Default |
|---|---|---|
| D1 | Bearer token on mutating routes | **Yes** — generate `CTL_TOKEN`, add to `.env` pattern (gitignored), ship `.env.example` entry |
| D2 | GitHub stars + RSS widgets | **Cut both** |
| D3 | Weather coordinates | Reuse Homepage's (40.7128, −74.0060) until user supplies real location |
| D4 | Theme | Dark-only v1 (light theme deferred) |
| D5 | Test target for destructive-action verification | firecrawl (least critical, fast restart) |
| D6 | Add "Dashboard" tile to Homepage linking :8460 | Deferred — user opts in later; violates "homepage untouched" until then |

## 12. Risks & rollback

- **Unauthenticated control plane**: mitigated by tailnet-only exposure + D1 token. Tracked already in `02-critique.md` context.
- **Committed `dist/`**: unusual but deliberate — keeps server Node-free; gitleaks/trivy scan it harmlessly.
- **SSE through Tailscale Serve**: known-good (plain HTTP streaming); if buffering appears, add `X-Accel-Buffering: no` (already set by app.py).
- **Rollback**: revert commits, `systemctl --user restart homelab-ctl`, optionally `sudo tailscale serve --https=8460 off`. Homepage never touched.

## 13. Verification summary (repo has no test suite)

Per phase gates above, plus pre-push: `yamllint . && gitleaks detect --no-banner`; after any stack touch: `python3 ctl/registry.py status`; compose validation not applicable (no new containers). Final E2E: second-device walkthrough of every P1–P8 row in §4.
