import type { LogEvent } from './types'

export interface SSEOptions {
  onMessage: (event: LogEvent) => void
  onError?: (error: Event) => void
  onOpen?: () => void
  retryInterval?: number
  maxRetries?: number
}

export class SSEClient {
  private eventSource: EventSource | null = null
  private url: string
  private options: SSEOptions
  private retryCount = 0
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private isClosed = false

  constructor(url: string, options: SSEOptions) {
    this.url = url
    this.options = {
      retryInterval: 1000,
      maxRetries: 10,
      ...options,
    }
  }

  connect(): void {
    if (this.isClosed) return

    try {
      this.eventSource = new EventSource(this.url)

      this.eventSource.onopen = () => {
        this.retryCount = 0
        this.options.onOpen?.()
      }

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          const logEvent: LogEvent = { event: 'log', data }
          this.options.onMessage(logEvent)
        } catch {
          // Ignore parse errors
        }
      }

      this.eventSource.addEventListener('meta', (event) => {
        try {
          const data = JSON.parse(event.data)
          this.options.onMessage({ event: 'meta', data })
        } catch {
          // Ignore parse errors
        }
      })

      this.eventSource.addEventListener('log', (event) => {
        try {
          const data = JSON.parse(event.data)
          this.options.onMessage({ event: 'log', data })
        } catch {
          // Ignore parse errors
        }
      })

      this.eventSource.onerror = (error) => {
        this.options.onError?.(error)
        this.scheduleReconnect()
      }
    } catch {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.isClosed || this.reconnectTimeout) return

    if (this.retryCount >= (this.options.maxRetries ?? 10)) {
      return
    }

    const delay = Math.min(
      (this.options.retryInterval ?? 1000) * Math.pow(1.5, this.retryCount),
      30000,
    )

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      this.retryCount++
      this.connect()
    }, delay)
  }

  close(): void {
    this.isClosed = true
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }

  get readyState(): number {
    return this.eventSource?.readyState ?? EventSource.CLOSED
  }
}

export function createSSEClient(url: string, options: SSEOptions): SSEClient {
  return new SSEClient(url, options)
}