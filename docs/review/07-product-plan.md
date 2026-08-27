# M2Lab Product Plan — Personal AI App Platform

> **Status:** active implementation direction. The catalog, progressive
> discovery API/MCP tools, lifecycle approvals, local audit trail, and
> outcome-led dashboard are implemented. Settings now unifies installed apps,
> install plans, model access, and private connections. Workspace is a compact
> operations cockpit with real system metrics, status-sorted apps,
> approval-gated commands, logs, and a user-only Nextcloud calendar. System owns
> core-service health and the audit trail. App-specific cross-app adapters
> remain staged. **Updated:** 2026-08-25.
>
> **Product thesis:** M2Lab helps people choose, install, configure, and
> safely use privacy-respecting productivity apps through the AI harness of
> their choice.

## 1. Product boundary

M2Lab is **not** another container dashboard, a model provider, or a new
general-purpose agent runtime. It is the layer that makes a curated collection
of useful apps coherent:

```text
Settings: apps, model access, connections
       │ selects/configures/deploys
       ▼
M2Lab capability gateway
  ├─ app manifests and health
  ├─ scoped MCP capabilities
  ├─ approvals and audit events
  └─ task-context broker (small, attributable task packets)
       │ standard MCP / OpenAI-compatible interfaces
       ▼
OpenCode · Open WebUI · future harnesses
       │
       ▼
Self-hosted apps and local companions
```

The durable integration boundary is **MCP**. OpenCode is the preferred first
power-user harness; Open WebUI is the preferred general-user chat harness.
Neither is a required dependency of the catalog or the policy boundary.

## 2. Settings-first setup

There are only three top-level destinations: **Workspace**, **Settings**, and
**System**. The former Initiate and Catalog pages are consolidated into
Settings so installation and configuration cannot disagree about service
state.

Settings opens on installed apps. Stopped apps remain configurable; never-
installed apps appear only under **Add apps**. Before any download, an install
plan lists dependencies, generated secrets, required user input, hardware, and
the official first-login fallback. Dependency stacks are added automatically
and one deliberate action performs the displayed plan.

Vaultwarden is first. The user creates its master account directly in the app;
M2Lab never receives that password. The user may then create a shared app
email/password for supported admin bootstrap, acknowledging the larger breach
impact of credential reuse and saving a recovery copy in Vaultwarden.

Each app uses one of three explicit actions:

| App kind | Dashboard action | Meaning |
|---|---|---|
| Self-hosted service | **Install** | M2Lab manages its declared Compose stack. |
| Local/browser companion | **Open locally** | User runs it on their own device; M2Lab does not pretend to host it. |
| Infrastructure | **Configure** | A supporting service, not an end-user destination. |

Provider choice never blocks installing a normal productivity app.

## 3. Model-provider setup

LiteLLM is the single OpenAI-compatible gateway used by apps and harnesses.
Ollama is the private/local fallback. FreeLLMAPI is an optional adapter for
legitimate provider free tiers; it is never a product promise and it must not
be used to evade provider quotas or terms.

```text
Choose model access: [ Local Ollama ] [ Provider key ] [ Later ]
Provider: NVIDIA | Google | Hugging Face | Mistral | other supported provider
Key:      paste once; store only in a gitignored secret file
```

The UI reports configuration status but never returns saved secret values to a
browser or an agent. Direct provider keys remain separate from FreeLLMAPI.
Vaultwarden stores user credentials but is never exposed to agents or MCP
tools. Ollama automatically pulls a small local embedding model for compatible
apps.

## 4. Workspace calendar and connections

Workspace never treats service actions as calendar events. Its agenda reads a
single user-selected Nextcloud calendar over CalDAV using a scoped app password
stored in local control-plane state. Lifecycle activity and approvals remain
visible only in System. Other user-owned connections may follow this explicit,
scoped pattern.

## 5. Context and progressive capability discovery

Do **not** build a standalone vector/RAG "context engine" in v1. Instead build
a small, harness-agnostic task-context broker:

1. The harness submits a task.
2. M2Lab matches it against an app capability registry.
3. It returns only the relevant MCP servers/tools, app constraints, source IDs,
   and approval requirements.
4. The harness delegates to focused subagents when it supports them.

Example capability entry:

```yaml
capability: research.trip
apps: [firecrawl, surfsense, adventurelog]
tools: [firecrawl.search, surfsense.retrieve, adventurelog.create_trip_draft]
risk: approval-required-for-write
```

SurfSense is an early **retrieval source**, especially for research. It is not
the policy authority, credential manager, or universal memory system. A future
context engine is justified only if progressive discovery plus structured app
data proves insufficient.

## 6. Policy and trust model

The agent harness may have its own permissions, but M2Lab must enforce the
portable policy boundary. Every MCP integration declares a risk tier:

| Tier | Examples | Default |
|---|---|---|
| Read | Search, retrieve, list status | Allow |
| Draft | Propose itinerary or transactions | Allow; clearly label draft |
| Write | Save a trip, import a selected receipt | Explicit approval |
| Operational | Start, stop, update an app | Explicit approval + impact |
| Destructive | Delete data, rotate secrets | Typed confirmation |
| Privileged | Docker host/socket, Vaultwarden | Never autonomous |

Every write must produce an audit record: requesting user, harness, app/tool,
sanitized parameters, source IDs, approval, result, and time. Provider and
agent credentials are scoped and revocable. The optional shared app login is a
user-acknowledged exception and is never placed in agent-readable files.

## 7. Initial catalog

### End-user apps

| App | Outcome | Kind | Initial MCP posture |
|---|---|---|---|
| SurfSense | Research and knowledge | Self-hosted | Read-only retrieval |
| Firecrawl | Web acquisition | Self-hosted | Read-only, constrained fetch/search |
| Actual Budget | Personal finance | Self-hosted | Read-only; transaction drafts only |
| AdventureLog | Trips and memories | Self-hosted | Read-only; approved drafts may write |
| Paperless-ngx | Documents and receipts | Self-hosted | Read-only; approved ingest/tagging |
| Immich | Photos and image assets | Self-hosted | Read-only; selected exports only |
| Endurain (evaluation) | Activity tracking | Self-hosted | Read-only health/activity summaries |
| OpenWhisper (evaluation) | Audio transcription | Local/service evaluation | Explicitly selected inputs only |
| Graphite Editor | Vector/procedural design | Browser companion | Human-operated; no initial MCP |
| FreeMind | Mind maps and outlines | Desktop companion | Human-operated; file handoff only |

### Infrastructure and harnesses

| App | Role | Agent posture |
|---|---|---|
| LiteLLM | Model gateway, budgets, model routing | Curated read-only ops tools only |
| FreeLLMAPI | Optional free-tier adapter | No agent access to provider credentials |
| Ollama | Local model runtime | Read-only model/status operations only |
| OpenCode | Power-user agent harness | Adapter, not platform lock-in |
| Open WebUI | General-user chat harness | Adapter, not platform lock-in |
| Vaultwarden | Credential storage | No agent/MCP exposure |

**FreeMind note:** FreeMind is a mature, Java-based, open-source desktop mind
mapper. Its `.mm` files are appropriate explicit handoff artifacts, but it is
not a server to containerize. The catalog links users to its local installation
and later may support exporting an approved outline to a new map; it never
silently reads a user's maps.

**Graphite note:** Graphite Editor is a browser-local vector/procedural editor.
It is categorized as Creative and receives an **Open locally** card; no Docker
service or autonomous design MCP is planned initially.

## 8. Demonstration workflows

### A. Research to approved trip

`Firecrawl → SurfSense → AdventureLog`

Research current trip options, retain source links, summarize constraints, and
create an AdventureLog itinerary only after the user approves the draft.

### B. Receipt to proposed transaction

`Paperless-ngx → Actual Budget`

Extract merchant/date/total and document ID from selected Paperless receipts;
match categories/accounts and present proposed transactions and possible
duplicates. No financial record is written without batch approval.

### C. Selected receipt photo to archive and budget draft

`Immich → Paperless-ngx → Actual Budget`

The user explicitly selects receipt images. The workflow sends only those to
Paperless ingestion, then performs workflow B. It is never a background scan of
the photo library.

### D. Activity-informed trip draft

`Endurain → Firecrawl/SurfSense → AdventureLog`

Summarize activity trends read-only, research a suitable trip, and prepare an
AdventureLog draft. This is planning support, not medical advice.

## 9. Delivery sequence

1. **Foundation:** finish the existing security hardening review, define the
   manifest schema, and add manifest validation/testing.
2. **Settings control center:** installed/add-app views, dependency plans,
   shared bootstrap identity, configuration status, and explicit updates.
3. **AI connection:** LiteLLM/FreeLLMAPI/Ollama setup with secret masking,
   provider status, local embeddings, and downstream app wiring.
4. **Gateway:** implement capability registry, MCP adapters, scoped credentials,
   approval API, and append-only audit records.
5. **Pilot:** ship workflow A plus one harness adapter, then workflow B.
6. **Expand:** add Immich workflow C, evaluate Endurain/OpenWhisper, and add the
   second harness adapter. Keep creative/local companions non-autonomous.

## 10. Acceptance criteria before public promotion

- A new user can review every dependency and human step before deployment.
- The dashboard never exposes stored secrets; agents cannot read `.env` files.
- A harness receives only task-matched tool schemas.
- Each write has an approval and audit event; destructive/privileged actions
  cannot be auto-approved.
- The two pilot workflows have end-to-end tests and human-readable failure
  recovery.
- README quickstart, screenshots, supported platforms, security model, and
  contributor path describe the actual product—not an aspirational placeholder.
