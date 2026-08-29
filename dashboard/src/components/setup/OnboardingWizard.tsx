import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check, Cpu, ExternalLink, Layers, LoaderCircle, ShieldCheck, Sparkles, Terminal, ArrowRight, Lock, KeyRound,
  Eye, EyeOff
} from 'lucide-react'
import { toast } from 'sonner'
import { useCatalog } from '../../hooks/useCatalog'
import { useServices } from '../../hooks/useServices'
import {
  fetchSystemStats, fetchSetupJobs, fetchSetupBatches, wireModelPipeline, validateModelAccess, createSetupApproval,
  startSetupBatch, resumeSetupBatch, cancelSetupBatch, startSetupTarget, resumeSetupJob, createAuthentikTempPassword, fetchAudit
} from '../../lib/api'
import type { SetupJob, SetupBatch, CatalogApp, AuthentikTempPassword, ModelAccessValidationResponse } from '../../lib/types'

function KeyInput({ label, value, onChange, placeholder, prefix }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  prefix: string
}) {
  const [visible, setVisible] = useState(false)
  const trimmed = value.trim()
  const valid = trimmed.startsWith(prefix) && trimmed.length > prefix.length
  const inputId = `provider-key-${prefix.replace(/\W/g, '').toLowerCase()}`
  return <div className="space-y-1">
    <label htmlFor={inputId} className="text-xs font-semibold text-white flex items-center gap-1">
      <KeyRound className="h-3 w-3 text-accent" /> {label}
    </label>
    <div className="relative">
      <input id={inputId} type={visible ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoComplete="off"
        className={`w-full text-xs p-2.5 pr-10 bg-bg-base border rounded text-white ${trimmed ? (valid ? 'border-emerald-500/50' : 'border-rose-500/50') : 'border-border'}`} />
      <button type="button" onClick={() => setVisible(current => !current)}
        className="absolute inset-y-0 right-0 px-3 text-unknown hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-r"
        aria-label={`${visible ? 'Hide' : 'Show'} ${label}`} title={`${visible ? 'Hide' : 'Show'} key`}>
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
    {trimmed && <p className={`text-[11px] ${valid ? 'text-emerald-400' : 'text-rose-400'}`} role="status">
      {valid ? <><Check className="inline h-3 w-3 mr-1" />Looks valid</> : `Expected a key beginning with ${prefix}`}
    </p>}
  </div>
}

const AI_INFRASTRUCTURE_IDS = new Set(['litellm', 'freellmapi', 'firecrawl', 'ollama'])

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

function BatchProgressPanel({ batch, apps }: { batch?: SetupBatch; apps: CatalogApp[] }) {
  if (!batch) return <div className="p-5 bg-surface-2 border border-border rounded-lg text-sm text-unknown">Safe sequential setup has not started.</div>
  const names = new Map(apps.filter(app => app.service_id).map(app => [app.service_id as string, app]))
  const formatBytes = (value: number) => `${(value / 1024 ** 3).toFixed(1)} GB`
  const projectedPercent = batch.host_total_bytes ? Math.min(100, batch.projected_bytes / batch.host_total_bytes * 100) : 0
  const current = batch.items[batch.current_index]
  return <div className="space-y-4 bg-surface-2 p-5 border border-border rounded-lg" aria-live="polite">
    <div className="flex items-center justify-between gap-4">
      <div><h4 className="text-sm font-bold text-white">Safe Sequential Setup</h4><p className="text-xs text-unknown capitalize">{batch.phase.replace(/_/g, ' ')}</p></div>
      <span className="font-mono text-xs text-white">{batch.items.filter(item => item.status === 'ready').length}/{batch.items.length} ready</span>
    </div>
    {current && !['ready', 'cancelled'].includes(batch.status) && <p className="text-xs text-unknown">Current service: <strong className="text-white">{names.get(current.service_id)?.name || current.service_id}</strong></p>}
    <div className="grid grid-cols-3 gap-2 text-center text-xs">
      <div className="p-2 bg-bg-base rounded"><span className="block text-unknown">Measured peaks</span><strong className="text-white">{formatBytes(batch.measured_bytes)}</strong></div>
      <div className="p-2 bg-bg-base rounded"><span className="block text-unknown">Projected</span><strong className="text-white">{formatBytes(batch.projected_bytes)}</strong></div>
      <div className="p-2 bg-bg-base rounded"><span className="block text-unknown">Reserved</span><strong className="text-white">{formatBytes(batch.host_total_bytes * batch.reserve_ratio)}</strong></div>
    </div>
    <div className="space-y-1">
      <div className="flex justify-between text-xs"><span className="text-unknown">Projected initialization / idle RAM</span><strong className={projectedPercent > 80 ? 'text-rose-400' : 'text-white'}>{formatBytes(batch.projected_bytes)} · {projectedPercent.toFixed(1)}%</strong></div>
      <div className="h-2 bg-bg-base rounded overflow-hidden"><div className={projectedPercent > 80 ? 'h-full bg-rose-500' : 'h-full bg-accent'} style={{ width: `${projectedPercent}%` }} /></div>
      <p className="text-[11px] text-unknown">20% host reserve enforced. Active OCR, indexing, crawling, and inference can use more.</p>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
      {batch.items.map(item => {
        const app = names.get(item.service_id)
        const ready = item.status === 'ready'
        const failed = item.status === 'failed'
        return <div key={item.service_id} className="p-3 bg-bg-base border border-border rounded flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><span>{app?.icon || (item.role === 'infrastructure' ? '⚙' : '◌')}</span><span><strong className="block text-white">{app?.name || item.service_id}</strong><small className="capitalize text-unknown">{item.phase.replace(/_/g, ' ')}</small></span></span>
          <span className={`px-2 py-0.5 rounded font-mono text-[10px] ${ready ? 'bg-emerald-500/20 text-emerald-400' : failed ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'}`}>{ready ? 'Ready' : failed ? 'Failed' : item.status === 'prepared' ? 'Prepared' : 'Working'}</span>
        </div>
      })}
    </div>
    <div className="setup-trace-terminal download-trace">
      <div><Terminal className="h-3.5 w-3.5" /><span>sequential setup trace</span><span className="setup-trace-stage">{batch.events.length} events</span></div>
      {batch.events.slice(-30).map((event, index) => <p key={`${event.timestamp}-${index}`} className={event.status === 'failed' ? 'setup-trace-error' : undefined}><span>{event.status === 'failed' ? '!' : '$'}</span> <strong>{event.service_id || 'batch'}:</strong> {event.message}</p>)}
      {batch.error && <p className="setup-trace-error"><span>!</span> {batch.error}</p>}
    </div>
  </div>
}

export function OnboardingWizard({ onGoWorkspace }: { onGoWorkspace?: () => void }) {
  const [step, setStep] = useState<number>(1)

  // Selected user-facing applications (Agent-Driven)
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set(['surfsense', 'paperless-ngx', 'actual-budget']))

  // Selected optional support items
  const [selectedSupport, setSelectedSupport] = useState<Set<string>>(new Set(['firecrawl', 'freellmapi']))

  // Model setup state
  const [nvidiaKey, setNvidiaKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [pullEmbeddings, setPullEmbeddings] = useState(true)
  const [localOnly, setLocalOnly] = useState(false)
  const [validationBusy, setValidationBusy] = useState(false)
  const [validationResults, setValidationResults] = useState<ModelAccessValidationResponse | null>(null)
  const [wiringBusy, setWiringBusy] = useState(false)
  const [operationStatus, setOperationStatus] = useState<string | null>(null)
  const [wiredDone, setWiredDone] = useState(false)

  // System & Services queries
  const systemQuery = useQuery({ queryKey: ['system-stats'], queryFn: fetchSystemStats })
  const catalogQuery = useCatalog()
  const servicesQuery = useServices()
  const jobsQuery = useQuery({ queryKey: ['setup-jobs'], queryFn: fetchSetupJobs, refetchInterval: 2000 })
  const batchesQuery = useQuery({ queryKey: ['setup-batches'], queryFn: fetchSetupBatches, refetchInterval: 2000 })
  const auditQuery = useQuery({ queryKey: ['audit'], queryFn: fetchAudit, refetchInterval: 5000 })
  const queryClient = useQueryClient()

  const apps = catalogQuery.data?.apps || []
  const drivenApps = apps.filter(a => a.category === 'agent_driven')
  const supportApps = apps.filter(a => a.category === 'agent_support')
  const nvidiaFormatValid = nvidiaKey.trim().startsWith('nvapi-') && nvidiaKey.trim().length > 'nvapi-'.length
  const geminiFormatValid = geminiKey.trim().startsWith('AIzaSy') && geminiKey.trim().length > 'AIzaSy'.length
  const hasMalformedKey = !localOnly && Boolean(
    (nvidiaKey.trim() && !nvidiaFormatValid) || (geminiKey.trim() && !geminiFormatValid)
  )
  const canWireModels = localOnly || ((nvidiaFormatValid || geminiFormatValid) && !hasMalformedKey)
  const activeBatch = batchesQuery.data?.batches[0]

  // Tailscale is the only browser origin. This keeps the Authentik session
  // consistent on this host and every other device on the tailnet.
  const authentikService = servicesQuery.data?.services.find(s => s.id === 'authentik')
  const vaultwardenService = servicesQuery.data?.services.find(s => s.id === 'vaultwarden')
  const authentikAvailable = authentikService?.state === 'running' && authentikService.healthy !== false && authentikService.tailnet_route_active
  const authentikUrl = authentikService?.tailnet_url || ''
  const vaultwardenUrl = vaultwardenService?.tailnet_url || ''

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
    const nvidia = localOnly ? '' : nvidiaKey.trim()
    const gemini = localOnly ? '' : geminiKey.trim()
    const nvidiaValid = nvidia.startsWith('nvapi-') && nvidia.length > 'nvapi-'.length
    const geminiValid = gemini.startsWith('AIzaSy') && gemini.length > 'AIzaSy'.length
    const malformedKey = Boolean((nvidia && !nvidiaValid) || (gemini && !geminiValid))
    if ((!localOnly && !nvidiaValid && !geminiValid) || malformedKey) {
      toast.error('Correct the provider key format before continuing')
      return
    }
    setValidationBusy(true)
    setOperationStatus('Validating provider access…')
    setValidationResults(null)
    try {
      if (!localOnly || nvidia || gemini) {
        const validation = await validateModelAccess({
          NVIDIA_NIM_API_KEY: nvidia || undefined,
          GEMINI_API_KEY: gemini || undefined,
          check_ollama: true,
        })
        setValidationResults(validation)
        if (!validation.ok) {
          toast.error('One or more provider keys could not be validated')
          return
        }
      }

      setValidationBusy(false)
      setWiringBusy(true)
      setOperationStatus('Saving validated model routing…')
      const approval = await createSetupApproval('models', 'model-wire')
      const res = await wireModelPipeline({
        NVIDIA_NIM_API_KEY: nvidia || undefined,
        GEMINI_API_KEY: gemini || undefined,
        pull_embedding: pullEmbeddings,
      }, approval)
      if (res.ok) {
        setWiredDone(true)
        setWiringBusy(false)
        setOperationStatus('Starting safe sequential setup… this can take a few minutes while services are prepared.')
        toast.success('Model pipeline wired. Safe sequential setup is starting.')
        const started = await launchAll()
        if (started) setStep(4)
      }
    } catch (err) {
      const status = (err as Error & { status?: number })?.status
      toast.error(status === 404 || status === 405
        ? 'The running dashboard backend is out of date; restart the M2Lab control plane.'
        : err instanceof Error ? err.message : String(err))
    } finally {
      setValidationBusy(false)
      setWiringBusy(false)
      setOperationStatus(null)
    }
  }

  const foundationJob = jobsQuery.data?.jobs.find(j => j.target === 'foundation')

  // Launch plan: required infrastructure + selected driven apps + selected support items
  const launchTargets = useMemo(() => {
    const appById = new Map(apps.map(app => [app.id, app]))
    const targets = new Set<string>()
    const addServiceTarget = (appId: string) => {
      const serviceId = appById.get(appId)?.service_id
      if (serviceId) targets.add(serviceId)
    }
    for (const appId of requiredDeps) addServiceTarget(appId)
    for (const app of drivenApps) if (selectedApps.has(app.id)) addServiceTarget(app.id)
    for (const app of supportApps) if (selectedSupport.has(app.id)) addServiceTarget(app.id)
    return targets
  }, [apps, requiredDeps, selectedApps, selectedSupport, drivenApps, supportApps])

  const [launching, setLaunching] = useState(false)

  const launchAll = async (): Promise<boolean> => {
    if (foundationJob?.status !== 'ready') {
      toast.error('Complete Authentik & Vaultwarden setup on Step 1 before starting downloads')
      return false
    }
    setLaunching(true)
    try {
      const approval = await createSetupApproval('onboarding', 'setup-batch-start')
      await startSetupBatch([...launchTargets], approval, pullEmbeddings)
      await queryClient.invalidateQueries({ queryKey: ['setup-batches'] })
      toast.success(`Started safe sequential setup for ${launchTargets.size} selected services`)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setLaunching(false)
    }
  }
  const resumeBatch = async () => {
    if (!activeBatch) return
    setLaunching(true)
    try {
      const approval = await createSetupApproval('onboarding', 'setup-batch-resume')
      await resumeSetupBatch(activeBatch.id, approval)
      await queryClient.invalidateQueries({ queryKey: ['setup-batches'] })
      toast.success('Sequential setup resumed after rechecking host capacity')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLaunching(false)
    }
  }
  const cancelBatch = async () => {
    if (!activeBatch) return
    setLaunching(true)
    try {
      const approval = await createSetupApproval('onboarding', 'setup-batch-cancel')
      await cancelSetupBatch(activeBatch.id, approval)
      await queryClient.invalidateQueries({ queryKey: ['setup-batches'] })
      toast.info('Remaining onboarding work was cancelled; prepared services and data were preserved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLaunching(false)
    }
  }

  const canonicalBatchUrl = (serviceId: string) => {
    if (serviceId === 'ollama') return null
    const service = servicesQuery.data?.services.find(candidate => candidate.id === serviceId)
    if (service?.tailnet_route_active && service.tailnet_url) return service.tailnet_url
    return null
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
    setStep(3)
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
          {[1, 2, 3, 4].map(s => (
            <button
              key={s}
              onClick={() => setStep(s)}
              aria-label={`Go to onboarding step ${s}`}
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
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${systemQuery.data?.tailscale?.connected ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400'}`}>
                  {systemQuery.data?.tailscale?.connected ? 'Connected' : 'Required'}
                </span>
              </div>
              <p className="text-xs text-unknown">Required for private HTTPS access from every approved device.</p>
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
                <span className={`px-2.5 py-1 rounded text-xs font-bold ${
                  systemQuery.data?.tailscale?.connected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {systemQuery.data?.tailscale?.connected ? 'Connected' : 'Required'}
                </span>
              </div>

              <p className="text-xs text-unknown">
                The only network door. Tailscale provides trusted HTTPS access to every M2Lab app from any approved tailnet device.
              </p>

              <div className="text-[11px] text-unknown">
                Tailscale must be connected and serving the private HTTPS routes before apps are exposed.
              </div>
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
                Continue to AI Provider Setup
              </button>
              {!foundationReady && (
                <span className="text-xs text-unknown">Complete Authentik & Vaultwarden setup on Step 1 to start downloads.</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: AI Provider Setup */}
      {step === 3 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 className="text-xl font-bold text-white">3. AI Provider Setup</h2>
            <p className="text-sm text-unknown mt-1">
              Add cloud provider access or choose local-only inference. After wiring, M2Lab prepares every selected service one at a time.
              Keys are validated live before they are saved to LiteLLM.
            </p>
            <p className="text-xs text-unknown mt-2">
              Model routing: <code>API Key → FreeLLMAPI → LiteLLM → Open WebUI / SurfSense</code>
            </p>
          </div>

          <div className="space-y-4 bg-surface-2 p-5 border border-border rounded-lg">
            <div>
              <h4 className="text-sm font-bold text-white">1. Enter API Keys — NVIDIA NIM Recommended</h4>
              <p className="text-xs text-unknown">Cloud keys are optional when using local Ollama. NVIDIA NIM offers a generous free tier with fast Llama models.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <KeyInput label="NVIDIA NIM API Key" value={nvidiaKey} placeholder="nvapi-..." prefix="nvapi-"
                  onChange={value => { setNvidiaKey(value); setValidationResults(null) }} />
                <a href="https://build.nvidia.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  Get an NVIDIA NIM key <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div className="space-y-1">
                <KeyInput label="Google Gemini API Key" value={geminiKey} placeholder="AIzaSy..." prefix="AIzaSy"
                  onChange={value => { setGeminiKey(value); setValidationResults(null) }} />
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  Get a Gemini API key in Google AI Studio <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-white cursor-pointer">
              <input type="checkbox" checked={localOnly} onChange={event => {
                setLocalOnly(event.target.checked)
                if (event.target.checked) { setNvidiaKey(''); setGeminiKey(''); setValidationResults(null) }
              }} className="h-4 w-4 rounded accent-accent" />
              <span>Use local Ollama only (no cloud provider key)</span>
            </label>
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

          <div className="flex items-center justify-between pt-4">
            <button className="button-secondary" onClick={() => setStep(2)}>Back</button>
            <button
              className="button-primary flex items-center gap-2"
              onClick={handleWireModels}
              disabled={validationBusy || wiringBusy || Boolean(operationStatus) || !canWireModels}
            >
              {validationBusy || wiringBusy || operationStatus ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {operationStatus || (wiredDone ? 'Re-wire Model Pipeline' : 'Validate & Wire Model Pipeline')}
            </button>
          </div>

          {operationStatus && <p className="text-xs text-accent text-right" role="status" aria-live="polite">{operationStatus}</p>}

          {!canWireModels && (
            <p className="text-xs text-unknown text-right">
              {hasMalformedKey ? 'Correct invalid key formats to continue.' : 'Enter a correctly formatted provider key or choose local Ollama only.'}
            </p>
          )}

          {validationResults && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-live="polite">
              {(['nvidia', 'gemini', 'ollama'] as const).map(provider => {
                const result = validationResults.providers[provider]
                const successful = result.status === 'valid' || result.status === 'available'
                const neutral = result.status === 'not_checked'
                return <div key={provider} className={`p-3 rounded border text-xs ${successful ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : neutral ? 'bg-surface-2 border-border text-unknown' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
                  <strong className="block text-white mb-1">{provider === 'nvidia' ? 'NVIDIA NIM' : provider === 'gemini' ? 'Google Gemini' : 'Local Ollama'}</strong>
                  {result.message}{result.model_count != null ? ` · ${result.model_count} models` : ''}
                </div>
              })}
            </div>
          )}

          {wiredDone && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs text-emerald-400 font-semibold flex items-center justify-between">
              <span>✓ Model pipeline wired successfully!</span>
              {operationStatus ? (
                <span className="text-accent" role="status" aria-live="polite">Preparing selected services…</span>
              ) : (
                <button className="underline" onClick={async () => { if (await launchAll()) setStep(4) }}>Start Safe Setup →</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* STEP 4: Summary & Launch */}
      {step === 4 && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="text-center space-y-2 py-4">
            <span className="text-4xl">🚀</span>
            <h2 className="text-2xl font-bold text-white">4. Safe Setup & Capacity Check</h2>
            <p className="text-sm text-unknown max-w-lg mx-auto">
              M2Lab configures, verifies, and measures one service at a time. Final activation happens sequentially only when the projected idle footprint leaves at least 20% of host RAM available.
            </p>
          </div>

          <BatchProgressPanel batch={activeBatch} apps={apps} />

          {activeBatch && ['paused_memory', 'paused_handoff', 'paused_interrupted', 'failed'].includes(activeBatch.status) && (
            <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div><strong className="text-sm text-amber-300">Setup is paused</strong><p className="text-xs text-unknown">Resolve the reported capacity or configuration issue, then resume. M2Lab will recheck actual state before continuing.</p></div>
              <button className="button-primary flex items-center gap-2 shrink-0" onClick={resumeBatch} disabled={launching}>{launching && <LoaderCircle className="h-4 w-4 animate-spin" />} Recheck & Resume</button>
            </div>
          )}

          {(['AI Infrastructure', 'Applications'] as const).map(group => {
            const items = (activeBatch?.items || []).filter(item => group === 'AI Infrastructure' ? AI_INFRASTRUCTURE_IDS.has(item.service_id) : !AI_INFRASTRUCTURE_IDS.has(item.service_id))
            if (!items.length) return null
            return <section key={group} className="p-5 bg-surface-2 border border-border rounded-lg space-y-4">
              <h4 className="text-sm font-bold text-white border-b border-border pb-2">{group}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {items.map(item => {
                  const app = apps.find(candidate => candidate.service_id === item.service_id)
                  const ready = item.status === 'ready'
                  const url = ready ? canonicalBatchUrl(item.service_id) : null
                  const content = <><span className="flex items-center gap-2"><span>{app?.icon || (group === 'AI Infrastructure' ? '⚙' : '◌')}</span><span className="font-semibold text-white">{app?.name || item.service_id}</span></span><span className={`px-2 py-0.5 rounded font-mono text-[11px] font-bold ${ready ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : item.status === 'failed' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>{ready ? 'Ready' : item.phase.replace(/_/g, ' ')}</span></>
                  return url
                    ? <a key={item.service_id} href={url} target="_blank" rel="noreferrer" className="p-3 bg-bg-base border border-border rounded flex items-center justify-between hover:border-accent/60">{content}</a>
                    : <div key={item.service_id} className="p-3 bg-bg-base border border-border rounded flex items-center justify-between">{content}</div>
                })}
              </div>
            </section>
          })}

          <div className="flex flex-col sm:flex-row justify-center items-center gap-3 pt-4">
            {activeBatch && !['ready', 'cancelled'].includes(activeBatch.status) && <button className="button-secondary" onClick={cancelBatch} disabled={launching}>Cancel Remaining Setup</button>}
            {activeBatch && ['ready', 'cancelled'].includes(activeBatch.status)
              ? <button onClick={onGoWorkspace} className="button-primary px-8 py-3 text-base flex items-center gap-2">Go to M2Lab Workspace <ArrowRight className="h-5 w-5" /></button>
              : <button className="button-primary px-8 py-3 text-base flex items-center gap-2 opacity-50 cursor-not-allowed" disabled>Go to M2Lab Workspace <ArrowRight className="h-5 w-5" /></button>}
          </div>
        </div>
      )}
    </div>
  )
}
