import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Cloud,
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
    "FREE_LLMAPI_API_KEY",
    "FreeLLMAPI gateway",
    "The local gateway key created inside FreeLLMAPI.",
  ],
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
    <header><div><span className="eyebrow">Setup wizard</span><h3>{job?.summary || `Finish setting up ${service.display_name}`}</h3><p>{job?.error || job?.events.at(-1)?.message || "Run the remaining automated configuration and receive one prompt at a time when your input is required."}</p></div><span>{job?.progress || 0}%</span></header>
    {job && <progress max={100} value={job.progress} />}
    {job?.events.length ? <details><summary>Setup steps</summary><div>{job.events.slice(-8).map((event, index) => <p key={`${event.timestamp}-${index}`}><i className={`setup-status setup-status-${event.status}`} /><span><strong>{event.message}</strong><small>{event.stage.split("_").join(" ")}</small></span></p>)}</div></details> : null}
    <footer>
      {!foundationReady && <small>Complete the identity-first core setup before creating app accounts.</small>}
      {job?.action?.url && <a href={job.action.url} target="_blank" rel="noreferrer">{job.action.label}<ExternalLink /></a>}
      {job?.status === "user_action_required" ? <button className="button-primary" disabled={busy} onClick={resume}>{busy ? <LoaderCircle className="animate-spin" /> : <Check />} I finished this step</button> : job?.status === "ready" ? <span className="app-setup-ready"><Check /> Setup complete</span> : <button className="button-primary" disabled={busy || !foundationReady || (job && !["failed", "cancelled"].includes(job.status))} onClick={start}>{busy || (job && !["failed", "cancelled"].includes(job.status)) ? <LoaderCircle className="animate-spin" /> : <RefreshCcw />} {job?.status === "failed" ? "Retry setup" : "Run setup wizard"}</button>}
    </footer>
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
  const installApp = catalogApps.find((app) => app.service_id === activeService?.id);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["services"] });
  };
  return (
    <div className="settings-apps-shell">
      <div className="settings-installed-grid">
        <aside className="settings-app-list">
          <div className="settings-list-heading">
            <span>Applications</span>
            <small>Running first · select an available app to review setup.</small>
          </div>
          {roster.map((service, index) => {
            const previous = roster[index - 1];
            const section = service.state === "absent" ? "Available" : service.state === "stopped" ? "Installed · offline" : "Running";
            const previousSection = previous ? (previous.state === "absent" ? "Available" : previous.state === "stopped" ? "Installed · offline" : "Running") : null;
            return <div className="settings-roster-entry" key={service.id}>
              {section !== previousSection && <div className="settings-roster-divider"><span>{section}</span></div>}
              <button
                className={`${activeId === service.id ? "active" : ""} ${service.state === "absent" ? "unavailable" : ""}`}
                onClick={() => setSelectedId(service.id)}
              >
                <ServiceMark service={service} />
                <span><strong>{service.display_name}</strong><small>{stateLabel(service)}</small></span>
                <i className={`workspace-dot workspace-dot-${service.state}`} />
              </button>
            </div>;
          })}
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const servers = registry.data?.servers || [];
  const sorted = [...servers].sort((a, b) => {
    const appOrder = (state: McpServer["app_state"]) => state === "running" ? 0 : state === "degraded" ? 1 : state === "stopped" ? 2 : 3;
    return appOrder(a.app_state) - appOrder(b.app_state) || a.name.localeCompare(b.name);
  });
  const selected = servers.find((server) => server.id === selectedId) || sorted.find((server) => server.app_state !== "absent") || sorted[0];
  useEffect(() => setContext(selected?.context || ""), [selected?.id, selected?.context]);
  const mutate = async (patch: Record<string, unknown>) => {
    if (!selected) return;
    setBusy(true);
    try {
      const approval = await createMcpApproval(selected.id, "mcp-edit");
      await updateMcpServer(selected.id, patch, approval);
      await queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      toast.success("MCP policy saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const approval = await createMcpApproval(selected.id, "mcp-verify");
      await verifyMcpServer(selected.id, approval);
      await queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      toast.success("MCP verification finished");
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const sync = async () => {
    setBusy(true);
    try {
      const approval = await createMcpApproval("registry", "mcp-sync");
      const result = await syncMcpHarnesses(approval);
      toast.success(result.note);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  if (registry.isLoading) return <div className="loading-stage"><span /></div>;
  if (!registry.data) return <div className="empty-state">MCP registry could not be loaded.</div>;
  return <div className="mcp-settings">
    <section className="mcp-summary">
      {(["live", "degraded", "authentication_required", "disabled", "unavailable"] as const).map(state => <div key={state}><strong>{registry.data.summary[state]}</strong><span>{state.replace("_", " ")}</span></div>)}
      <button className="button-secondary" disabled={busy} onClick={sync}><RefreshCcw /> Sync harnesses</button>
    </section>
    <div className="settings-installed-grid">
      <aside className="settings-app-list mcp-app-list">
        <div className="settings-list-heading"><span>Federated servers</span><small>Running apps first · unavailable apps are locked.</small></div>
        {sorted.map((server, index) => {
          const group = server.app_state === "absent" ? "Not installed" : server.app_state === "stopped" ? "Installed · offline" : "Running";
          const previous = sorted[index - 1];
          const previousGroup = previous ? (previous.app_state === "absent" ? "Not installed" : previous.app_state === "stopped" ? "Installed · offline" : "Running") : null;
          return <Fragment key={server.id}>{group !== previousGroup && <div className="settings-roster-divider"><span>{group}</span></div>}<button className={selected?.id === server.id ? "active" : ""} disabled={server.app_state === "absent"} onClick={() => setSelectedId(server.id)}>
            <span className="settings-app-mark"><span>{server.icon}</span></span>
            <span><strong>{server.name}</strong><small>{server.state.replace("_", " ")}</small></span>
            <i className={`mcp-state-dot mcp-state-${server.state}`} />
          </button></Fragment>;
        })}
      </aside>
      <section className="settings-active-panel mcp-detail">
        {selected && <>
          <div className="settings-active-heading"><div><span className="eyebrow">{selected.kind} · {selected.trust}</span><h2>{selected.name} MCP</h2><p>{selected.source || selected.error || "No reviewed implementation"}</p></div><div className="settings-active-actions"><button className="button-secondary" disabled={busy || selected.kind === "unsupported"} onClick={verify}><RefreshCcw /> Verify</button></div></div>
          <div className="mcp-facts"><div><span>Application</span><strong>{selected.app_state}</strong></div><div><span>MCP</span><strong>{selected.state.replace("_", " ")}</strong></div><div><span>Authentication</span><strong>{selected.auth.configured ? selected.auth.type : "required"}</strong></div><div><span>Transport</span><strong>{selected.transport}</strong></div></div>
          {selected.error && <p className="mcp-warning">{selected.error}</p>}
          {selected.kind === "community" && <p className="mcp-warning">Community integration · {selected.maintainer || "unknown maintainer"} · pinned {selected.pin || "version missing"}. Review its tools before enabling.</p>}
          <div className="mcp-controls"><label><input type="checkbox" checked={selected.enabled} disabled={selected.kind === "unsupported" || selected.app_state === "absent" || busy} onChange={event => mutate({ enabled: event.target.checked })} /> Enabled</label><label><input type="checkbox" checked={selected.harnesses.includes("opencode")} onChange={event => mutate({ harnesses: event.target.checked ? [...new Set([...selected.harnesses, "opencode"])] : selected.harnesses.filter(item => item !== "opencode") })} /> OpenCode</label><label><input type="checkbox" checked={selected.harnesses.includes("open-webui")} onChange={event => mutate({ harnesses: event.target.checked ? [...new Set([...selected.harnesses, "open-webui"])] : selected.harnesses.filter(item => item !== "open-webui") })} /> Open WebUI</label></div>
          <label className="mcp-context">Operating context<textarea value={context} maxLength={2000} onChange={event => setContext(event.target.value)} placeholder="Data boundaries and guidance for agents using this app." /><button className="button-primary" disabled={busy || context === selected.context} onClick={() => mutate({ context })}>Save context</button></label>
          <div className="mcp-tools"><h3>Actions</h3>{selected.tools.length ? selected.tools.map(tool => <div key={tool.id}><label><input type="checkbox" checked={tool.enabled} onChange={event => mutate({ tools: { [tool.id]: { enabled: event.target.checked } } })} /><span><strong>{tool.label}</strong><small>{tool.id}</small></span></label><span className={`mcp-risk mcp-risk-${tool.effective_risk}`}>{tool.effective_risk}</span></div>) : <p>No callable tools have been verified for this server.</p>}</div>
        </>}
      </section>
    </div>
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
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const serviceMap = new Map(
    services.data?.services.map((service) => [service.id, service]) || [],
  );
  const save = async () => {
    setSaving(true);
    try {
      await updateSetup("litellm", values);
      setValues({});
      await queryClient.invalidateQueries({ queryKey: ["setup", "litellm"] });
      toast.success("Provider keys saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
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
      <div className="settings-core-row">
        {["litellm", "freellmapi", "ollama", "opencode-agent"].map((id) => {
          const service = serviceMap.get(id);
          return service ? (
            <div key={id}>
              <ServiceMark service={service} />
              <span>
                <strong>{service.display_name}</strong>
                <small>{stateLabel(service)}</small>
              </span>
              <i className={`workspace-dot workspace-dot-${service.state}`} />
            </div>
          ) : null;
        })}
      </div>
      {litellm?.state === "absent" ? (
        <div className="settings-callout">
          <Network />
          <div>
            <strong>Install LiteLLM before adding provider keys.</strong>
            <p>Open Apps and select LiteLLM under Available to review its setup plan.</p>
          </div>
        </div>
      ) : (
        <section className="settings-provider-panel">
          <header>
            <div>
              <span className="eyebrow">
                <KeyRound />
                Write-only credentials
              </span>
              <h3>Provider keys</h3>
              <p>
                Configured values are never returned to this page. Paste a value
                only to add or replace it.
              </p>
            </div>
            <button
              className="button-primary"
              onClick={save}
              disabled={saving || Object.keys(values).length === 0}
            >
              {saving ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ShieldCheck />
              )}
              Save keys
            </button>
          </header>
          <div className="settings-provider-grid">
            {PROVIDERS.map(([key, name, detail]) => {
              const item = setup.data?.config[key] as
                SetupConfigItem | undefined;
              return (
                <label key={key}>
                  <span>
                    <strong>{name}</strong>
                    <small>{detail}</small>
                  </span>
                  <em>{item?.configured ? "Configured" : "Not configured"}</em>
                  <input
                    type="password"
                    value={values[key] || ""}
                    onChange={(event) =>
                      setValues((previous) => ({
                        ...previous,
                        [key]: event.target.value,
                      }))
                    }
                    placeholder={
                      item?.configured
                        ? "Paste replacement key"
                        : "Paste API key"
                    }
                  />
                </label>
              );
            })}
          </div>
        </section>
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
            { id: "apps", label: "Apps", icon: PackageCheck },
            { id: "models", label: "Model access", icon: Sparkles },
            { id: "mcp", label: "MCP", icon: PlugZap },
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
