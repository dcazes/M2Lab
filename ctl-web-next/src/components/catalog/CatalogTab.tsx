import { useMemo, useState } from 'react'
import { ArrowRight, Check, Clock3, ExternalLink, Filter, Layers3, Search, ShieldCheck, Sparkles } from 'lucide-react'
import { useCatalog } from '../../hooks/useCatalog'
import { useServices } from '../../hooks/useServices'
import { getServiceIconUrl } from '../../lib/api'
import type { CatalogApp, CatalogProfile, Service } from '../../lib/types'
import type { CapabilityMatch } from '../../lib/types'
import { discoverCapabilities } from '../../lib/api'

interface CatalogTabProps {
  onOpenSettings: (serviceId: string) => void
  onOpenWorkspace: () => void
}

const KIND_LABEL: Record<CatalogApp['kind'], string> = {
  service: 'Self-hosted app',
  companion: 'Local companion',
  infrastructure: 'Infrastructure',
  harness: 'Agent harness',
}

function AppVisual({ app }: { app: CatalogApp }) {
  return (
    <div
      className="catalog-visual"
      style={{ '--app-accent': app.accent } as React.CSSProperties}
      role="img"
      aria-label={`${app.name} visual preview`}
    >
      <div className="catalog-orbit catalog-orbit-one" />
      <div className="catalog-orbit catalog-orbit-two" />
      <div className="catalog-preview-panel">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--app-accent)]" />
          <span className="h-1.5 w-16 rounded-full bg-white/20" />
        </div>
        <div className="grid grid-cols-3 gap-1.5 mt-4">
          <span className="h-9 rounded-md bg-white/7" />
          <span className="h-9 rounded-md bg-white/10" />
          <span className="h-9 rounded-md bg-white/5" />
        </div>
      </div>
      <div className="catalog-app-mark">
        {app.service_id ? (
          <img
            src={getServiceIconUrl(app.service_id)}
            alt=""
            onError={(event) => { event.currentTarget.style.display = 'none' }}
          />
        ) : null}
        <span>{app.icon}</span>
      </div>
    </div>
  )
}

function AppCard({
  app,
  service,
  onConfigure,
  onWorkspace,
}: {
  app: CatalogApp
  service?: Service
  onConfigure: () => void
  onWorkspace: () => void
}) {
  const installed = service && service.state !== 'absent'
  const externalUrl = app.links?.homepage

  return (
    <article className="catalog-card group">
      <AppVisual app={app} />
      <div className="p-5 flex flex-col gap-4 flex-1">
        <div>
          <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-unknown">
            <span>{KIND_LABEL[app.kind]}</span>
            {app.availability === 'evaluation' ? (
              <span className="rounded-full border border-warn/30 bg-warn/10 px-2 py-1 text-warn">Evaluation</span>
            ) : installed ? (
              <span className="flex items-center gap-1 rounded-full border border-ok/25 bg-ok/10 px-2 py-1 text-ok"><Check className="h-3 w-3" /> Installed</span>
            ) : null}
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">{app.name}</h3>
          <p className="mt-1 text-sm font-medium" style={{ color: app.accent }}>{app.tagline}</p>
          <p className="mt-3 text-sm leading-6 text-unknown">{app.description}</p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-unknown">
          <span className="meta-pill"><Clock3 className="h-3.5 w-3.5" /> {app.setup_minutes} min</span>
          <span className="meta-pill"><Layers3 className="h-3.5 w-3.5" /> {app.capabilities.length} capabilities</span>
          {app.ai_optional && <span className="meta-pill">Works without AI</span>}
        </div>

        <div className="mt-auto flex gap-2 pt-1">
          {app.service_id ? (
            <>
              <button onClick={installed ? onWorkspace : onConfigure} className="button-primary flex-1">
                {installed ? 'Open workspace' : 'Set up'} <ArrowRight className="h-4 w-4" />
              </button>
              <button onClick={onConfigure} className="button-icon" aria-label={`Configure ${app.name}`} title="Configure">
                <Filter className="h-4 w-4" />
              </button>
            </>
          ) : externalUrl ? (
            <a className="button-primary flex-1" href={externalUrl} target="_blank" rel="noreferrer">
              Open locally <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <button className="button-secondary flex-1" disabled>Coming soon</button>
          )}
        </div>
      </div>
    </article>
  )
}

function ProfileButton({ profile, selected, onClick }: { profile: CatalogProfile; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`profile-card ${selected ? 'profile-card-selected' : ''}`}>
      <span className="profile-icon">{profile.icon}</span>
      <span>
        <strong>{profile.name}</strong>
        <small>{profile.description}</small>
      </span>
    </button>
  )
}

export function CatalogTab({ onOpenSettings, onOpenWorkspace }: CatalogTabProps) {
  const catalog = useCatalog()
  const services = useServices()
  const [profileId, setProfileId] = useState<string>('all')
  const [capabilityQuery, setCapabilityQuery] = useState('')
  const [capabilityMatches, setCapabilityMatches] = useState<CapabilityMatch[]>([])
  const [discovering, setDiscovering] = useState(false)

  const runDiscovery = async () => {
    if (!capabilityQuery.trim()) return
    setDiscovering(true)
    try {
      const result = await discoverCapabilities(capabilityQuery)
      setCapabilityMatches(result.matches)
    } finally {
      setDiscovering(false)
    }
  }

  const serviceMap = useMemo(() => new Map(services.data?.services.map(service => [service.id, service])), [services.data])
  const apps = useMemo(() => {
    if (!catalog.data) return []
    if (profileId === 'all') return catalog.data.apps.filter(app => app.kind !== 'infrastructure')
    const profile = catalog.data.profiles.find(item => item.id === profileId)
    return profile ? profile.apps.map(id => catalog.data!.apps.find(app => app.id === id)).filter(Boolean) as CatalogApp[] : []
  }, [catalog.data, profileId])

  if (catalog.isLoading || services.isLoading) return <div className="loading-stage"><span /></div>
  if (catalog.error || !catalog.data) return <div className="empty-state">The app catalog could not be loaded.</div>

  return (
    <div className="space-y-10">
      <section className="hero-panel">
        <div className="hero-glow" />
        <div className="relative max-w-3xl">
          <div className="eyebrow"><Sparkles className="h-3.5 w-3.5" /> Your private capability layer</div>
          <h2>Choose what you want help with.<br /><span>OmniLab assembles the workspace.</span></h2>
          <p>Install useful open-source apps, connect AI only when you want it, and expose the smallest safe set of tools to your preferred agent harness.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="button-primary" onClick={() => setProfileId('research')}>Build a research workspace <ArrowRight className="h-4 w-4" /></button>
            <button className="button-secondary" onClick={onOpenWorkspace}>Manage installed apps</button>
          </div>
        </div>
        <div className="hero-proof">
          <div><ShieldCheck /><strong>Approval-gated</strong><span>Writes stay under your control</span></div>
          <div><Layers3 /><strong>Progressive tools</strong><span>Only relevant MCP capabilities</span></div>
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div><span className="eyebrow">Start with an outcome</span><h2>What should your workspace do?</h2></div>
          <p>Select a goal to see a deliberately small, compatible stack.</p>
        </div>
        <div className="profile-grid">
          <ProfileButton profile={{ id: 'all', name: 'Browse everything', description: 'Explore the complete curated catalog.', icon: '⌘', apps: [] }} selected={profileId === 'all'} onClick={() => setProfileId('all')} />
          {catalog.data.profiles.map(profile => <ProfileButton key={profile.id} profile={profile} selected={profile.id === profileId} onClick={() => setProfileId(profile.id)} />)}
        </div>
      </section>

      <section className="capability-lab">
        <div>
          <span className="eyebrow"><Layers3 className="h-3.5 w-3.5" /> Progressive discovery</span>
          <h2>Ask for an outcome, not a tool name.</h2>
          <p>OmniLab returns a compact capability shortlist. Your harness never needs every app schema in its context.</p>
        </div>
        <div>
          <div className="capability-search">
            <Search className="h-4 w-4" />
            <input value={capabilityQuery} onChange={event => setCapabilityQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && runDiscovery()} placeholder="e.g. archive receipt photos and prepare budget entries" />
            <button onClick={runDiscovery} disabled={discovering || !capabilityQuery.trim()}>{discovering ? 'Matching…' : 'Discover'}</button>
          </div>
          {capabilityMatches.length > 0 && (
            <div className="capability-results">
              {capabilityMatches.slice(0, 5).map(match => (
                <div key={`${match.app_id}-${match.id}`}>
                  <span>{match.app_name}</span><strong>{match.title}</strong><small data-risk={match.risk}>{match.risk}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div><span className="eyebrow">Curated catalog</span><h2>{profileId === 'all' ? 'Apps worth owning' : catalog.data.profiles.find(p => p.id === profileId)?.name}</h2></div>
          <p>{apps.length} carefully scoped {apps.length === 1 ? 'app' : 'apps'} · companions open locally</p>
        </div>
        <div className="catalog-grid">
          {apps.map(app => <AppCard key={app.id} app={app} service={app.service_id ? serviceMap.get(app.service_id) : undefined} onConfigure={() => app.service_id && onOpenSettings(app.service_id)} onWorkspace={onOpenWorkspace} />)}
        </div>
      </section>

      <section className="workflow-strip">
        {catalog.data.workflows.slice(0, 3).map((workflow, index) => (
          <div key={workflow.id} title={workflow.description}>
            <span className="workflow-number">{String(index + 1).padStart(2, '0')}</span>
            <strong>{workflow.name}</strong>
            <small>{workflow.apps.map(id => catalog.data!.apps.find(app => app.id === id)?.name).filter(Boolean).join(' → ')}</small>
          </div>
        ))}
      </section>
    </div>
  )
}
