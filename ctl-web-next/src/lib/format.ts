export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`)
  return parts.join(' ')
}

export function formatRelativeTime(date: Date | number): string {
  const then = date instanceof Date ? date.getTime() : date
  const now = Date.now()
  const diff = now - then

  if (diff < 1000) return 'just now'
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

export function formatLoadAvg(load: [number, number, number]): string {
  return load.map((l) => l.toFixed(2)).join(', ')
}

export function parseLogLevel(line: string): 'error' | 'warn' | 'debug' | 'info' {
  const upper = line.toUpperCase()
  if (upper.includes('ERROR') || upper.includes('FATAL') || upper.includes('CRITICAL')) {
    return 'error'
  }
  if (upper.includes('WARN')) {
    return 'warn'
  }
  if (upper.includes('DEBUG') || upper.includes('TRACE')) {
    return 'debug'
  }
  return 'info'
}

export function getLevelColor(level: 'error' | 'warn' | 'debug' | 'info'): string {
  switch (level) {
    case 'error':
      return 'var(--color-err)'
    case 'warn':
      return 'var(--color-warn)'
    case 'debug':
      return 'var(--color-unknown)'
    default:
      return 'var(--color-ok)'
  }
}