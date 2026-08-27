import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Cpu,
  Download,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Network,
  PackageCheck,
  PlugZap,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useCatalog } from "../../hooks/useCatalog";
import { useServices } from "../../hooks/useServices";
import {
  createApproval,
  createMcpApproval,
  createSetupApproval,
  fetchCalendarConnection,
  fetchSetup,
  fetchMcpServers,
  fetchModelAccess,
  fetchSetupJobs,
  fetchUpdateStatus,
  getServiceIconUrl,
  getServiceUrl,
  resumeSetupJob,
  saveCalendarConnection,
  serviceAction,
  startSetupTarget,
  syncMcpHarnesses,
  updateMcpServer,
  updateSetup,
  verifyMcpServer,
} from "../../lib/api";
import type { CatalogApp, McpServer, Service, SetupConfigItem } from "../../lib/types";
import { ServiceSetupPanel } from "./ServiceSetupPanel";

type SettingsSection = "apps" | "models" | "mcp";
const PROVIDERS = [
  [
    "NVIDIA_NIM_API_KEY",
    "NVIDIA NIM",
    "Build and embedding models through NVIDIA’s API catalog.",
  ],
  ["GEMINI_API_KEY", "Google Gemini", "Gemini chat and embedding models."],
  [
    "HUGGINGFACE_API_KEY",
    "Hugging Face",
    "Hosted inference and model endpoints.",
  ],
  ["MISTRAL_API_KEY", "Mistral", "Mistral chat and embedding models."],
  ["OPENAI_API_KEY", "OpenAI", "OpenAI chat and embedding models."],
] as const;

function ServiceMark({
  service,
  app,
}: {
  service?: Service;
  app?: CatalogApp;
}) {
  const id = service?.id || app?.service_id;
  return (
    <span className="settings-app-mark">
      {id && (
        <img
          src={getServiceIconUrl(id)}
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      )}
      <span>{service?.icon || app?.icon || "◇"}</span>
    </span>
  );
}
function stateLabel(service: Service) {
  if (service.state === "running" && service.healthy === false)
    return "Needs attention";
  if (service.state === "running") return "Online";
  if (service.state === "stopped") return "Installed · offline";
  if (service.state === "degraded") return "Degraded";
  return "Not installed";
}

function InstallPlan({
  app,
  services,
  apps,
  onInstalled,
}: {
  app: CatalogApp;
  services: Service[];
  apps: CatalogApp[];
  onInstalled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const jobs = useQuery({ queryKey: ["setup-jobs"], queryFn: fetchSetupJobs, refetchInterval: 2000 });
  const serviceMap = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  );
  const appMap = useMemo(
    () => new Map(apps.map((item) => [item.id, item])),
    [apps],
  );
  const installIds = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const add = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const dependencyApp = appMap.get(id);
      for (const dependency of dependencyApp?.dependencies || [])
        add(dependency);
      if (serviceMap.get(id)?.state === "absent") ordered.push(id);
    };
    for (const dependency of app.dependencies || []) add(dependency);
    add(app.service_id!);
    return ordered;
  }, [app, appMap, serviceMap]);
  const identityRequired = Boolean(app.setup?.identity);
  const foundationReady = jobs.data?.jobs.some(job => job.target === "foundation" && job.status === "ready") || false;
  const canInstall = foundationReady;
  const install = async () => {
    setBusy(true);
    try {
      const target = app.service_id!;
      const approval = await createSetupApproval(target, "setup-start");
      await startSetupTarget(target, approval);
      await queryClient.invalidateQueries({ queryKey: ["setup-jobs"] });
      toast.success(`${app.name} setup started`);
      onInstalled();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-install-plan">
      <header>
        <ServiceMark app={app} />
        <div>
          <span className="eyebrow">Install plan</span>
          <h2>{app.name}</h2>
          <p>{app.description}</p>
        </div>
      </header>
      <div className="settings-plan-grid">
        <section>
          <strong>What OmniLab will do</strong>
          <ul>
            <li>Prepare host-only configuration and internal secrets.</li>
            <li>
              Start{" "}
              {installIds
                .map(
                  (id) =>
                    appMap.get(id)?.name ||
                    serviceMap.get(id)?.display_name ||
                    id,
                )
                .join(" → ")}
              .
            </li>
            {app.setup?.model_route && app.setup.model_route !== "none" && (
              <li>
                Wire its model route through{" "}
                {app.setup.model_route === "litellm" ? "LiteLLM" : "Ollama"}.
              </li>
            )}
            <li>Keep lifecycle actions approval-gated and auditable.</li>
          </ul>
        </section>
        <section>
          <strong>What you provide</strong>
          <ul>
            {identityRequired ? (
              <li>
                {foundationReady
                  ? "Authentik identity foundation is ready."
                  : "Complete the identity-first core setup above before installing."}
              </li>
            ) : (
              <li>No login is required before deployment.</li>
            )}
            {app.setup?.bootstrap === "first_login" && (
              <li>Complete the app’s first-login page after it starts.</li>
            )}
            {(app.setup?.notes || []).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      </div>
      <div className="settings-requirements">
        <span>Requirements</span>
        {app.requirements.map((requirement) => (
          <small key={requirement}>
            <Check />
            {requirement}
          </small>
        ))}
      </div>
      <footer>
        <span>
          <ShieldCheck /> One confirmation installs only the services shown
          above.
        </span>
        <button
          className="button-primary"
          onClick={install}
          disabled={busy || !canInstall}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <Download />}
          {!canInstall ? "Identity setup required" : `Start setup wizard for ${app.name}`}
        </button>
      </footer>
    </div>
  );
}

function AppSetupWizard({ service }: { service: Service }) {
  const queryClient = useQueryClient();
  const jobs = useQuery({ queryKey: ["setup-jobs"], queryFn: fetchSetupJobs, refetchInterval: 2000 });
  const [busy, setBusy] = useState(false);
  const job = jobs.data?.jobs.find(item => item.target === service.id);
  const foundationReady = jobs.data?.jobs.some(item => item.target === "foundation" && item.status === "ready") || false;
  const start = async () => {
    setBusy(true);
    try {
      const approval = await createSetupApproval(service.id, "setup-start");
      await startSetupTarget(service.id, approval);
      await queryClient.invalidateQueries({ queryKey: ["setup-jobs"] });
      toast.success(`${service.display_name} setup started`);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const resume = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const approval = await createSetupApproval(service.id, "setup-resume");
      await resumeSetupJob(job, approval);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["setup-jobs"] }), queryClient.invalidateQueries({ queryKey: ["services"] })]);
      toast.success(`${service.display_name} setup verified`);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <section className={`app-setup-wizard app-setup-${job?.status || "not_started"}`}>
    <div className="app-setup-main"><span className={`setup-status setup-status-${job?.status || "queued"}`} /><div><span className="eyebrow">Setup</span><h3>{job?.summary || `Finish setting up ${service.display_name}`}</h3><p>{job?.error || job?.events[job.events.length - 1]?.message || "Run the remaining automated steps; OmniLab pauses only when you need to act."}</p></div><span className="app-setup-progress">{job?.progress || 0}%</span>
      <footer>
        {!foundationReady && <small>Core identity setup required</small>}
        {job?.action?.url && <a href={job.action.url} target="_blank" rel="noreferrer">{job.action.label}<ExternalLink /></a>}
        {job?.status === "user_action_required" ? <button className="button-primary" disabled={busy} onClick={resume}>{busy ? <LoaderCircle className="animate-spin" /> : <Check />} I finished</button> : job?.status === "ready" ? <span className="app-setup-ready"><Check /> Complete</span> : <button className="button-primary" disabled={busy || !foundationReady || (job && !["failed", "cancelled"].includes(job.status))} onClick={start}>{busy || (job && !["failed", "cancelled"].includes(job.status)) ? <LoaderCircle className="animate-spin" /> : <RefreshCcw />} {job?.status === "failed" ? "Retry" : "Run setup"}</button>}
      </footer>
    </div>
    {job && <progress max={100} value={job.progress} />}
    {job?.events.length ? <details><summary>Setup steps</summary><div>{job.events.slice(-8).map((event, index) => <p key={`${event.timestamp}-${index}`}><i className={`setup-status setup-status-${event.status}`} /><span><strong>{event.message}</strong><small>{event.stage.split("_").join(" ")}</small></span></p>)}</div></details> : null}
  </section>;
}

function UpdateControl({ service }: { service: Service }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<
    "idle" | "checking" | "current" | "available" | "unknown"
  >("idle");
  const [updating, setUpdating] = useState(false);
  const check = async () => {
    setStatus("checking");
    try {
      const result = await fetchUpdateStatus(service.id);
      setStatus(
        result.update_available === true
          ? "available"
          : result.update_available === false
            ? "current"
            : "unknown",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setStatus("unknown");
    }
  };
  const update = async () => {
    setUpdating(true);
    try {
      const approval = await createApproval(service.id, "update");
      const result = await serviceAction(service.id, "update", approval);
      if (!result.ok) throw new Error(result.output);
      setStatus("current");
      await queryClient.invalidateQueries({ queryKey: ["services"] });
      toast.success(`${service.display_name} updated`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdating(false);
    }
  };
  return (
    <div className="settings-update-control">
      <button onClick={check} disabled={status === "checking"}>
        <RefreshCcw className={status === "checking" ? "animate-spin" : ""} />
        {status === "idle"
          ? "Check updates"
          : status === "checking"
            ? "Checking…"
            : status === "current"
              ? "Up to date"
              : status === "available"
                ? "Update available"
                : "Check unavailable"}
      </button>
      {status === "available" && (
        <button className="update" onClick={update} disabled={updating}>
          {updating ? "Updating…" : "Update now"}
        </button>
      )}
    </div>
  );
}

function AppsSettings({
  initialSelectedId,
}: {
  initialSelectedId: string | null;
}) {
  const servicesQuery = useServices();
  const catalogQuery = useCatalog();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );
  const [offlineOpen, setOfflineOpen] = useState(false);
  if (servicesQuery.isLoading || catalogQuery.isLoading)
    return (
      <div className="loading-stage">
        <span />
      </div>
    );
  if (!servicesQuery.data || !catalogQuery.data)
    return <div className="empty-state">App settings could not be loaded.</div>;
  const services = servicesQuery.data.services;
  const visibleServices = services.filter((service) => service.visibility === "user");
  const roster = [...visibleServices].sort((a, b) => {
    const order = { running: 0, degraded: 1, stopped: 2, absent: 3 };
    return order[a.state] - order[b.state] || a.display_name.localeCompare(b.display_name);
  });
  const catalogApps = catalogQuery.data.apps.filter(
    (app) => app.service_id && app.availability !== "planned",
  );
  const activeId =
    selectedId && visibleServices.some((service) => service.id === selectedId)
      ? selectedId
      : roster[0]?.id;
  const activeService = visibleServices.find((service) => service.id === activeId);
  const runningServices = roster.filter(service => service.state === "running" || service.state === "degraded");
  const offlineServices = roster.filter(service => service.state === "stopped");
  const availableServices = roster.filter(service => service.state === "absent");
  const showOffline = offlineOpen || activeService?.state === "stopped";
  const installApp = catalogApps.find((app) => app.service_id === activeService?.id);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["services"] });
  };
  const rosterButton = (service: Service) => <button
    key={service.id}
    className={`${activeId === service.id ? "active" : ""} ${service.state === "absent" ? "unavailable" : ""}`}
    onClick={() => setSelectedId(service.id)}
  >
    <ServiceMark service={service} />
    <span><strong>{service.display_name}</strong><small>{stateLabel(service)}</small></span>
    <i className={`workspace-dot workspace-dot-${service.state}`} />
  </button>;
  return (
    <div className="settings-apps-shell">
      <div className="settings-installed-grid">
        <aside className="settings-app-list">
          <div className="settings-list-heading">
            <span>Applications</span>
            <small>Running first · select an available app to review setup.</small>
          </div>
          {runningServices.length > 0 && <div className="settings-roster-section"><div className="settings-roster-divider"><span>Running</span><em>{runningServices.length}</em></div>{runningServices.map(rosterButton)}</div>}
          {offlineServices.length > 0 && <div className="settings-roster-section"><button className="settings-roster-divider collapsible" onClick={() => setOfflineOpen(!showOffline)}>{showOffline ? <ChevronDown /> : <ChevronRight />}<span>Installed · offline</span><em>{offlineServices.length}</em></button>{showOffline && offlineServices.map(rosterButton)}</div>}
          {availableServices.length > 0 && <div className="settings-roster-section"><div className="settings-roster-divider"><span>Available</span><em>{availableServices.length}</em></div>{availableServices.map(rosterButton)}</div>}
        </aside>
        <section className="settings-active-panel">
          {!activeService ? <div className="empty-state">No applications are registered.</div>
            : activeService.state === "absent" && installApp ? (
          <InstallPlan
            app={installApp}
            services={services}
            apps={catalogApps}
            onInstalled={refresh}
          />
            ) : activeService.state === "absent" ? <div className="empty-state">This application does not yet have a reviewed installation plan.</div>
              : <>
                <div className="settings-active-heading">
                  <div>
                    <span className="eyebrow">Installed app</span>
                    <h2>{activeService.display_name}</h2>
                    <p>{activeService.description}</p>
                  </div>
                  <div className="settings-active-actions">
                    <UpdateControl service={activeService} />
                    {activeService.external_ready
                      ? <a href={getServiceUrl(activeService)} target="_blank" rel="noreferrer">Open app <ExternalLink /></a>
                      : <span className="settings-open-unavailable">Private URL unavailable</span>}
                  </div>
                </div>
                <AppSetupWizard service={activeService} />
                {activeService.id === "nextcloud" && <NextcloudCalendarSettings />}
                <ServiceSetupPanel key={activeService.id} service={activeService} />
              </>}
        </section>
      </div>
    </div>
  );
}

function McpSettings() {
  const queryClient = useQueryClient();
  const registry = useQuery({ queryKey: ["mcp-servers"], queryFn: () => fetchMcpServers(true), refetchInterval: 30000 });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showUnsupported, setShowUnsupported] = useState(false);
  const [contexts, setContexts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const servers = registry.data?.servers || [];
  const sorted = [...servers].sort((a, b) => {
    const appOrder = (state: McpServer["app_state"]) => state === "running" ? 0 : state === "degraded" ? 1 : state === "stopped" ? 2 : 3;
    return appOrder(a.app_state) - appOrder(b.app_state) || a.name.localeCompare(b.name);
  });
  const unsupported = sorted.filter(server => server.kind === "unsupported" && server.tools.length === 0);
  const matrixServers = showUnsupported ? sorted : sorted.filter(server => !unsupported.includes(server));
  const mutate = async (server: McpServer, patch: Record<string, unknown>) => {
    setBusyId(server.id);
    try {
      const approval = await createMcpApproval(server.id, "mcp-edit");
      await updateMcpServer(server.id, patch, approval);
      await queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      toast.success("MCP policy saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyId(null); }
  };
  const verify = async (server: McpServer) => {
    setBusyId(server.id);
    try {
      const approval = await createMcpApproval(server.id, "mcp-verify");
      await verifyMcpServer(server.id, approval);
      await queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      toast.success("MCP verification finished");
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyId(null); }
  };
  const sync = async () => {
    setBusyId("registry");
    try {
      const approval = await createMcpApproval("registry", "mcp-sync");
      const result = await syncMcpHarnesses(approval);
      toast.success(result.note);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyId(null); }
  };
  if (registry.isLoading) return <div className="loading-stage"><span /></div>;
  if (!registry.data) return <div className="empty-state">MCP registry could not be loaded.</div>;
  return <div className="mcp-settings">
    <section className="mcp-summary">
      {(["live", "degraded", "authentication_required", "disabled", "unavailable"] as const).map(state => <div key={state}><strong>{registry.data.summary[state]}</strong><span>{state.replace("_", " ")}</span></div>)}
      <button className="button-secondary" disabled={busyId !== null} onClick={sync}><RefreshCcw className={busyId === "registry" ? "animate-spin" : ""} /> Sync harnesses</button>
    </section>
    <section className="mcp-matrix-card">
      <header><div><span className="eyebrow">Harness access matrix</span><h2>Federated actions</h2><p>Applications stay grouped; each destination can be reviewed without leaving the table.</p></div></header>
      <div className="mcp-table-scroll"><table className="mcp-matrix"><thead><tr><th>Application & actions</th><th>Status</th><th>Server</th><th>OpenCode</th><th>Open WebUI</th><th aria-label="Details" /></tr></thead>
        {matrixServers.map(server => {
          const locked = server.kind === "unsupported" || server.app_state === "absent";
          const busy = busyId === server.id;
          const context = contexts[server.id] ?? server.context;
          return <tbody key={server.id} className={locked ? "locked" : ""}>
            <tr className="mcp-app-row">
              <td><div className="mcp-app-identity"><span className="settings-app-mark"><span>{server.icon}</span></span><span><strong>{server.name}</strong><small>{server.source || server.error || "No reviewed MCP implementation"}</small></span></div>
                <div className="mcp-action-list">{server.tools.length ? server.tools.map(tool => <label key={tool.id}><input type="checkbox" checked={tool.enabled} disabled={locked || busy} onChange={event => mutate(server, { tools: { [tool.id]: { enabled: event.target.checked } } })} /><span>{tool.label}</span><em className={`mcp-risk mcp-risk-${tool.effective_risk}`}>{tool.effective_risk}</em></label>) : <small>No callable actions</small>}</div>
              </td>
              <td><span className={`mcp-status mcp-status-${server.state}`}><i className={`mcp-state-dot mcp-state-${server.state}`} />{server.state.replace("_", " ")}</span></td>
              <td><input type="checkbox" aria-label={`Enable ${server.name} server`} checked={server.enabled} disabled={locked || busy} onChange={event => mutate(server, { enabled: event.target.checked })} /></td>
              <td><input type="checkbox" aria-label={`Enable ${server.name} for OpenCode`} checked={server.harnesses.includes("opencode")} disabled={locked || busy} onChange={event => mutate(server, { harnesses: event.target.checked ? [...new Set([...server.harnesses, "opencode"])] : server.harnesses.filter(item => item !== "opencode") })} /></td>
              <td><input type="checkbox" aria-label={`Enable ${server.name} for Open WebUI`} checked={server.harnesses.includes("open-webui")} disabled={locked || busy} onChange={event => mutate(server, { harnesses: event.target.checked ? [...new Set([...server.harnesses, "open-webui"])] : server.harnesses.filter(item => item !== "open-webui") })} /></td>
              <td><button className="mcp-expand" onClick={() => setExpandedId(expandedId === server.id ? null : server.id)}>{expandedId === server.id ? <ChevronDown /> : <ChevronRight />}</button></td>
            </tr>
            {expandedId === server.id && <tr className="mcp-detail-row"><td colSpan={6}><div><span><strong>{server.kind} · {server.trust}</strong><small>{server.auth.configured ? `${server.auth.type} authentication configured` : "Authentication required"} · {server.transport}</small></span><button className="button-secondary" disabled={locked || busy} onClick={() => verify(server)}><RefreshCcw className={busy ? "animate-spin" : ""} /> Verify</button></div>{server.error && <p className="mcp-warning">{server.error}</p>}<label className="mcp-context">Operating context<textarea value={context} maxLength={2000} onChange={event => setContexts(previous => ({ ...previous, [server.id]: event.target.value }))} placeholder="Data boundaries and guidance for agents using this app." /><button className="button-primary" disabled={busy || context === server.context} onClick={() => mutate(server, { context })}>Save context</button></label></td></tr>}
          </tbody>;
        })}
        {unsupported.length > 0 && <tbody className="mcp-unavailable-group"><tr><td colSpan={6}><button onClick={() => setShowUnsupported(!showUnsupported)}>{showUnsupported ? <ChevronDown /> : <ChevronRight />}<span><strong>{showUnsupported ? "Hide" : "Show"} unavailable integrations</strong><small>{unsupported.length} apps without a reviewed callable MCP interface</small></span></button></td></tr></tbody>}
      </table></div>
    </section>
  </div>;
}

function ModelAccess() {
  const services = useServices();
  const litellm = services.data?.services.find(
    (service) => service.id === "litellm",
  );
  const setup = useQuery({
    queryKey: ["setup", "litellm"],
    queryFn: () => fetchSetup("litellm"),
    enabled: litellm?.state !== "absent",
  });
  const inventory = useQuery({ queryKey: ["model-access"], queryFn: fetchModelAccess, refetchInterval: 15000 });
  const queryClient = useQueryClient();
  const [providerKey, setProviderKey] = useState<(typeof PROVIDERS)[number][0]>(PROVIDERS[0][0]);
  const [providerValue, setProviderValue] = useState("");
  const [saving, setSaving] = useState(false);
  const serviceMap = new Map(
    services.data?.services.map((service) => [service.id, service]) || [],
  );
  const save = async () => {
    setSaving(true);
    try {
      await updateSetup("litellm", { [providerKey]: providerValue });
      setProviderValue("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["setup", "litellm"] }),
        queryClient.invalidateQueries({ queryKey: ["model-access"] }),
      ]);
      toast.success(`${PROVIDERS.find(([key]) => key === providerKey)?.[1]} key saved`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  const selectedProvider = PROVIDERS.find(([key]) => key === providerKey)!;
  const modelData = inventory.data;
  return (
    <div className="settings-models">
      <section className="settings-section-intro">
        <span className="eyebrow">
          <Sparkles />
          One model endpoint
        </span>
        <h2>Model access</h2>
        <p>
          Provider credentials live here once. LiteLLM exposes the stable
          internal route used by OpenCode and compatible apps; FreeLLMAPI and
          Ollama add free-tier and local paths.
        </p>
      </section>
      {litellm?.state === "absent" ? (
        <div className="settings-callout">
          <Network />
          <div>
            <strong>Install LiteLLM before adding provider keys.</strong>
            <p>Open Apps and select LiteLLM under Available to review its setup plan.</p>
          </div>
        </div>
      ) : (
        <>
        <section className="model-wiring-card">
          <header>
            <div><span className="eyebrow"><Network />Live routing</span><h3>Model wiring</h3><p>Free cloud and local models converge behind one LiteLLM endpoint.</p></div>
            <span className={`model-wiring-health ${modelData?.gateway.wired ? "ready" : "attention"}`}>{modelData?.gateway.wired ? <><Check />Gateway wired</> : <><RefreshCcw />Wires on LiteLLM restart</>}</span>
          </header>
          <div className="model-wiring-grid">
            <div className="model-source-stack">
              <article><div className="model-node-heading"><ServiceMark service={serviceMap.get("freellmapi")} /><span><strong>FreeLLMAPI</strong><small>Free cloud providers</small></span><i className={`workspace-dot workspace-dot-${modelData?.services.freellmapi || "absent"}`} /></div><div className="model-node-items">{modelData?.free_providers.length ? modelData.free_providers.map(provider => <span key={provider.id} className={provider.healthy ? "online" : "offline"}>{provider.name}</span>) : <small>No provider keys configured</small>}</div></article>
              <article><div className="model-node-heading"><ServiceMark service={serviceMap.get("ollama")} /><span><strong>Ollama</strong><small>Models downloaded locally</small></span><i className={`workspace-dot workspace-dot-${modelData?.services.ollama || "absent"}`} /></div><div className="model-node-items">{modelData?.ollama_models.length ? modelData.ollama_models.map(model => <span key={model.name} className="online">{model.name}</span>) : <small>No local models reported</small>}</div></article>
            </div>
            <div className="model-route-arrow"><span>routes</span><i>→</i></div>
            <article className="model-hub"><div className="model-hub-icon"><Cpu /></div><span className="eyebrow">One private endpoint</span><h3>LiteLLM</h3><p>Routing, budgets, model aliases, and fallback policy for every compatible app.</p><div className="model-node-items">{modelData?.direct_providers.filter(provider => provider.configured).map(provider => <span key={provider.id}>{provider.name} direct</span>)}</div><code>http://litellm:4000/v1</code></article>
          </div>
        </section>
        <section className="provider-key-editor">
          <header><div><span className="eyebrow"><KeyRound />Write-only credentials</span><h3>Add or rotate a provider key</h3><p>Free-tier credentials stay inside FreeLLMAPI. Add paid or direct routes here only when you need them.</p></div></header>
          <div className="provider-key-form"><label><span>Provider</span><select value={providerKey} onChange={event => setProviderKey(event.target.value as typeof providerKey)}>{PROVIDERS.map(([key, name]) => <option key={key} value={key}>{name}{(setup.data?.config[key] as SetupConfigItem | undefined)?.configured ? " · configured" : ""}</option>)}</select></label><label className="provider-key-input"><span>API key</span><input type="password" value={providerValue} onChange={event => setProviderValue(event.target.value)} placeholder={(setup.data?.config[providerKey] as SetupConfigItem | undefined)?.configured ? "Paste replacement key" : "Paste API key"} /></label><button className="button-primary" onClick={save} disabled={saving || !providerValue.trim()}>{saving ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}Save key</button></div>
          <p className="provider-key-detail"><strong>{selectedProvider[1]}</strong> — {selectedProvider[2]} Stored values are never returned to the browser.</p>
          <div className="provider-status-list">{PROVIDERS.map(([key, name]) => <span key={key} className={(setup.data?.config[key] as SetupConfigItem | undefined)?.configured ? "configured" : ""}><i />{name}<small>{(setup.data?.config[key] as SetupConfigItem | undefined)?.configured ? "Configured" : "Not configured"}</small></span>)}</div>
        </section>
        </>
      )}
    </div>
  );
}

function NextcloudCalendarSettings() {
  const connection = useQuery({
    queryKey: ["calendar-connection"],
    queryFn: fetchCalendarConnection,
  });
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [calendar, setCalendar] = useState("personal");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (connection.data?.username) setUsername(connection.data.username);
    if (connection.data?.calendar) setCalendar(connection.data.calendar);
  }, [connection.data]);
  const save = async () => {
    setSaving(true);
    try {
      await saveCalendarConnection(username, appPassword, calendar);
      setAppPassword("");
      await queryClient.invalidateQueries({
        queryKey: ["calendar-connection"],
      });
      toast.success("Nextcloud calendar connected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="settings-connections">
      <section className="settings-connection-card">
        <div className="settings-connection-brand">
          <span>
            <Cloud />
          </span>
          <div>
            <strong>Nextcloud Calendar</strong>
            <small>
              {connection.data?.configured ? "Connected" : "Not connected"} ·
              read-only Workspace agenda
            </small>
          </div>
        </div>
        <p>
          Show your personal agenda in Workspace. Use a dedicated Nextcloud app
          password; OmniLab reads only the selected calendar through CalDAV.
        </p>
        {!connection.data?.nextcloud_running && (
          <div className="settings-inline-warning">
            Nextcloud must be installed and online before this connection can be
            tested.
          </div>
        )}
        <div className="settings-connection-form">
          <label>
            Nextcloud username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            App password
            <input
              type="password"
              value={appPassword}
              onChange={(event) => setAppPassword(event.target.value)}
              placeholder={
                connection.data?.configured
                  ? "Configured — enter to replace"
                  : "Paste app password"
              }
            />
          </label>
          <label>
            Calendar slug
            <input
              value={calendar}
              onChange={(event) => setCalendar(event.target.value)}
              placeholder="personal"
            />
          </label>
          <button
            className="button-primary"
            onClick={save}
            disabled={
              saving ||
              !username ||
              !appPassword ||
              !calendar ||
              !connection.data?.nextcloud_running
            }
          >
            {saving ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <ShieldCheck />
            )}
            Connect calendar
          </button>
        </div>
      </section>
    </div>
  );
}

export function SetupTab({
  initialSelectedId = null,
  initialSection = "apps",
}: {
  initialSelectedId?: string | null;
  initialSection?: SettingsSection;
}) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  return (
    <div className="settings-hub">
      <nav className="settings-subnav" aria-label="Settings sections">
        {(
          [
            { id: "models", label: "Model access", icon: Sparkles },
            { id: "mcp", label: "MCP", icon: PlugZap },
            { id: "apps", label: "Apps", icon: PackageCheck },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={section === id ? "active" : ""}
            onClick={() => setSection(id)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>
      {section === "apps" && (
        <AppsSettings initialSelectedId={initialSelectedId} />
      )}
      {section === "models" && <ModelAccess />}
      {section === "mcp" && <McpSettings />}
    </div>
  );
}
