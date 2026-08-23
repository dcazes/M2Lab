interface GaugeCardProps {
  label: string
  value: number
  max?: number
  unit?: string
  color: string
  format: (value: number) => string
  detail?: string
}

export function GaugeCard({ label, value, max, unit, color, format, detail }: GaugeCardProps) {
  const hasBar = max !== undefined && max > 0
  const percentage = hasBar ? Math.min(100, (value / max) * 100) : 0

  return (
    <article className="card p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm text-unknown">{label}</span>
        <span className="font-mono-tabular text-lg font-medium" style={{ color }}>
          {format(value)}{unit && <span className="text-sm font-normal text-unknown ml-1">{unit}</span>}
        </span>
      </div>
      {hasBar && (
        <div className="h-2 bg-surface-2 rounded-full overflow-hidden relative">
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${percentage}%`,
              backgroundColor: color,
            }}
          />
        </div>
      )}
      {detail && (
        <p className="mt-2 text-xs text-unknown font-mono-tabular">{detail}</p>
      )}
    </article>
  )
}