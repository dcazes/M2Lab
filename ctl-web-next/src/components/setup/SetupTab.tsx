import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Cloud,
  Download,
  ExternalLink,
  KeyRound,
  Layers3,
  LoaderCircle,
  Network,
  PackageCheck,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useCatalog } from "../../hooks/useCatalog";
import { useServices } from "../../hooks/useServices";
import {
  createApproval,
  fetchBootstrapIdentity,
  fetchCalendarConnection,
  fetchSetup,
  fetchUpdateStatus,
  getServiceIconUrl,
  getServiceUrl,
  prepareInstallService,
  saveBootstrapIdentity,
  saveCalendarConnection,
  serviceAction,
  updateSetup,
} from "../../lib/api";
import type { CatalogApp, Service, SetupConfigItem } from "../../lib/types";
import { ServiceSetupPanel } from "./ServiceSetupPanel";

type SettingsSection = "apps" | "models" | "connections";
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

function AppIdentityCard() {
  const queryClient = useQueryClient();
  const services = useServices();
  const identity = useQuery({
    queryKey: ["bootstrap-identity"],
    queryFn: fetchBootstrapIdentity,
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (identity.data?.email) setEmail(identity.data.email);
  }, [identity.data?.email]);
  const generate = () => {
    const alphabet =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    setPassword(
      Array.from(bytes, (value) => alphabet[value % alphabet.length]).join(""),
    );
  };
  const save = async () => {
    setSaving(true);
    try {
      await saveBootstrapIdentity(email, password);
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: ["bootstrap-identity"] });
      toast.success("Shared app login saved securely");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  const vaultwarden = services.data?.services.find(
    (service) => service.id === "vaultwarden",
  );
  const vaultReady = vaultwarden?.state === "running";
  return (
    <section className="settings-foundation-card">
      <div className="settings-foundation-icon">
        <KeyRound />
      </div>
      <div className="settings-foundation-copy">
        <span className="eyebrow">Shared app identity</span>
        <h3>
          {!vaultReady
            ? "Start with Vaultwarden"
            : identity.data?.configured
              ? "App login is ready"
              : "Create the login used during setup"}
        </h3>
        <p>
          {!vaultReady
            ? "Install Vaultwarden, create its master account directly in the app, then return here."
            : "Use one email and password for automated first-admin setup. Reusing it is convenient but increases the impact of one compromised app. Save a recovery copy in Vaultwarden."}
        </p>
        {vaultReady && vaultwarden && (
          <a href={getServiceUrl(vaultwarden)} target="_blank" rel="noreferrer">
            Open Vaultwarden <ExternalLink />
          </a>
        )}
      </div>
      <div className="settings-identity-form">
        <label>
          Email or login
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="omnilab-admin@example.invalid"
            disabled={!vaultReady}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={
              identity.data?.configured
                ? "Configured — enter only to replace"
                : "At least 10 characters"
            }
            disabled={!vaultReady}
          />
        </label>
        <button
          className="button-secondary"
          onClick={generate}
          disabled={!vaultReady}
        >
          Generate
        </button>
        <button
          className="button-primary"
          onClick={save}
          disabled={
            !vaultReady || saving || !email.trim() || password.length < 10
          }
        >
          {saving ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}{" "}
          Save securely
        </button>
      </div>
    </section>
  );
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
  const identity = useQuery({
    queryKey: ["bootstrap-identity"],
    queryFn: fetchBootstrapIdentity,
  });
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
  const canInstall = !identityRequired || identity.data?.configured;
  const install = async () => {
    setBusy(true);
    try {
      for (const id of installIds) {
        await prepareInstallService(id);
        const approval = await createApproval(id, "up");
        const result = await serviceAction(id, "up", approval);
        if (!result.ok) throw new Error(result.output);
      }
      toast.success(`${app.name} install started`);
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
                {identity.data?.configured
                  ? "Shared app login is ready."
                  : "Create the shared app login above before installing."}
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
          {!canInstall ? "App login required" : `Prepare & install ${app.name}`}
        </button>
      </footer>
    </div>
  );
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
  const [mode, setMode] = useState<"installed" | "add">("installed");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );
  const [installId, setInstallId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  if (servicesQuery.isLoading || catalogQuery.isLoading)
    return (
      <div className="loading-stage">
        <span />
      </div>
    );
  if (!servicesQuery.data || !catalogQuery.data)
    return <div className="empty-state">App settings could not be loaded.</div>;
  const services = servicesQuery.data.services;
  const installed = services.filter((service) => service.state !== "absent");
  const catalogApps = catalogQuery.data.apps.filter(
    (app) => app.service_id && app.availability !== "planned",
  );
  const available = catalogApps.filter(
    (app) =>
      services.find((service) => service.id === app.service_id)?.state ===
        "absent" &&
      `${app.name} ${app.description} ${app.category}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const activeId =
    selectedId && installed.some((service) => service.id === selectedId)
      ? selectedId
      : installed[0]?.id;
  const activeService = installed.find((service) => service.id === activeId);
  const installApp = catalogApps.find((app) => app.id === installId);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["services"] });
    setMode("installed");
  };
  return (
    <div className="settings-apps-shell">
      <div className="settings-segmented">
        <button
          className={mode === "installed" ? "active" : ""}
          onClick={() => setMode("installed")}
        >
          <PackageCheck />
          Installed <span>{installed.length}</span>
        </button>
        <button
          className={mode === "add" ? "active" : ""}
          onClick={() => setMode("add")}
        >
          <Download />
          Add apps <span>{available.length}</span>
        </button>
      </div>
      <AppIdentityCard />
      {mode === "installed" ? (
        <div className="settings-installed-grid">
          <aside className="settings-app-list">
            <div className="settings-list-heading">
              <span>Installed apps</span>
              <small>Settings remain available while offline.</small>
            </div>
            {installed.map((service) => (
              <button
                key={service.id}
                className={activeId === service.id ? "active" : ""}
                onClick={() => setSelectedId(service.id)}
              >
                <ServiceMark service={service} />
                <span>
                  <strong>{service.display_name}</strong>
                  <small>{stateLabel(service)}</small>
                </span>
                <i className={`workspace-dot workspace-dot-${service.state}`} />
              </button>
            ))}
          </aside>
          <section className="settings-active-panel">
            {activeService ? (
              <>
                <div className="settings-active-heading">
                  <div>
                    <span className="eyebrow">Installed app</span>
                    <h2>{activeService.display_name}</h2>
                    <p>{activeService.description}</p>
                  </div>
                  <div className="settings-active-actions">
                    <UpdateControl service={activeService} />
                    <a
                      href={getServiceUrl(activeService)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open app <ExternalLink />
                    </a>
                  </div>
                </div>
                <ServiceSetupPanel
                  key={activeService.id}
                  service={activeService}
                />
              </>
            ) : (
              <div className="empty-state">
                No apps have been installed yet. Open Add apps to begin.
              </div>
            )}
          </section>
        </div>
      ) : installApp ? (
        <>
          <button className="settings-back" onClick={() => setInstallId(null)}>
            ← Back to apps
          </button>
          <InstallPlan
            app={installApp}
            services={services}
            apps={catalogApps}
            onInstalled={refresh}
          />
        </>
      ) : (
        <div className="settings-add-apps">
          <div className="settings-add-heading">
            <div>
              <span className="eyebrow">Curated, self-hosted tools</span>
              <h2>Add an app</h2>
              <p>
                See every dependency and required human step before anything is
                downloaded.
              </p>
            </div>
            <label>
              <Search />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search apps…"
              />
            </label>
          </div>
          <div className="settings-add-grid">
            {available.map((app) => (
              <article
                key={app.id}
                style={{ "--app-accent": app.accent } as React.CSSProperties}
              >
                <ServiceMark app={app} />
                <span className="settings-app-kind">{app.kind}</span>
                <h3>{app.name}</h3>
                <strong>{app.tagline}</strong>
                <p>{app.description}</p>
                <div>
                  {app.requirements.slice(0, 2).map((item) => (
                    <small key={item}>{item}</small>
                  ))}
                </div>
                <button onClick={() => setInstallId(app.id)}>
                  Review install plan <ChevronRight />
                </button>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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
            <p>Open Apps → Add apps and review the LiteLLM install plan.</p>
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

function Connections() {
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
      <section className="settings-section-intro">
        <span className="eyebrow">
          <Network />
          Private integrations
        </span>
        <h2>Connections</h2>
        <p>
          Connect user-owned data to Workspace without mixing it with system
          operations.
        </p>
      </section>
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
          Use a Nextcloud app password, not your main password. OmniLab reads
          only the selected calendar through CalDAV.
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
      <header className="settings-hub-header">
        <div>
          <span className="eyebrow">OmniLab control center</span>
          <h1>Settings</h1>
          <p>
            Install deliberately, configure only what exists, and keep shared
            connections in one place.
          </p>
        </div>
        <div className="settings-overview-badge">
          <Layers3 />
          <span>
            <strong>One setup surface</strong>
            <small>Apps · models · connections</small>
          </span>
        </div>
      </header>
      <nav className="settings-subnav" aria-label="Settings sections">
        {(
          [
            { id: "apps", label: "Apps", icon: PackageCheck },
            { id: "models", label: "Model access", icon: Sparkles },
            { id: "connections", label: "Connections", icon: Network },
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
      {section === "connections" && <Connections />}
    </div>
  );
}
