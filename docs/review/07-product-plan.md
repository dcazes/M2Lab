# OmniLab Product Plan — Personal AI App Platform

> **Status:** active implementation direction. The catalog, progressive
> discovery API/MCP tools, lifecycle approvals, local audit trail, and
> outcome-led dashboard are implemented. A resumable Initiate flow now prepares
> Vaultwarden, LiteLLM, and self-hosted Firecrawl, with Nextcloud and SurfSense
> as optional foundations. Workspace is now a compact operations cockpit with
> real system metrics, app selection, health, approval-gated commands, logs,
> and an audit-backed calendar/agenda. App-specific cross-app adapters remain
> staged. **Updated:** 2026-08-24.
>
> **Product thesis:** OmniLab helps people choose, install, configure, and
> safely use privacy-respecting productivity apps through the AI harness of
> their choice.

## 1. Product boundary

OmniLab is **not** another container dashboard, a model provider, or a new
general-purpose agent runtime. It is the layer that makes a curated collection
of useful apps coherent:

```text
Catalog and first-run setup
       │ selects/configures/deploys
       ▼
OmniLab capability gateway
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

## 2. First-run experience

The implemented **Initiate** tab is a repeatable vertical sequence. It detects
existing service state, preserves configured values, generates only
service-internal secrets, requests an action-specific approval, and starts each
Compose stack. Vaultwarden master-account creation is an explicit handoff;
OmniLab never handles that password. FreeLLMAPI is deferred from initiation.

The first page describes outcomes rather than Docker components:

```text
What would you like your personal AI workspace to help with?

[ Research & learn ] [ Money ] [ Plan trips ] [ Health & activity ]
[ Create visuals ]   [ Capture ideas ] [ Run local AI ]
```

Selecting an outcome preselects a profile of apps. Each card must show a
license-reviewed visual, plain-English purpose, setup time, storage/hardware
requirements, whether it works without AI, and required credentials. Cards use
one of three explicit actions:

| App kind | Dashboard action | Meaning |
|---|---|---|
| Self-hosted service | **Install** | OmniLab manages its declared Compose stack. |
| Local/browser companion | **Open locally** | User runs it on their own device; OmniLab does not pretend to host it. |
| Infrastructure | **Configure** | A supporting service, not an end-user destination. |

While images are downloading, the user can optionally connect AI providers.
Provider choice must never block installing a normal productivity app.

## 3. Model-provider setup

LiteLLM is the single OpenAI-compatible gateway used by apps and harnesses.
Ollama is the private/local fallback. FreeLLMAPI is an optional adapter for
legitimate provider free tiers; it is never a product promise and it must not
be used to evade provider quotas or terms.

```text
Choose model access: [ Local Ollama ] [ Provider key ] [ Later ]
Provider: NVIDIA | Google | Hugging Face | Mistral | other supported provider
Key:      paste once; test connection; store only in a gitignored secret file
```

The UI reports configuration status and test failures, but never returns saved
secret values to a browser or an agent. Paid-provider keys remain separate from
FreeLLMAPI. Vaultwarden stores user credentials but is never exposed to agents
or MCP tools.

## 4. Context and progressive capability discovery

Do **not** build a standalone vector/RAG "context engine" in v1. Instead build
a small, harness-agnostic task-context broker:

1. The harness submits a task.
2. OmniLab matches it against an app capability registry.
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

## 5. Policy and trust model

The agent harness may have its own permissions, but OmniLab must enforce the
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
sanitized parameters, source IDs, approval, result, and time. Credentials are
scoped, dedicated, revocable, and never placed in agent-readable files.

## 6. Initial catalog

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

## 7. Demonstration workflows

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

## 8. Delivery sequence

1. **Foundation:** finish the existing security hardening review, define the
   manifest schema, and add manifest validation/testing.
2. **First-run catalog:** build outcome-led cards, visuals, dependency display,
   configuration status, and safe install/retry/rollback states.
3. **AI connection:** add optional LiteLLM/Ollama/provider setup with secret
   masking, connection tests, and clear provider-status feedback.
4. **Gateway:** implement capability registry, MCP adapters, scoped credentials,
   approval API, and append-only audit records.
5. **Pilot:** ship workflow A plus one harness adapter, then workflow B.
6. **Expand:** add Immich workflow C, evaluate Endurain/OpenWhisper, and add the
   second harness adapter. Keep creative/local companions non-autonomous.

## 9. Acceptance criteria before public promotion

- A new user can choose a profile and understand every selected app before
  deployment.
- The dashboard never exposes stored secrets; agents cannot read `.env` files.
- A harness receives only task-matched tool schemas.
- Each write has an approval and audit event; destructive/privileged actions
  cannot be auto-approved.
- The two pilot workflows have end-to-end tests and human-readable failure
  recovery.
- README quickstart, screenshots, supported platforms, security model, and
  contributor path describe the actual product—not an aspirational placeholder.
