import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, CircleGauge, Clock3, ExternalLink, FileText, HardDrive, MemoryStick, Play, RefreshCcw, RotateCcw, Search, Settings, Square, TerminalSquare } from 'lucide-react'
import { toast } from 'sonner'
import { useServices } from '../../hooks/useServices'
import { useSystem } from '../../hooks/useSystem'
import { useAudit } from '../../hooks/useAudit'
import { createApproval, fetchServiceLogs, getServiceIconUrl, getServiceUrl, serviceAction } from '../../lib/api'
import { formatBytes, formatUptime } from '../../lib/format'
import type { AuditEvent, Service, ServiceAction } from '../../lib/types'

const CORE_IDS = ['vaultwarden', 'litellm', 'firecrawl']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ACTION_COPY: Record<ServiceAction, { label: string; detail: string }> = {
  up: { label: 'Start', detail: 'Start this Compose stack and its dependencies.' },
  stop: { label: 'Stop', detail: 'Stop its containers without deleting data.' },
  restart: { label: 'Restart', detail: 'Restart the current containers.' },
  pull: { label: 'Pull', detail: 'Fetch current container images.' },
  update: { label: 'Update', detail: 'Pull images and recreate the stack.' },
}

function AppMark({ service, large = false }: { service: Service; large?: boolean }) {
  return <span className={`workspace-app-mark ${large ? 'workspace-app-mark-large' : ''}`}><img src={getServiceIconUrl(service.id)} alt="" onError={event => { event.currentTarget.style.display = 'none' }} /><span>{service.icon}</span></span>
}

function stateLabel(service: Service) {
  if (service.state === 'running' && service.healthy === false) return 'Unhealthy'
  return service.state === 'running' ? 'Online' : service.state.charAt(0).toUpperCase() + service.state.slice(1)
}

function Metric({ icon: Icon, label, value, bar }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; bar?: number }) {
  return <div className="workspace-metric"><Icon className="h-4 w-4" /><span><small>{label}</small><strong>{value}</strong></span>{bar !== undefined && <i><b style={{ width: `${Math.min(bar, 100)}%` }} /></i>}</div>
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function CalendarPanel({ events, nextcloud }: { events: AuditEvent[]; nextcloud?: Service }) {
  const now = new Date()
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
  const [selectedKey, setSelectedKey] = useState(toDateKey(now))
  const byDate = useMemo(() => {
    const grouped = new Map<string, AuditEvent[]>()
    for (const event of events) {
      const key = toDateKey(new Date(event.timestamp))
      grouped.set(key, [...(grouped.get(key) || []), event])
    }
    return grouped
  }, [events])
  const gridStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay())
  const days = Array.from({ length: 42 }, (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index))
  const selectedEvents = byDate.get(selectedKey) || []

  return <section className="workspace-panel workspace-calendar">
    <header className="workspace-panel-header"><div><CalendarDays className="h-4 w-4" /><span><strong>Calendar</strong><small>Operations and personal agenda</small></span></div><div className="workspace-calendar-controls"><button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft /></button><button onClick={() => { setCursor(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedKey(toDateKey(now)) }}>Today</button><button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight /></button></div></header>
    <div className="workspace-calendar-title">{cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
    <div className="workspace-calendar-grid workspace-calendar-weekdays">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
    <div className="workspace-calendar-grid">{days.map(date => {
      const key = toDateKey(date); const count = byDate.get(key)?.length || 0
      return <button key={key} className={`${date.getMonth() !== cursor.getMonth() ? 'outside' : ''} ${key === toDateKey(now) ? 'today' : ''} ${selectedKey === key ? 'selected' : ''}`} onClick={() => setSelectedKey(key)}><span>{date.getDate()}</span>{count > 0 && <i>{count > 3 ? '3+' : count}</i>}</button>
    })}</div>
    <div className="workspace-agenda"><div className="workspace-agenda-heading"><strong>{selectedKey === toDateKey(now) ? 'Today' : new Date(`${selectedKey}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</strong><small>{selectedEvents.length} recorded operation{selectedEvents.length === 1 ? '' : 's'}</small></div><div className="workspace-agenda-list">{selectedEvents.length ? selectedEvents.slice(0, 4).map((event, index) => <div key={`${event.timestamp}-${index}`}><time>{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><i /><span><strong>{event.service_id || 'OmniLab'}</strong><small>{event.event.split('.').join(' ')}</small></span></div>) : <p>No OmniLab operations recorded for this date.</p>}</div>{nextcloud?.state === 'running' ? <a href={getServiceUrl(nextcloud)} target="_blank" rel="noreferrer">Open Nextcloud Calendar <ExternalLink className="h-3.5 w-3.5" /></a> : <span className="workspace-calendar-source">Start Nextcloud to add your personal calendar source.</span>}</div>
  </section>
}

function ServiceInspector({ service, onOpenSettings }: { service: Service; onOpenSettings: (serviceId: string) => void }) {
  const queryClient = useQueryClient()
  const [confirmAction, setConfirmAction] = useState<ServiceAction | null>(null)
  const [pending, setPending] = useState<ServiceAction | null>(null)
  const [logs, setLogs] = useState<string[] | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const runAction = async () => {
    if (!confirmAction) return
    const action = confirmAction; setConfirmAction(null); setPending(action)
    try {
      const approval = await createApproval(service.id, action)
      const result = await serviceAction(service.id, action, approval)
      if (!result.ok) throw new Error(result.output)
      toast.success(`${service.display_name}: ${ACTION_COPY[action].label.toLowerCase()} completed`)
      await queryClient.invalidateQueries({ queryKey: ['services'] })
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) } finally { setPending(null) }
  }
  const loadLogs = async () => {
    setLogsLoading(true)
    try { setLogs((await fetchServiceLogs(service.id)).lines) } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) } finally { setLogsLoading(false) }
  }
  const actions: { action: ServiceAction; icon: React.ComponentType<{ className?: string }> }[] = service.state === 'running' ? [{ action: 'stop', icon: Square }, { action: 'restart', icon: RotateCcw }, { action: 'update', icon: ArrowUpRight }] : [{ action: 'up', icon: Play }, { action: 'update', icon: ArrowUpRight }]
  return <section className="workspace-panel workspace-inspector">
    <header><AppMark service={service} large /><div><span className={`workspace-state workspace-state-${service.state}`}><i />{stateLabel(service)}</span><h2>{service.display_name}</h2><p>{service.description}</p></div></header>
    <div className="workspace-inspector-facts"><div><small>Containers</small><strong>{service.containers.length}</strong></div><div><small>HTTP</small><strong>{service.healthy === null ? 'N/A' : service.healthy ? 'Ready' : 'Down'}</strong></div><div><small>Port</small><strong>{service.port}</strong></div></div>
    <div className="workspace-primary-actions"><a href={getServiceUrl(service)} target="_blank" rel="noreferrer"><ExternalLink />Open app</a><button onClick={() => onOpenSettings(service.id)}><Settings />Configure</button></div>
    <div className="workspace-command-grid">{actions.map(({ action, icon: Icon }) => <button key={action} onClick={() => setConfirmAction(action)} disabled={pending !== null}><Icon />{pending === action ? 'Working…' : ACTION_COPY[action].label}</button>)}<button onClick={loadLogs} disabled={logsLoading}><TerminalSquare />{logsLoading ? 'Loading…' : 'Logs'}</button></div>
    {confirmAction && <div className="workspace-confirm"><strong>{ACTION_COPY[confirmAction].label} {service.display_name}?</strong><p>{ACTION_COPY[confirmAction].detail}</p><div><button onClick={() => setConfirmAction(null)}>Cancel</button><button onClick={runAction}>Confirm</button></div></div>}
    {logs && <div className="workspace-logs"><header><span>Recent logs</span><button onClick={() => setLogs(null)}>Close</button></header><pre>{logs.length ? logs.join('\n') : 'No recent log lines.'}</pre></div>}
    <div className="workspace-containers"><strong>Containers</strong>{service.containers.length ? service.containers.map(container => <div key={container.container}><i className={container.state === 'running' ? 'running' : ''} /><span>{container.service || container.container}</span><small>{container.health || container.state}</small></div>) : <p>No containers created yet.</p>}</div>
  </section>
}

export function ServicesTab({ onOpenSettings }: { onOpenSettings: (serviceId: string) => void }) {
  const servicesQuery = useServices(); const systemQuery = useSystem(); const auditQuery = useAudit()
  const [query, setQuery] = useState(''); const [selectedId, setSelectedId] = useState<string | null>(null)
  if (servicesQuery.isLoading) return <div className="loading-stage"><span /></div>
  if (servicesQuery.error || !servicesQuery.data) return <div className="empty-state">Workspace status is unavailable. {servicesQuery.error?.message}</div>
  const services = servicesQuery.data.services
  const selected = services.find(service => service.id === selectedId) || services.find(service => service.state === 'running' && !CORE_IDS.includes(service.id)) || services[0]
  const filtered = services.filter(service => `${service.display_name} ${service.description} ${service.category}`.toLowerCase().includes(query.toLowerCase()))
  const core = CORE_IDS.map(id => services.find(service => service.id === id)).filter(Boolean) as Service[]
  const online = services.filter(service => service.state === 'running').length
  const attention = services.filter(service => service.state === 'degraded' || (service.state === 'running' && service.healthy === false))
  const system = systemQuery.data
  return <div className="workspace-dashboard">
    <section className="workspace-status-strip"><Metric icon={CircleGauge} label="CPU" value={system ? `${Math.round(system.cpu_percent)}%` : '—'} bar={system?.cpu_percent} /><Metric icon={MemoryStick} label="Memory" value={system ? `${Math.round(system.mem.percent)}%` : '—'} bar={system?.mem.percent} /><Metric icon={HardDrive} label="Disk free" value={system ? formatBytes(system.disk.total - system.disk.used, 0) : '—'} bar={system?.disk.percent} /><Metric icon={Clock3} label="Uptime" value={system ? formatUptime(system.uptime_seconds).split(' ').slice(0, 2).join(' ') : '—'} /><Metric icon={Activity} label="Services" value={`${online}/${services.length} online`} bar={(online / services.length) * 100} /></section>
    <section className="workspace-app-dock"><div className="workspace-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter apps…" /><span>{filtered.length}</span></div><div className="workspace-dock-icons">{filtered.map(service => <button key={service.id} className={selected.id === service.id ? 'selected' : ''} onClick={() => setSelectedId(service.id)} title={`${service.display_name} · ${stateLabel(service)}`}><AppMark service={service} /><i className={`workspace-dot workspace-dot-${service.state}`} /><small>{service.display_name}</small></button>)}</div></section>
    <div className="workspace-main-grid"><div className="workspace-left-column">
      <section className="workspace-panel workspace-core-panel"><div className="workspace-panel-header"><div><RefreshCcw className="h-4 w-4" /><span><strong>Core</strong><small>Credential, model, and web services</small></span></div><span>{core.filter(service => service.state === 'running').length}/{core.length}</span></div><div>{core.map(service => <button key={service.id} onClick={() => setSelectedId(service.id)}><AppMark service={service} /><span><strong>{service.display_name}</strong><small>{stateLabel(service)}</small></span><i className={`workspace-dot workspace-dot-${service.state}`} /></button>)}</div></section>
      <section className="workspace-panel workspace-attention-panel"><div className="workspace-panel-header"><div><Activity className="h-4 w-4" /><span><strong>Attention</strong><small>Health signals worth checking</small></span></div><span>{attention.length}</span></div>{attention.length ? attention.map(service => <button key={service.id} onClick={() => setSelectedId(service.id)}><span>{service.display_name}</span><small>{stateLabel(service)}</small></button>) : <div className="workspace-all-clear"><span>✓</span><p><strong>All clear</strong><small>No degraded running services.</small></p></div>}</section>
      <section className="workspace-panel workspace-recent-panel"><div className="workspace-panel-header"><div><FileText className="h-4 w-4" /><span><strong>Recent operations</strong><small>Approval and lifecycle trail</small></span></div></div>{(auditQuery.data?.events || []).slice(0, 5).map((event, index) => <div key={`${event.timestamp}-${index}`}><i /><span><strong>{event.service_id || 'OmniLab'}</strong><small>{event.event.split('.').join(' ')}</small></span><time>{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}</section>
    </div><CalendarPanel events={auditQuery.data?.events || []} nextcloud={services.find(service => service.id === 'nextcloud')} /><ServiceInspector key={selected.id} service={selected} onOpenSettings={onOpenSettings} /></div>
  </div>
}
