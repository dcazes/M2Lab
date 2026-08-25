import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Network,
  RefreshCcw,
  Rocket,
  ServerCog,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { useServices } from '../../hooks/useServices'
import { createApproval, getServiceIconUrl, getServiceUrl, prepareInitiateService, serviceAction } from '../../lib/api'
import type { Service } from '../../lib/types'

const STORAGE_KEY = 'omnilab.initiate.v1'

interface InitiateProgress {
  vaultAccountReady: boolean
  modelPath: 'later' | 'provider' | 'local'
  foundationDone: boolean
  nextcloudSelected: boolean
  surfsenseSelected: boolean
  finished: boolean
}

const DEFAULT_PROGRESS: InitiateProgress = {
  vaultAccountReady: false,
  modelPath: 'later',
  foundationDone: false,
  nextcloudSelected: true,
  surfsenseSelected: true,
  finished: false,
}

function loadProgress(): InitiateProgress {
  try {
    return { ...DEFAULT_PROGRESS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
  } catch {
    return DEFAULT_PROGRESS
  }
}

function ServiceMark({ service, fallback }: { service?: Service; fallback: string }) {
  return (
    <span className="initiate-service-mark">
      {service ? <img src={getServiceIconUrl(service.id)} alt="" onError={event => { event.currentTarget.style.display = 'none' }} /> : null}
      <span>{service?.icon || fallback}</span>
    </span>
  )
}

function StatusLabel({ service }: { service?: Service }) {
  const state = service?.state || 'absent'
  return (
    <span className={`initiate-status initiate-status-${state}`}>
      <span /> {state === 'absent' ? 'Not installed' : state === 'running' ? 'Online' : state}
    </span>
  )
}

function PathChoice({ selected, title, detail, onClick }: { selected: boolean; title: string; detail: string; onClick: () => void }) {
  return (
    <button className={`initiate-choice ${selected ? 'initiate-choice-selected' : ''}`} aria-pressed={selected} onClick={onClick}>
      <span className="initiate-choice-check">{selected && <Check className="h-3.5 w-3.5" />}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
    </button>
  )
}

export function InitiateTab({ onFinish, onOpenSettings }: { onFinish: () => void; onOpenSettings: (serviceId: string) => void }) {
  const { data, isLoading, error, refetch } = useServices()
  const [progress, setProgress] = useState<InitiateProgress>(loadProgress)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const services = useMemo(() => new Map(data?.services.map(service => [service.id, service])), [data])
  const vaultwarden = services.get('vaultwarden')
  const litellm = services.get('litellm')
  const firecrawl = services.get('firecrawl')
  const nextcloud = services.get('nextcloud')
  const surfsense = services.get('surfsense')

  const saveProgress = (patch: Partial<InitiateProgress>) => {
    setProgress(previous => {
      const next = { ...previous, ...patch }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const bringOnline = async (service: Service | undefined) => {
    if (!service || busy[service.id]) return false
    setBusy(previous => ({ ...previous, [service.id]: true }))
    setErrors(previous => ({ ...previous, [service.id]: '' }))
    try {
      await prepareInitiateService(service.id)
      const approval = await createApproval(service.id, 'up')
      const result = await serviceAction(service.id, 'up', approval)
      if (!result.ok) throw new Error(result.output || 'The service did not start')
      toast.success(`${service.display_name} is coming online`)
      await refetch()
      return true
    } catch (installError) {
      const message = installError instanceof Error ? installError.message : String(installError)
      setErrors(previous => ({ ...previous, [service.id]: message }))
      return false
    } finally {
      setBusy(previous => ({ ...previous, [service.id]: false }))
    }
  }

  const installFoundations = async () => {
    const selected = [progress.nextcloudSelected ? nextcloud : undefined, progress.surfsenseSelected ? surfsense : undefined].filter(Boolean) as Service[]
    for (const service of selected) {
      if (service.state !== 'running' && !(await bringOnline(service))) return
    }
    saveProgress({ foundationDone: true })
    goTo('initiate-review')
  }

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY)
    setProgress(DEFAULT_PROGRESS)
    goTo('initiate-welcome')
  }

  const coreOnline = [vaultwarden, litellm, firecrawl].filter(service => service?.state === 'running').length

  if (isLoading) return <div className="loading-stage"><span /></div>
  if (error || !data) return <div className="empty-state">Initiation could not load service status. {error?.message}</div>

  return (
    <div className="initiate-shell">
      <aside className="initiate-rail">
        <div>
          <span className="eyebrow"><Sparkles className="h-3.5 w-3.5" /> Repeatable setup</span>
          <h2>Initiate</h2>
          <p>Bring the private core online, then add the useful parts.</p>
        </div>
        <nav aria-label="Initiation progress">
          {[
            ['initiate-welcome', '01', 'Overview', true],
            ['initiate-vault', '02', 'Credentials', vaultwarden?.state === 'running' && progress.vaultAccountReady],
            ['initiate-models', '03', 'Model routing', litellm?.state === 'running'],
            ['initiate-web', '04', 'Web acquisition', firecrawl?.state === 'running'],
            ['initiate-foundations', '05', 'Foundations', progress.foundationDone],
            ['initiate-review', '06', 'Review', progress.finished],
          ].map(([id, number, label, complete]) => (
            <button key={String(id)} onClick={() => goTo(String(id))}>
              <span className={complete ? 'complete' : ''}>{complete ? <Check className="h-3.5 w-3.5" /> : number}</span>
              <strong>{label}</strong>
            </button>
          ))}
        </nav>
        <div className="initiate-core-meter"><span style={{ width: `${(coreOnline / 3) * 100}%` }} /><small>{coreOnline}/3 core services online</small></div>
        <button className="initiate-reset" onClick={reset}><RefreshCcw className="h-3.5 w-3.5" /> Run again</button>
      </aside>

      <main className="initiate-stream">
        <section id="initiate-welcome" className="initiate-step initiate-step-intro">
          <div className="initiate-step-number">01</div>
          <div className="initiate-copy">
            <span className="eyebrow">Core bootstrap</span>
            <h1>A useful baseline, without the setup archaeology.</h1>
            <p>OmniLab prepares local configuration, generates service-only secrets, asks for approval, and starts each Compose stack. Existing credentials are preserved.</p>
            <div className="initiate-principles">
              <div><ServerCog /><strong>Self-hosted</strong><small>Services run on this machine.</small></div>
              <div><KeyRound /><strong>Write-only secrets</strong><small>Generated values never return to the browser.</small></div>
              <div><ShieldCheck /><strong>Explicit installs</strong><small>Every stack starts after your click.</small></div>
            </div>
            <button className="button-primary" onClick={() => goTo('initiate-vault')}>Begin with credentials <ArrowDown className="h-4 w-4" /></button>
          </div>
        </section>

        <section id="initiate-vault" className="initiate-step">
          <div className="initiate-step-number">02</div>
          <div className="initiate-copy">
            <span className="eyebrow"><LockKeyhole className="h-3.5 w-3.5" /> Credentials</span>
            <h2>One safe home for human credentials.</h2>
            <p>Vaultwarden reduces password sprawl across the apps you install. OmniLab can deploy it, but your master password is created directly inside your vault and is never visible here.</p>
            <div className="initiate-service-row">
              <ServiceMark service={vaultwarden} fallback="▣" />
              <div><strong>Vaultwarden</strong><small>Password manager · core</small></div>
              <StatusLabel service={vaultwarden} />
            </div>
            {errors.vaultwarden && <p className="initiate-error">{errors.vaultwarden}</p>}
            <div className="initiate-actions">
              {vaultwarden?.state !== 'running' ? (
                <button className="button-primary" onClick={() => bringOnline(vaultwarden)} disabled={busy.vaultwarden}>
                  {busy.vaultwarden ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Prepare & install
                </button>
              ) : (
                <a className="button-primary" href={getServiceUrl(vaultwarden)} target="_blank" rel="noreferrer">Open Vaultwarden <ExternalLink className="h-4 w-4" /></a>
              )}
            </div>
            <label className={`initiate-confirm ${vaultwarden?.state !== 'running' ? 'disabled' : ''}`}>
              <input type="checkbox" checked={progress.vaultAccountReady} disabled={vaultwarden?.state !== 'running'} onChange={event => saveProgress({ vaultAccountReady: event.target.checked })} />
              <span><strong>I created my vault account</strong><small>I stored the recovery information somewhere I control.</small></span>
            </label>
            <button className="button-secondary" disabled={!progress.vaultAccountReady} onClick={() => goTo('initiate-models')}>Continue <ArrowRight className="h-4 w-4" /></button>
          </div>
        </section>

        <section id="initiate-models" className="initiate-step">
          <div className="initiate-step-number">03</div>
          <div className="initiate-copy">
            <span className="eyebrow"><BrainCircuit className="h-3.5 w-3.5" /> Model routing</span>
            <h2>One endpoint for whichever models you choose.</h2>
            <p>LiteLLM gives apps a stable local gateway. FreeLLMAPI is intentionally left out of initiation; it can be added later from the catalog.</p>
            <div className="initiate-service-row">
              <ServiceMark service={litellm} fallback="⌁" />
              <div><strong>LiteLLM</strong><small>Model gateway · core</small></div>
              <StatusLabel service={litellm} />
            </div>
            <div className="initiate-choice-grid">
              <PathChoice selected={progress.modelPath === 'later'} title="Route later" detail="Install the gateway now; add credentials when useful." onClick={() => saveProgress({ modelPath: 'later' })} />
              <PathChoice selected={progress.modelPath === 'provider'} title="Provider key" detail="Connect NVIDIA, Google, Mistral, or another provider." onClick={() => saveProgress({ modelPath: 'provider' })} />
              <PathChoice selected={progress.modelPath === 'local'} title="Local models" detail="Use Ollama as a private inference path." onClick={() => saveProgress({ modelPath: 'local' })} />
            </div>
            {errors.litellm && <p className="initiate-error">{errors.litellm}</p>}
            <div className="initiate-actions">
              {litellm?.state !== 'running' ? <button className="button-primary" onClick={() => bringOnline(litellm)} disabled={busy.litellm}>{busy.litellm ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Prepare & install</button> : <button className="button-secondary" onClick={() => onOpenSettings('litellm')}>Configure providers</button>}
              <button className="button-secondary" disabled={litellm?.state !== 'running'} onClick={() => goTo('initiate-web')}>Continue <ArrowRight className="h-4 w-4" /></button>
            </div>
          </div>
        </section>

        <section id="initiate-web" className="initiate-step">
          <div className="initiate-step-number">04</div>
          <div className="initiate-copy">
            <span className="eyebrow"><Network className="h-3.5 w-3.5" /> Web acquisition</span>
            <h2>Search and scrape from your own machine.</h2>
            <p>Firecrawl runs here as a complete self-hosted stack. OmniLab generates its API and database secrets and starts the API, browser worker, queue, cache, and database together.</p>
            <div className="initiate-service-row">
              <ServiceMark service={firecrawl} fallback="🔥" />
              <div><strong>Firecrawl</strong><small>Selected-source web acquisition · core</small></div>
              <StatusLabel service={firecrawl} />
            </div>
            <div className="initiate-note"><ShieldCheck className="h-4 w-4" /><span>Use it for public or authorized sources. Site permissions and rate limits still apply.</span></div>
            {errors.firecrawl && <p className="initiate-error">{errors.firecrawl}</p>}
            <div className="initiate-actions">
              {firecrawl?.state !== 'running' ? <button className="button-primary" onClick={() => bringOnline(firecrawl)} disabled={busy.firecrawl}>{busy.firecrawl ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Prepare & install</button> : <span className="initiate-ready"><CheckCircle2 className="h-4 w-4" /> Local API ready</span>}
              <button className="button-secondary" disabled={firecrawl?.state !== 'running'} onClick={() => goTo('initiate-foundations')}>Continue <ArrowRight className="h-4 w-4" /></button>
            </div>
          </div>
        </section>

        <section id="initiate-foundations" className="initiate-step">
          <div className="initiate-step-number">05</div>
          <div className="initiate-copy">
            <span className="eyebrow">Recommended foundations</span>
            <h2>Add the parts that make the workspace personal.</h2>
            <p>These are valuable defaults, not platform requirements. Nextcloud becomes the calendar and files source; SurfSense becomes the research workspace.</p>
            <div className="initiate-foundation-grid">
              {[
                { service: nextcloud, id: 'nextcloud', selected: progress.nextcloudSelected, set: (selected: boolean) => saveProgress({ nextcloudSelected: selected }), detail: 'Calendar, files, and future CalDAV agenda.' },
                { service: surfsense, id: 'surfsense', selected: progress.surfsenseSelected, set: (selected: boolean) => saveProgress({ surfsenseSelected: selected }), detail: 'Private research and cited retrieval.' },
              ].map(item => (
                <label key={item.id} className={`initiate-foundation ${item.selected ? 'selected' : ''}`}>
                  <input type="checkbox" checked={item.selected} onChange={event => item.set(event.target.checked)} />
                  <ServiceMark service={item.service} fallback="•" />
                  <span><strong>{item.service?.display_name}</strong><small>{item.detail}</small></span>
                  <StatusLabel service={item.service} />
                </label>
              ))}
            </div>
            {(errors.nextcloud || errors.surfsense) && <p className="initiate-error">{errors.nextcloud || errors.surfsense}</p>}
            <div className="initiate-actions">
              <button className="button-primary" onClick={installFoundations} disabled={busy.nextcloud || busy.surfsense}>{busy.nextcloud || busy.surfsense ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Install selected</button>
              <button className="button-secondary" onClick={() => { saveProgress({ foundationDone: true }); goTo('initiate-review') }}>Skip for now</button>
            </div>
          </div>
        </section>

        <section id="initiate-review" className="initiate-step initiate-step-review">
          <div className="initiate-step-number">06</div>
          <div className="initiate-copy">
            <span className="eyebrow"><CheckCircle2 className="h-3.5 w-3.5" /> Review</span>
            <h2>{coreOnline === 3 ? 'The core is online.' : `${coreOnline} of 3 core services are online.`}</h2>
            <p>Your progress is saved on this dashboard. You can return to Initiate at any time without overwriting configured credentials.</p>
            <div className="initiate-review-grid">
              {[vaultwarden, litellm, firecrawl, nextcloud, surfsense].map(service => service && (
                <div key={service.id}><ServiceMark service={service} fallback="•" /><span><strong>{service.display_name}</strong><small>{service.state}</small></span>{service.state === 'running' && <Check className="h-4 w-4" />}</div>
              ))}
            </div>
            <button className="button-primary" onClick={() => { saveProgress({ finished: true }); onFinish() }} disabled={coreOnline < 3}>Enter workspace <ArrowRight className="h-4 w-4" /></button>
            {coreOnline < 3 && <small className="initiate-finish-note">Bring all three core services online to finish. You can still leave this tab at any time.</small>}
          </div>
        </section>
      </main>
    </div>
  )
}
