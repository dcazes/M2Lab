import { STATE_COLORS, STATE_LABELS } from '../../lib/types'
import type { ServiceState } from '../../lib/types'

interface StatusDotProps {
  state: ServiceState
  healthy: boolean | null
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_CLASSES = {
  sm: 'h-2 w-2',
  md: 'h-3 w-3',
  lg: 'h-4 w-4',
}

export function StatusDot({ state, healthy, size = 'md' }: StatusDotProps) {
  const color = STATE_COLORS[state]
  const label = STATE_LABELS[state]

  // Override color for degraded based on healthy
  const displayColor = state === 'degraded' && healthy === false ? 'var(--color-warn)' : color

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${SIZE_CLASSES[size]}`}
      title={label}
      role="status"
      aria-label={label}
    >
      <span
        className="rounded-full border-2 border-bg-base shadow-sm transition-colors duration-200"
        style={{ backgroundColor: displayColor, boxShadow: `0 0 0 2px var(--color-bg-base), 0 0 8px ${displayColor}40` }}
      />
      <span className="text-xs font-medium text-unknown hidden sm:inline">{label}</span>
    </span>
  )
}