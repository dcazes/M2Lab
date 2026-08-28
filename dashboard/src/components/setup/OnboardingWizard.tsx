import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check, Cpu, ExternalLink, Layers, LoaderCircle, Rocket, ShieldCheck, Sparkles, Terminal, ArrowRight, Lock, KeyRound
} from 'lucide-react'
import { toast } from 'sonner'
import { useCatalog } from '../../hooks/useCatalog'
import { useServices } from '../../hooks/useServices'
import {
  fetchSystemStats, fetchSetupJobs, wireModelPipeline, createSetupApproval, startSetupTarget,
  resumeSetupJob, ollamaPullStreamUrl, createAuthentikTempPassword, fetchAudit
} from '../../lib/api'
import type { SetupJob, CatalogApp, AuthentikTempPassword } from '../../lib/types'

function SetupTraceTerminal({ job }: { job: SetupJob }) {
  const lines = job.events.slice(-6)
  const active = ['queued', 'preparing', 'starting', 'waiting', 'configuring', 'verifying'].includes(job.status)
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(job.created_at).getTime()) / 1000))
  const elapsedLabel = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`
  return <div className="setup-trace-terminal" role="status" aria-live="polite" aria-label="Current Authentik setup trace">
    <div><Terminal className="h-3.5 w-3.5" /> <span>live setup trace</span><span className="setup-trace-stage">{job.stage}</span></div>
    <div className="setup-trace-progress"><span>{job.summary}</span><strong>{job.progress}% · {active ? `running ${elapsedLabel}` : job.status}</strong><i><b style={{ width: `${job.progress}%` }} /></i></div>
    {lines.length > 0
      ? lines.map((event, index) => <p key={`${event.timestamp}-${index}`}><span>$</span> {event.message}</p>)
      : <p><span>$</span> Waiting for the first setup event…</p>}
    {job.error && <p className="setup-trace-error"><span>!</span> {job.error}</p>}
  </div>
}

function UsageMeter({ label, total, percent }: { label: string, total: string, percent: number }) {
  const bounded = Math.max(0, Math.min(100, percent))
  const color = bounded >= 90 ? 'bg-rose-500' : bounded >= 75 ? 'bg-amber-400' : 'bg-accent'
  return <div className="usage-meter">
    <div><span>{label}</span><strong>{bounded.toFixed(1)}% <em>in use</em></strong></div>
    <div className="usage-meter-track" aria-label={`${label}: ${bounded.toFixed(1)}% in use`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bounded}>
      <span className={color} style={{ width: `${bounded}%` }} />
    </div>
    <small>{total} total</small>
  </div>
}

function DownloadProgressPanel({ targets, jobByTarget, apps, started }: {
  targets: Set<string>
  jobByTarget: Map<string, SetupJob>
  apps: CatalogApp[]
  started: boolean
}) {
  const entries = [...targets].map(t => ({ target: t, job: jobByTarget.get(t) }))
  const pct = entries.length
    ? Math.round(entries.reduce((s, e) => s + (e.job?.progress ?? 0), 0) / entries.length)
    : 0
  const readyCount = entries.filter(e => e.job?.status === 'ready').length
  const failedCount = entries.filter(e => e.job?.status === 'failed').length
  const actionCount = entries.filter(e => e.job?.status === 'user_action_required').length
  const runningCount = entries.filter(e =>
    ['queued', 'preparing', 'starting', 'waiting', 'configuring', 'verifying'].includes(e.job?.status ?? '')
  ).length
  const notStartedCount = entries.filter(e => !e.job).length

  const appById = useMemo(() => {
    const m = new Map<string, CatalogApp>()
    for (const a of apps) m.set(a.id, a)
    return m
  }, [apps])

  return (
    <div className="space-y-3 bg-surface-2 p-5 border border-border rounded-lg">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-white">Application Downloads</h4>
        <span className="font-mono text-sm text-white">{pct}%</span>
      </div>
      <div className="w-full h-2 bg-bg-base rounded overflow-hidden">
        <div className="h-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-unknown">
        <span className="text-emerald-400">Ready {readyCount}</span> ·{' '}
        <span className="text-amber-400">Running {runningCount}</span> ·{' '}
        <span className="text-blue-400">Action needed {actionCount}</span> ·{' '}
        <span className="text-rose-400">Failed {failedCount}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {entries.map(({ target, job }) => {
          const app = appById.get(target)
          const status = job
            ? job.status === 'ready'
              ? { label: 'Ready', cls: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' }
              : job.status === 'failed'
                ? { label: 'Failed', cls: 'bg-rose-500/20 text-rose-400 border border-rose-500/30' }
                : job.status === 'user_action_required'
                  ? { label: 'Action needed', cls: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' }
                  : { label: 'Starting…', cls: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' }
            : { label: 'Not started', cls: 'bg-surface-1/60 text-unknown border border-border' }
          return (
            <div key={target} className="p-3 bg-bg-base border border-border rounded flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>{app?.icon}</span>
                <span className="font-semibold text-white">{app?.name || target}</span>
                <span className="font-mono text-[11px] text-unknown">{job?.progress ?? 0}%</span>
              </div>
              <span className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold ${status.cls}`}>{status.label}</span>
            </div>
          )
        })}
      </div>
      {!started && entries.length > 0 && notStartedCount === entries.length && (
        <p className="text-xs text-unknown">Downloads haven't started yet — go back to Step 2 to start them.</p>
      )}
    </div>
  )
}

export function OnboardingWizard() {
  const [step, setStep] = useState<number>(1)

  // Selected user-facing applications (Agent-Driven)
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set(['surfsense', 'paperless-ngx', 'actual-budget']))

  // Selected optional support items
  const [selectedSupport, setSelectedSupport] = useState<Set<string>>(new Set(['firecrawl', 'freellmapi']))

  // Model setup state
  const [nvidiaKey, setNvidiaKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [pullEmbeddings, setPullEmbeddings] = useState(true)
  const [wiringBusy, setWiringBusy] = useState(false)
  const [wiredDone, setWiredDone] = useState(false)

  // Live Ollama embedding pull state (streamed via Server-Sent-Events)
  const [pulling, setPulling] = useState(false)
  const [pullProgress, setPullProgress] = useState(0)
  const [pullLog, setPullLog] = useState<string[]>([])
  const [pullError, setPullError] = useState<string | null>(null)
  const [pullDone, setPullDone] = useState(false)
  const pullSourceRef = useRef<EventSource | null>(null)

  // Downloads kickoff flag (set when launchAll succeeds on Step 2)
  const [downloadsStarted, setDownloadsStarted] = useState(false)

  // System & Services queries
  const systemQuery = useQuery({ queryKey: ['system-stats'], queryFn: fetchSystemStats })
  const catalogQuery = useCatalog()
  const servicesQuery = useServices()
  const jobsQuery = useQuery({ queryKey: ['setup-jobs'], queryFn: fetchSetupJobs, refetchInterval: 2000 })
  const auditQuery = useQuery({ queryKey: ['audit'], queryFn: fetchAudit, refetchInterval: 5000 })
  const queryClient = useQueryClient()

  const apps = catalogQuery.data?.apps || []
  const drivenApps = apps.filter(a => a.category === 'agent_driven')
  const supportApps = apps.filter(a => a.category === 'agent_support')

  // Use the canonical Caddy HTTPS origin once ingress is available. This keeps
  // the browser's Authentik session shared with every protected local app.
  const authentikService = servicesQuery.data?.services.find(s => s.id === 'authentik')
  const vaultwardenService = servicesQuery.data?.services.find(s => s.id === 'vaultwarden')
  const authentikAvailable = authentikService?.state === 'running' && authentikService.healthy !== false
  const authentikUrl = authentikService?.tailnet_route_active
    ? (authentikService.tailnet_url || 'http://127.0.0.1:9001')
    : (authentikAvailable ? 'https://127.0.0.1:19462' : (authentikService?.url || 'http://127.0.0.1:9001'))
  const vaultwardenUrl = vaultwardenService?.tailnet_route_active
    ? (vaultwardenService.tailnet_url || 'http://127.0.0.1:8081')
    : 'https://127.0.0.1:19447'

  // Calculate required infrastructure dependencies based on selected driven apps
  const requiredDeps = useMemo(() => {
    const deps = new Set<string>(['open-webui', 'litellm', 'ollama']) // Open WebUI is the default harness & LiteLLM/Ollama are required
    for (const app of drivenApps) {
      if (selectedApps.has(app.id)) {
        for (const dep of app.dependencies || []) {
          deps.add(dep)
        }
      }
    }
    return deps
  }, [selectedApps, drivenApps])

  const toggleDrivenApp = (id: string) => {
    setSelectedApps(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSupportItem = (id: string) => {
    if (requiredDeps.has(id)) return // Locked by dependency
    setSelectedSupport(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleWireModels = async () => {
    setWiringBusy(true)
    setPullError(null)
    try {
      const approval = await createSetupApproval('models', 'model-wire')
      const res = await wireModelPipeline({
        NVIDIA_NIM_API_KEY: nvidiaKey.trim() || undefined,
        GEMINI_API_KEY: geminiKey.trim() || undefined,
        pull_embedding: pullEmbeddings,
      }, approval)
      if (res.ok) {
        setWiredDone(true)
        toast.success('Model pipeline wired! LiteLLM config generated instantly.')
        if (pullEmbeddings) {
          await startOllamaPull()
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setWiringBusy(false)
    }
  }

  const startOllamaPull = async () => {
    setPulling(true)
    setPullProgress(0)
    setPullLog([])
    setPullDone(false)
    setPullError(null)
    let finished = false
    try {
      const approval = await createSetupApproval('ollama', 'model-pull')
      const source = new EventSource(ollamaPullStreamUrl('nomic-embed-text', approval))
      pullSourceRef.current = source
      source.onmessage = (event) => {
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(event.data)
        } catch {
          return
        }
        const status = typeof payload.status === 'string' ? payload.status : ''
        const completed = typeof payload.completed === 'number' ? payload.completed : null
        const total = typeof payload.total === 'number' ? payload.total : null
        setPullLog((prev) => [...prev, status || JSON.stringify(payload)].slice(-200))
        if (completed != null && total && total > 0) {
          setPullProgress(Math.min(100, Math.round((completed / total) * 100)))
        }
        if (status === 'success') {
          finished = true
          setPullDone(true)
          setPulling(false)
          source.close()
          toast.success('Embedding model pulled successfully.')
        } else if (status === 'skipped') {
          finished = true
          setPulling(false)
          source.close()
          toast.info('Ollama is not running yet — the embedding pull will run when Ollama launches.')
        } else if (status === 'error') {
          finished = true
          setPullError(typeof payload.error === 'string' ? payload.error : 'Pull failed')
          setPulling(false)
          source.close()
        }
      }
      source.onerror = () => {
        if (!finished) {
          setPullError('Connection to the pull stream was lost. Retry the pull.')
          setPulling(false)
        }
        source.close()
      }
    } catch (err) {
      setPullError(err instanceof Error ? err.message : String(err))
      setPulling(false)
    }
  }

  const foundationJob = jobsQuery.data?.jobs.find(j => j.target === 'foundation')

  // Launch plan: required infrastructure + selected driven apps + selected support items
  const launchTargets = useMemo(() => {
    const targets = new Set<string>(requiredDeps)
    for (const app of drivenApps) if (selectedApps.has(app.id)) targets.add(app.id)
    for (const app of supportApps) if (selectedSupport.has(app.id)) targets.add(app.id)
    return targets
  }, [requiredDeps, selectedApps, selectedSupport, drivenApps, supportApps])

  // Live setup-job status keyed by target, for honest step-5 status chips
  const jobByTarget = useMemo(() => {
    const byTarget = new Map<string, SetupJob>()
    for (const job of jobsQuery.data?.jobs || []) byTarget.set(job.target, job)
    return byTarget
  }, [jobsQuery.data])

  const [launching, setLaunching] = useState(false)

  const launchAll = async (): Promise<boolean> => {
    if (foundationJob?.status !== 'ready') {
      toast.error('Complete Authentik & Vaultwarden setup on Step 1 before starting downloads')
      return false
    }
    setLaunching(true)
    try {
      for (const target of launchTargets) {
        const approval = await createSetupApproval(target, 'setup-start')
        await startSetupTarget(target, approval)
      }
      await queryClient.invalidateQueries({ queryKey: ['setup-jobs'] })
      toast.success(`Started ${launchTargets.size} application setup job(s)`)
      setDownloadsStarted(true)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setLaunching(false)
    }
  }
  const startFoundation = async () => {
    try {
      const approval = await createSetupApproval('foundation', 'setup-start')
      await startSetupTarget('foundation', approval)
      await queryClient.invalidateQueries({ queryKey: ['setup-jobs'] })
      toast.success('Authentik identity foundation setup started')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const resumeFoundation = async () => {
    if (!foundationJob) return
    try {
      const approval = await createSetupApproval('foundation', 'setup-resume')
      await resumeSetupJob(foundationJob, approval)
      await queryClient.invalidateQueries({ queryKey: ['setup-jobs'] })
      toast.success('Authentik setup resumed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const foundationReady = foundationJob?.status === 'ready'
  const authentikActionNeeded = foundationJob?.status === 'user_action_required' && foundationJob.stage === 'create_owner'
  const tempPasswordIssued = auditQuery.data?.events.some(event => event.event === 'identity.authentik_admin_temp_password') === true
  const vaultwardenActionNeeded = foundationJob?.status === 'user_action_required' && foundationJob.stage === 'create_vaultwarden_owner'
  const authentikCardReady = authentikService?.state === 'running' && authentikService.healthy !== false && !authentikActionNeeded
  const vaultwardenCardReady = vaultwardenService?.state === 'running' && vaultwardenService.healthy !== false && !vaultwardenActionNeeded

  // Authentik's bootstrap token auto-creates the built-in 'akadmin' superuser at
  // first start, which disables the initial-setup flow. The operator logs in with
  // a temporary password (generated here) and changes it on the first prompt.
  const [tempAdmin, setTempAdmin] = useState<AuthentikTempPassword | null>(null)
  const [tempAdminBusy, setTempAdminBusy] = useState(false)
  const [tempAdminError, setTempAdminError] = useState<string | null>(null)

  const generateTempAdmin = async () => {
    setTempAdminBusy(true)
    setTempAdminError(null)
    try {
      setTempAdmin(await createAuthentikTempPassword())
      toast.success('Temporary admin password ready — log in and change it on the first password prompt')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setTempAdminError(msg)
      toast.error(msg)
    } finally {
      setTempAdminBusy(false)
    }
  }

  const handleNextFromSelection = async () => {
    if (!foundationReady) {
      toast.error('Complete Authentik & Vaultwarden setup on Step 1 first')
      return
    }
    const ok = await launchAll()
    if (ok) setStep(3)
  }

  // Authentik & Vaultwarden are the foundation — install them by default as
  // soon as onboarding opens, unless a foundation job already exists.
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (autoStartedRef.current) return
    if (!jobsQuery.data) return // wait for the first status poll
    autoStartedRef.current = true
    const hasFoundation = jobsQuery.data.jobs.some(j => j.target === 'foundation')
    if (!hasFoundation) startFoundation()
  }, [jobsQuery.data])

  return (
    <div className="mx-auto max-w-5xl bg-surface-1 border border-border rounded-xl p-6 md:p-8 shadow-2xl space-y-8">
      {/* Wizard Header Nav */}
      <div className="flex items-center justify-between border-b border-border pb-6">
        <div>
          <span className="eyebrow flex items-center gap-1.5 text-accent font-semibold text-xs uppercase tracking-wider">
            <Sparkles className="h-3.5 w-3.5" /> First-Time Onboarding
          </span>
          <h1 className="text-2xl font-bold text-white mt-1">M2Lab Setup & Initialization</h1>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono">
          {[1, 2, 3, 4, 5].map(s => (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={`w-8 h-8 rounded-full font-bold transition-all ${
                step === s
                  ? 'bg-accent text-bg-base ring-2 ring-accent/50'
                  : step > s
                  ? 'bg-surface-2 text-white border border-accent/40'
                  : 'bg-surface-2 text-unknown border border-border'
              }`}
            >
              {step > s ? <Check className="h-4 w-4 mx-auto" /> : s}
            </button>
          ))}
        </div>
      </div>

      {/* STEP 1: Host & Identity Foundation */}
      {step === 1 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <section className="host-foundation-panel">
            <div className="host-foundation-intro">
              <ShieldCheck className="h-6 w-6 text-accent shrink-0" />
              <div>
                <h2 className="text-lg font-bold text-white">Host readiness</h2>
                <p>Local Docker access, available capacity, and private networking.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-surface-2 border border-border rounded-lg space-y-2">
              <span className="text-xs font-mono text-unknown">Docker Engine</span>
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-white">Status</span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${systemQuery.data?.docker_ok ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400'}`}>
                  {systemQuery.data?.docker_ok ? 'Ready' : 'Not Connected'}
                </span>
              </div>
              <p className={`text-xs ${systemQuery.data?.docker_group?.active ? 'text-emerald-400' : 'text-amber-400'}`}>
                {systemQuery.data?.docker_group
                  ? systemQuery.data.docker_group.active
                    ? `${systemQuery.data.docker_group.user} is active in the docker group`
                    : systemQuery.data.docker_group.member
                      ? `${systemQuery.data.docker_group.user} is in the docker group; sign out/in to activate it`
                      : `${systemQuery.data.docker_group.user} is not in the docker group`
                  : 'Checking docker group access…'}
              </p>
            </div>

            <div className="p-4 bg-surface-2 border border-border rounded-lg space-y-2">
              <span className="text-xs font-mono text-unknown">Memory & Storage</span>
              {systemQuery.data?.mem && systemQuery.data?.disk
                ? <div className="space-y-2"><UsageMeter label="RAM" total={`${Math.round(systemQuery.data.mem.total / 1073741824)} GB`} percent={systemQuery.data.mem.percent} /><UsageMeter label="Disk" total={`${Math.round(systemQuery.data.disk.total / 1073741824)} GB`} percent={systemQuery.data.disk.percent} /></div>
                : <span className="text-sm text-unknown">Checking resource usage…</span>}
            </div>

            <div className="p-4 bg-surface-2 border border-border rounded-lg space-y-2">
              <span className="text-xs font-mono text-unknown">Tailscale Support</span>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">{systemQuery.data?.tailscale?.hostname || 'Localhost'}</span>
                {systemQuery.data?.tailscale_required ? (
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${systemQuery.data?.tailscale?.connected ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400'}`}>
                    {systemQuery.data?.tailscale?.connected ? 'Connected' : 'Required'}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Loopback
                  </span>
                )}
              </div>
              {!systemQuery.data?.tailscale_required && (
                <p className="text-xs text-unknown">Running on 127.0.0.1 — Tailscale not required.</p>
              )}
            </div>
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 1: Authentik — SSO identity provider */}
            <div className="p-5 bg-surface-2 border border-border rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="eyebrow text-accent">1 · Single Sign-On</span>
                  <h3 className="text-base font-bold text-white">Authentik</h3>
                </div>
                <span className={`px-2.5 py-1 rounded text-xs font-bold ${
                  authentikCardReady ? 'bg-emerald-500/20 text-emerald-400'
                    : foundationJob?.status === 'failed' ? 'bg-rose-500/20 text-rose-400'
                    : authentikActionNeeded ? 'bg-blue-500/20 text-blue-400'
                    : !foundationJob ? 'bg-surface-1/60 text-unknown border border-border'
                    : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {authentikCardReady ? 'Ready'
                    : foundationJob?.status === 'failed' ? 'Failed'
                    : authentikActionNeeded ? 'Confirm setup'
                    : !foundationJob ? 'Not Started' : 'Installing…'}
                </span>
              </div>

              <p className="text-xs text-unknown">
                The identity provider. One sign-in authorizes every M2Lab app, including Vaultwarden SSO.
              </p>

              <div className="p-2.5 bg-accent/10 border border-accent/30 rounded flex flex-col items-stretch gap-2">
                <span className="min-w-0 text-[11px] text-unknown break-words">Login at <code className="text-white break-all">{authentikUrl}</code></span>
                {authentikAvailable
                  ? <a href={authentikUrl} target="_blank" rel="noreferrer" className="button-secondary text-xs flex items-center gap-1 w-full">Open Authentik <ExternalLink className="h-3.5 w-3.5" /></a>
                  : <span className="text-[11px] text-unknown">Authentik will become available here once its container is healthy.</span>}
              </div>

              {authentikActionNeeded && (
                <div className="p-2.5 bg-accent/10 border border-accent/30 rounded space-y-2">
                  <p className="text-xs text-white">
                    Log in as <code className="text-accent">akadmin</code> with the temporary password below.
                  </p>
                  {tempAdmin ? (
                    <div className="space-y-2">
                      <code className="block w-full overflow-x-auto whitespace-nowrap text-xs text-white font-mono select-all">{tempAdmin.temp_password}</code>
                      <a href={tempAdmin.login_url} target="_blank" rel="noreferrer" className="button-primary text-xs flex items-center gap-1 w-full">
                        Log in to Authentik <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <p className="text-[11px] text-unknown">Authentik will require a new password immediately after you sign in. Choose at least {tempAdmin.requirements.min_length} characters.</p>
                    </div>
                  ) : tempPasswordIssued ? (
                    <span className="text-[11px] text-unknown">A temporary password was already issued. It is intentionally unavailable here so this page cannot overwrite it.</span>
                  ) : (
                    <div className="space-y-2">
                      <span className="text-[11px] text-unknown">Generate this only before the first Authentik sign-in. It cannot be rotated from this page after issuance.</span>
                      <button className="button-secondary text-xs flex items-center gap-1 w-full" onClick={generateTempAdmin} disabled={tempAdminBusy}>
                        {tempAdminBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                        Generate one-time password
                      </button>
                    </div>
                  )}
                  {tempAdminError && <p className="text-[11px] text-rose-400">{tempAdminError}</p>}
                </div>
              )}

              <div className="pt-1">
                {!foundationJob ? (
                  <button className="button-primary text-xs" onClick={startFoundation}>Start Authentik Setup</button>
                ) : foundationJob.status === 'user_action_required' ? (
                  authentikActionNeeded && <button className="button-primary text-xs" onClick={resumeFoundation}>I changed the Authentik password — continue</button>
                ) : foundationJob.status === 'failed' ? (
                  <div className="space-y-3">
                    <SetupTraceTerminal job={foundationJob} />
                    <button className="button-primary text-xs" onClick={startFoundation}>Retry Authentik Setup</button>
                  </div>
                ) : foundationJob.status === 'ready' ? (
                  <span className="text-xs text-emerald-400 font-bold flex items-center gap-1"><Check className="h-4 w-4" /> Admin account created</span>
                ) : <SetupTraceTerminal job={foundationJob} />}
              </div>
            </div>

            {/* Card 2: Tailscale — HTTPS door */}
            <div className="p-5 bg-surface-2 border border-border rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="eyebrow text-amber-400">2 · HTTPS Door</span>
                  <h3 className="text-base font-bold text-white">Tailscale Access</h3>
                </div>
                {systemQuery.data?.tailscale_required ? (
                  <span className={`px-2.5 py-1 rounded text-xs font-bold ${
                    systemQuery.data?.tailscale?.connected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    {systemQuery.data?.tailscale?.connected ? 'Connected' : 'Required'}
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded text-xs font-bold bg-emerald-500/20 text-emerald-400">Loopback HTTPS</span>
                )}
              </div>

              <p className="text-xs text-unknown">
                The network door. Caddy serves Authentik and Vaultwarden over a machine-local HTTPS port now; Tailscale opens the same URLs to your other devices later.
              </p>

              {!systemQuery.data?.tailscale_required ? (
                <div className="text-[11px] text-unknown space-y-1">
                  <p className="flex items-start gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span>Local HTTPS via Caddy is active.<code className="block mt-1 text-white">127.0.0.1</code></span>
                  </p>
                  <p className="flex items-start gap-1.5"><KeyRound className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span>To remove the browser's local HTTPS warning, trust Caddy's root certificate:<code className="block mt-1 text-white whitespace-nowrap">.state/caddy-local-root.crt</code></span>
                  </p>
                </div>
              ) : (
                <div className="text-[11px] text-unknown">
                  Tailscale must be connected and serving the tailnet HTTPS ports before apps are exposed.
                </div>
              )}
            </div>

            {/* Card 3: Vaultwarden — password vault with SSO */}
            <div className="p-5 bg-surface-2 border border-border rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="eyebrow text-emerald-400">3 · Password Vault</span>
                  <h3 className="text-base font-bold text-white">Vaultwarden</h3>
                </div>
                <span className={`px-2.5 py-1 rounded text-xs font-bold ${
                  vaultwardenCardReady ? 'bg-emerald-500/20 text-emerald-400'
                    : vaultwardenActionNeeded ? 'bg-blue-500/20 text-blue-400'
                    : !foundationJob ? 'bg-surface-1/60 text-unknown border border-border'
                    : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {vaultwardenCardReady ? 'Ready'
                    : vaultwardenActionNeeded ? 'Action needed'
                    : !foundationJob ? 'Not Started' : 'Installing…'}
                </span>
              </div>

              <p className="text-xs text-unknown">
                Protected by your Authentik session. Opening the vault redirects through the same sign-on as the rest of M2Lab.
              </p>

              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded flex items-center justify-between gap-2">
                <span className="text-[11px] text-white">Open vault with Authentik SSO</span>
                <a href={vaultwardenUrl} target="_blank" rel="noreferrer" className="button-secondary text-xs flex items-center gap-1 shrink-0">
                  Open Vault <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              {vaultwardenActionNeeded && (
                <div className="space-y-2">
                  <p className="text-xs text-unknown">Complete the initial vault setup, then continue. Later visits use the Authentik SSO entry above.</p>
                  <button className="button-primary text-xs w-full" onClick={resumeFoundation}>Confirm Vaultwarden Created</button>
                </div>
              )}
            </div>
          </div>

          {!foundationReady && (
            <p className="text-xs text-unknown">You can browse app selection while Authentik finishes — downloads start on the next page once it's ready.</p>
          )}

          <div className="flex justify-end pt-4">
            <button className="button-primary flex items-center gap-2" onClick={() => setStep(2)}>
              Continue to App Selection <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: App Selection & Automatic Dependency Lock */}
      {step === 2 && (
        <div className="space-y-8 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold text-white">2. Application & Capability Selection</h2>
            <p className="text-sm text-unknown mt-1">
              First, choose your <strong>Agent-Driven Applications</strong>. Required AI infrastructure (LiteLLM, Ollama, Open WebUI) will automatically lock and configure.
            </p>
          </div>

          {/* Section A: Agent-Driven Applications */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Layers className="h-5 w-5 text-emerald-400" />
              <h3 className="text-lg font-bold text-white">1. Choose Your Applications</h3>
              <span className="text-xs text-unknown">(Knowledge bases, Finance, Travel & Documents)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {drivenApps.map(app => (
                <div
                  key={app.id}
                  onClick={() => toggleDrivenApp(app.id)}
                  className={`p-4 rounded-lg border cursor-pointer transition-all space-y-3 ${
                    selectedApps.has(app.id)
                      ? 'bg-surface-2 border-emerald-500 shadow-md'
                      : 'bg-surface-1/50 border-border opacity-70 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{app.icon}</span>
                      <div>
                        <h4 className="text-base font-bold text-white">{app.name}</h4>
                        <p className="text-xs text-unknown">{app.tagline}</p>
                      </div>
                    </div>
                    <input type="checkbox" checked={selectedApps.has(app.id)} readOnly className="h-4 w-4 rounded accent-emerald-500" />
                  </div>
                  <p className="text-xs text-unknown line-clamp-2">{app.description}</p>

                  {app.mcp_summary && (
                    <details
                      className="p-2.5 bg-bg-base/60 rounded border border-border/50 text-xs"
                      onClick={event => event.stopPropagation()}
                    >
                      <summary className="cursor-pointer list-none font-semibold text-emerald-400 flex items-center gap-1">
                        <Terminal className="h-3 w-3" /> MCP Summary & Example Prompts
                        <span className="ml-auto text-[10px] text-unknown font-normal">Show details</span>
                      </summary>
                      <div className="mt-2 space-y-1.5">
                        <p className="text-unknown text-[11px]">{app.mcp_summary.summary}</p>
                        {app.mcp_summary.example_prompts.map((promptText: string, idx: number) => (
                          <div key={idx} className="text-[10px] text-emerald-300 font-mono bg-emerald-500/10 px-2 py-0.5 rounded">
                            "{promptText}"
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {app.links && (
                    <div className="flex gap-3 text-xs pt-1" onClick={e => e.stopPropagation()}>
                      {app.links.homepage && <a href={app.links.homepage} target="_blank" rel="noreferrer" className="text-accent hover:underline flex items-center gap-1">Website <ExternalLink className="h-3 w-3" /></a>}
                      {app.links.source && <a href={app.links.source} target="_blank" rel="noreferrer" className="text-unknown hover:text-white flex items-center gap-1">Source <ExternalLink className="h-3 w-3" /></a>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Section B: Support & Infrastructure (Auto-Locked dependencies) */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Cpu className="h-5 w-5 text-accent" />
              <h3 className="text-lg font-bold text-white">2. AI Support & Infrastructure Stack</h3>
              <span className="text-xs text-unknown">(Open WebUI Harness, Model Gateways & Scraping)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {supportApps.map(app => {
                const isLocked = requiredDeps.has(app.id)
                const isChecked = isLocked || selectedSupport.has(app.id)

                return (
                  <div
                    key={app.id}
                    onClick={() => toggleSupportItem(app.id)}
                    className={`p-4 rounded-lg border transition-all space-y-3 ${
                      isLocked
                        ? 'bg-surface-2/80 border-accent/60 shadow-sm cursor-default'
                        : isChecked
                        ? 'bg-surface-2 border-accent cursor-pointer'
                        : 'bg-surface-1/50 border-border opacity-70 cursor-pointer hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{app.icon}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-base font-bold text-white">{app.name}</h4>
                            {isLocked && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent/20 text-accent border border-accent/40 flex items-center gap-1">
                                <Lock className="h-2.5 w-2.5" /> Required Dependency
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-unknown">{app.tagline}</p>
                        </div>
                      </div>
                      <input type="checkbox" checked={isChecked} disabled={isLocked} readOnly className="h-4 w-4 rounded accent-accent" />
                    </div>
                    <p className="text-xs text-unknown line-clamp-2">{app.description}</p>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button className="button-secondary" onClick={() => setStep(1)}>Back</button>
            <div className="flex flex-col items-end gap-1">
              <button
                className="button-primary flex items-center gap-2"
                disabled={launching || !foundationReady}
                onClick={handleNextFromSelection}
              >
                {launching ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Start Downloads & Continue to API Keys
              </button>
              {!foundationReady && (
                <span className="text-xs text-unknown">Complete Authentik & Vaultwarden setup on Step 1 to start downloads.</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: API Keys & Provider Access */}
      {step === 3 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold text-white">3. API Keys & Provider Access</h2>
            <p className="text-sm text-unknown mt-1">
              Paste your provider keys (from Vaultwarden) while your applications download in the background.
            </p>
          </div>

          <div className="space-y-4 bg-surface-2 p-5 border border-border rounded-lg">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-sm font-bold text-white">1. Enter API Keys (NVIDIA NIM Recommended)</h4>
                <p className="text-xs text-unknown">NVIDIA NIM offers a generous free tier with fast llama-3 models.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-white flex items-center gap-1">
                  <KeyRound className="h-3 w-3 text-accent" /> NVIDIA NIM API Key (Recommended)
                </span>
                <input
                  type="password"
                  value={nvidiaKey}
                  onChange={e => setNvidiaKey(e.target.value)}
                  placeholder="nvapi-..."
                  className="w-full text-xs p-2.5 bg-bg-base border border-border rounded text-white"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold text-white flex items-center gap-1">
                  <KeyRound className="h-3 w-3 text-accent" /> Google Gemini API Key
                </span>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full text-xs p-2.5 bg-bg-base border border-border rounded text-white"
                />
              </label>
            </div>
          </div>

          <DownloadProgressPanel targets={launchTargets} jobByTarget={jobByTarget} apps={apps} started={downloadsStarted} />

          <div className="flex justify-between pt-4">
            <button className="button-secondary" onClick={() => setStep(2)}>Back</button>
            <button className="button-primary flex items-center gap-2" onClick={() => setStep(4)}>
              Continue to Model Wiring <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: AI Setup & Gateway Wiring */}
      {step === 4 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold text-white">4. AI Model Pipeline Setup</h2>
            <p className="text-sm text-unknown mt-1">
              With your provider keys entered on Step 3, configure local embeddings. Model routing: <code>API Key → FreeLLMAPI → LiteLLM → Open WebUI / SurfSense</code>.
            </p>
          </div>

          <div className="space-y-3 bg-surface-2 p-5 border border-border rounded-lg">
            <h4 className="text-sm font-bold text-white">2. Local Embedding Model Requirement</h4>
            <p className="text-xs text-unknown">
              SurfSense and Paperless require a 768-dimension embedding model (<code>nomic-embed-text</code>). M2Lab will automatically pull this via local Ollama.
            </p>
            <label className="flex items-center gap-2 text-xs font-semibold text-white cursor-pointer">
              <input
                type="checkbox"
                checked={pullEmbeddings}
                onChange={e => setPullEmbeddings(e.target.checked)}
                className="h-4 w-4 rounded accent-accent"
              />
              <span>Automatically pull <code>nomic-embed-text</code> in Ollama upon confirmation</span>
            </label>
          </div>

          <DownloadProgressPanel targets={launchTargets} jobByTarget={jobByTarget} apps={apps} started={downloadsStarted} />

          <div className="flex items-center justify-between pt-4">
            <button className="button-secondary" onClick={() => setStep(3)}>Back</button>
            <button
              className="button-primary flex items-center gap-2"
              onClick={handleWireModels}
              disabled={wiringBusy}
            >
              {wiringBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {wiredDone ? 'Re-wire Model Pipeline' : 'Approve & Wire Model Pipeline'}
            </button>
          </div>

          {pulling && (
            <div className="space-y-2 bg-surface-2 p-4 border border-border rounded-lg">
              <div className="flex items-center justify-between text-xs text-white">
                <span className="font-semibold flex items-center gap-1.5">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Pulling nomic-embed-text…
                </span>
                <span className="font-mono">{pullProgress}%</span>
              </div>
              <div className="w-full h-2 bg-bg-base rounded overflow-hidden">
                <div className="h-full bg-accent transition-all duration-300" style={{ width: `${pullProgress}%` }} />
              </div>
              <pre className="text-[10px] text-unknown max-h-32 overflow-auto font-mono whitespace-pre-wrap">{pullLog.join('\n')}</pre>
            </div>
          )}

          {pullDone && !pulling && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs text-emerald-400 font-semibold flex items-center gap-1">
              <Check className="h-3.5 w-3.5" /> Embedding model pulled successfully.
            </div>
          )}

          {pullError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-xs text-rose-400 font-semibold">
              Embedding pull issue: {pullError}
            </div>
          )}

          {wiredDone && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs text-emerald-400 font-semibold flex items-center justify-between">
              <span>✓ Model pipeline wired successfully!</span>
              <button className="underline" onClick={() => setStep(5)}>Proceed to Launch & Workspace →</button>
            </div>
          )}
        </div>
      )}

      {/* STEP 5: Summary & Launch */}
      {step === 5 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="text-center space-y-2 py-4">
            <span className="text-4xl">🚀</span>
            <h2 className="text-2xl font-bold text-white">Launch Your Workspace</h2>
            <p className="text-sm text-unknown max-w-lg mx-auto">
              Your applications are downloading in the background as setup jobs — the same jobs the Settings tab drives — and progress below updates live.
            </p>
          </div>

          <DownloadProgressPanel targets={launchTargets} jobByTarget={jobByTarget} apps={apps} started={downloadsStarted} />

          {(() => {
            const startedCount = [...launchTargets].filter(t => jobByTarget.has(t)).length
            const failedCount = [...launchTargets].filter(t => jobByTarget.get(t)?.status === 'failed').length
            if (startedCount === 0) {
              return (
                <div className="flex justify-center pt-1">
                  <button className="button-primary flex items-center gap-2 px-8 py-3 text-base" onClick={launchAll} disabled={launching}>
                    {launching ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Rocket className="h-5 w-5" />}
                    {launching ? 'Starting applications…' : `Launch ${launchTargets.size} Selected Applications`}
                  </button>
                </div>
              )
            }
            if (failedCount > 0) {
              return (
                <div className="flex justify-center pt-1">
                  <button className="button-primary flex items-center gap-2 px-8 py-3 text-base" onClick={launchAll} disabled={launching}>
                    {launching ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Rocket className="h-5 w-5" />}
                    {launching ? 'Retrying failed applications…' : 'Retry Failed Applications'}
                  </button>
                </div>
              )
            }
            return (
              <div className="flex justify-center pt-1">
                <span className="text-sm text-unknown">All applications are downloading or ready.</span>
              </div>
            )
          })()}

          <div className="p-5 bg-surface-2 border border-border rounded-lg space-y-4">
            <h4 className="text-sm font-bold text-white border-b border-border pb-2">Selected Applications & Endpoints</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {apps.filter(a => selectedApps.has(a.id) || requiredDeps.has(a.id) || selectedSupport.has(a.id)).map(app => {
                const target = app.service_id || app.id
                const job = jobByTarget.get(target)
                const status = job
                  ? job.status === 'ready'
                    ? { label: 'Ready', cls: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' }
                    : job.status === 'failed'
                      ? { label: 'Failed', cls: 'bg-rose-500/20 text-rose-400 border border-rose-500/30' }
                      : job.status === 'user_action_required'
                        ? { label: 'Action needed', cls: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' }
                        : { label: 'Starting…', cls: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' }
                  : { label: 'Not started', cls: 'bg-surface-1/60 text-unknown border border-border' }
                return (
                  <div key={app.id} className="p-3 bg-bg-base border border-border rounded flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{app.icon}</span>
                      <span className="font-semibold text-white">{app.name}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold ${status.cls}`}>{status.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex justify-center pt-4">
            <a href="/" className="button-primary px-8 py-3 text-base flex items-center gap-2">
              Go to M2Lab Workspace <ArrowRight className="h-5 w-5" />
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
