import { useState, useEffect } from 'react'
import { useSystem } from '../../hooks/useSystem'
import { formatBytes, formatPercent, formatUptime, formatLoadAvg } from '../../lib/format'
import { GaugeCard } from './GaugeCard'
import { Sparkline } from './Sparkline'
import { TrustPanel } from './TrustPanel'
import { Activity, ExternalLink, FileText, Network, ServerCog } from 'lucide-react'
import { useServices } from '../../hooks/useServices'
import { useAudit } from '../../hooks/useAudit'
import { getServiceIconUrl } from '../../lib/api'
import { FoundationSetupCard } from './FoundationSetupCard'

const MAX_POINTS = 60

// Module-level ring buffer so the sparkline history survives tab switches
// (component state resets on unmount; this does not).
const historyBuffer: { cpu: number[]; mem: number[]; disk: number[] } = {
  cpu: [],
  mem: [],
  disk: [],
}

function OperationsOverview() {
  const servicesQuery = useServices(); const auditQuery = useAudit(); const systemQuery = useSystem()
  const services = servicesQuery.data?.services || []
  const infrastructure = services.filter(service => service.visibility === 'system')
  const attention = services.filter(service => service.state === 'degraded' || (service.state === 'running' && service.healthy === false))
  return <section className="system-operations-grid">
    <div className="workspace-panel workspace-core-panel system-infrastructure-panel"><div className="workspace-panel-header"><div><ServerCog className="h-4 w-4" /><span><strong>Infrastructure</strong><small>Private access and identity</small></span></div><span>{infrastructure.filter(service => service.state === 'running').length + Number(Boolean(systemQuery.data?.docker_ok)) + Number(Boolean(systemQuery.data?.tailscale.connected))}/{infrastructure.length + 2}</span></div><div>
      <div className="system-infrastructure-row"><span className="system-infrastructure-icon"><ServerCog /></span><span><strong>Docker</strong><small>{systemQuery.data?.docker_ok ? 'Running' : 'Unavailable'}</small></span><i className={`workspace-dot workspace-dot-${systemQuery.data?.docker_ok ? 'running' : 'degraded'}`} /></div>
      <div className="system-infrastructure-row"><span className="system-infrastructure-icon"><Network /></span><span><strong>Tailscale</strong><small>{systemQuery.data?.tailscale.connected ? `${systemQuery.data.tailscale.serve_ports.length} private routes` : 'Sign-in required'}</small></span><i className={`workspace-dot workspace-dot-${systemQuery.data?.tailscale.connected ? 'running' : 'degraded'}`} /></div>
      {infrastructure.map(service => <div className="system-infrastructure-row" key={service.id}><span className="workspace-app-mark"><img src={getServiceIconUrl(service.id)} alt="" onError={event => { event.currentTarget.style.display = 'none' }} /><span>{service.icon}</span></span><span><strong>{service.display_name}</strong><small>{service.state === 'running' ? `${service.containers.length} components ready` : service.state}</small></span>{service.tailnet_url && service.external_ready && <a href={service.tailnet_url} target="_blank" rel="noreferrer" aria-label={`Open ${service.display_name}`}><ExternalLink /></a>}<i className={`workspace-dot workspace-dot-${service.state}`} /></div>)}
    </div></div>
    <div className="workspace-panel workspace-attention-panel"><div className="workspace-panel-header"><div><Activity className="h-4 w-4" /><span><strong>Attention</strong><small>Health signals worth checking</small></span></div><span>{attention.length}</span></div>{attention.length ? attention.map(service => <button key={service.id}><span>{service.display_name}</span><small>{service.healthy === false ? 'Health check failed' : service.state}</small></button>) : <div className="workspace-all-clear"><span>✓</span><p><strong>All clear</strong><small>No degraded running services.</small></p></div>}</div>
    <div className="workspace-panel workspace-recent-panel"><div className="workspace-panel-header"><div><FileText className="h-4 w-4" /><span><strong>Recent operations</strong><small>Approval and lifecycle trail</small></span></div></div>{(auditQuery.data?.events || []).slice(0, 6).map((event, index) => <div key={`${event.timestamp}-${index}`}><i /><span><strong>{event.service_id || 'OmniLab'}</strong><small>{event.event.split('.').join(' ')}</small></span><time>{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div>
  </section>
}

export function SystemTab() {
  const { data, isLoading, error } = useSystem()
  const [history, setHistory] = useState<{ cpu: number[]; mem: number[]; disk: number[] }>(historyBuffer)

  useEffect(() => {
    if (!data) return
    historyBuffer.cpu = [...historyBuffer.cpu, data.cpu_percent].slice(-MAX_POINTS)
    historyBuffer.mem = [...historyBuffer.mem, data.mem.percent].slice(-MAX_POINTS)
    historyBuffer.disk = [...historyBuffer.disk, data.disk.percent].slice(-MAX_POINTS)
    setHistory({ cpu: historyBuffer.cpu, mem: historyBuffer.mem, disk: historyBuffer.disk })
  }, [data])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-6 text-center text-err">
        <p>Failed to load system stats</p>
        <p className="text-sm text-unknown mt-2">{error.message}</p>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GaugeCard
          label="CPU"
          value={data.cpu_percent}
          max={100}
          color="var(--color-accent)"
          format={formatPercent}
        />
        <GaugeCard
          label="Memory"
          value={data.mem.percent}
          max={100}
          color="var(--color-ok)"
          format={formatPercent}
          detail={`${formatBytes(data.mem.used)} / ${formatBytes(data.mem.total)}`}
        />
        <GaugeCard
          label="Disk"
          value={data.disk.percent}
          max={100}
          color="var(--color-warn)"
          format={formatPercent}
          detail={`${formatBytes(data.disk.used)} / ${formatBytes(data.disk.total)}`}
        />
        <GaugeCard
          label="Uptime"
          value={data.uptime_seconds}
          color="var(--color-unknown)"
          format={formatUptime}
        />
      </section>

      <FoundationSetupCard />

      <OperationsOverview />

      <section className="card p-4">
        <h3 className="font-medium mb-4">System Details</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-unknown">Load Average</p>
            <p className="font-mono-tabular font-medium">{formatLoadAvg(data.load_avg)}</p>
          </div>
          <div>
            <p className="text-unknown">Memory Available</p>
            <p className="font-mono-tabular font-medium">{formatBytes(data.mem.available)}</p>
          </div>
          <div>
            <p className="text-unknown">Memory Free</p>
            <p className="font-mono-tabular font-medium">{formatBytes(data.mem.free)}</p>
          </div>
          <div>
            <p className="text-unknown">Docker</p>
            <p className={`font-medium ${data.docker_ok ? 'text-ok' : 'text-err'}`}>
              {data.docker_ok ? 'Running' : 'Unavailable'}
            </p>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <h3 className="font-medium mb-4">Resource History (5 min)</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Sparkline label="CPU %" color="var(--color-accent)" data={history.cpu} />
          <Sparkline label="Memory %" color="var(--color-ok)" data={history.mem} />
          <Sparkline label="Disk %" color="var(--color-warn)" data={history.disk} />
        </div>
      </section>

      <TrustPanel />
    </div>
  )
}
