import { useState, useEffect, useCallback, useRef } from 'react'
import { createSSEClient } from '../lib/sse'
import type { LogEvent } from '../lib/types'

export interface LogEntry {
  id: number
  container: string
  line: string
  timestamp: Date
  level: 'error' | 'warn' | 'debug' | 'info'
}

export function useServiceLogs(serviceId: string, enabled: boolean) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logIdRef = useRef(0)
  const clientRef = useRef<ReturnType<typeof createSSEClient> | null>(null)
  const containerOrderRef = useRef<string[]>([])

  const clearLogs = useCallback(() => {
    setLogs([])
    logIdRef.current = 0
    containerOrderRef.current = []
  }, [])

  const pause = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.close()
      clientRef.current = null
      setIsConnected(false)
    }
  }, [])

  const resume = useCallback(() => {
    if (!enabled) return
    connect()
  }, [enabled])

  const connect = useCallback(() => {
    if (clientRef.current || !enabled) return

    const url = `/api/services/${serviceId}/logs?tail=200&follow=true`
    const client = createSSEClient(url, {
      onOpen: () => {
        setIsConnected(true)
        setError(null)
      },
      onError: () => {
        setIsConnected(false)
        setError('Connection lost. Reconnecting...')
      },
      onMessage: (event: LogEvent) => {
        if (event.event === 'meta') {
          if (!containerOrderRef.current.includes(event.data.container)) {
            containerOrderRef.current.push(event.data.container)
          }
        } else if (event.event === 'log') {
          const { c: container, line } = event.data
          const level = line.toUpperCase().includes('ERROR') || line.toUpperCase().includes('FATAL')
            ? 'error'
            : line.toUpperCase().includes('WARN')
            ? 'warn'
            : line.toUpperCase().includes('DEBUG') || line.toUpperCase().includes('TRACE')
            ? 'debug'
            : 'info'

          setLogs((prev: LogEntry[]) => [
            ...prev,
            {
              id: ++logIdRef.current,
              container,
              line,
              timestamp: new Date(),
              level,
            },
          ])
        }
      },
    })

    clientRef.current = client
    client.connect()
  }, [serviceId, enabled])

  useEffect(() => {
    if (enabled) {
      connect()
    } else {
      pause()
    }

    return () => {
      pause()
    }
  }, [enabled, connect, pause])

  return {
    logs,
    isConnected,
    error,
    clearLogs,
    pause,
    resume,
  }
}