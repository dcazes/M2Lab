import { useState, useEffect } from 'react'
import { useSystem } from '../../hooks/useSystem'
import { formatBytes, formatPercent, formatUptime, formatLoadAvg } from '../../lib/format'
import { GaugeCard } from './GaugeCard'
import { Sparkline } from './Sparkline'
import { TrustPanel } from './TrustPanel'

const MAX_POINTS = 60

// Module-level ring buffer so the sparkline history survives tab switches
// (component state resets on unmount; this does not).
const historyBuffer: { cpu: number[]; mem: number[]; disk: number[] } = {
  cpu: [],
  mem: [],
  disk: [],
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
