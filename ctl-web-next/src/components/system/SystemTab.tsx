import { useSystem } from '../../hooks/useSystem'
import { formatBytes, formatPercent, formatUptime, formatLoadAvg } from '../../lib/format'
import { GaugeCard } from './GaugeCard'
import { Sparkline } from './Sparkline'

export function SystemTab() {
  const { data, isLoading, error } = useSystem()

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
          unit="%"
          color="var(--color-accent)"
          format={formatPercent}
        />
        <GaugeCard
          label="Memory"
          value={data.mem.percent}
          max={100}
          unit="%"
          color="var(--color-ok)"
          format={formatPercent}
          detail={`${formatBytes(data.mem.used)} / ${formatBytes(data.mem.total)}`}
        />
        <GaugeCard
          label="Disk"
          value={data.disk.percent}
          max={100}
          unit="%"
          color="var(--color-warn)"
          format={formatPercent}
          detail={`${formatBytes(data.disk.used)} / ${formatBytes(data.disk.total)}`}
        />
        <GaugeCard
          label="Uptime"
          value={data.uptime_seconds}
          max={1}
          unit=""
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
          <Sparkline label="CPU %" color="var(--color-accent)" dataKey="cpu" />
          <Sparkline label="Memory %" color="var(--color-ok)" dataKey="mem" />
          <Sparkline label="Disk %" color="var(--color-warn)" dataKey="disk" />
        </div>
      </section>
    </div>
  )
}