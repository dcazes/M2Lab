import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Play, Square, RotateCcw, Download, ArrowUpRight, ExternalLink, AlertTriangle, Trash2 } from 'lucide-react'
import { StatusDot } from './StatusDot'
import { getServiceUrl, getServiceIconUrl } from '../../lib/api'
import type { Service, ServiceAction } from '../../lib/types'
import { createApproval, serviceAction, serviceDestroy } from '../../lib/api'
import { toast } from 'sonner'

interface ServiceCardProps {
  service: Service
  source: 'local' | 'tailnet' | `other:${string}`
}

const ACTIONS: { action: ServiceAction; label: string; icon: React.ComponentType<{ className?: string }>; confirm?: boolean }[] = [
  { action: 'up', label: 'Start', icon: Play, confirm: true },
  { action: 'stop', label: 'Stop', icon: Square, confirm: true },
  { action: 'restart', label: 'Restart', icon: RotateCcw, confirm: true },
  { action: 'pull', label: 'Pull images', icon: Download, confirm: true },
  { action: 'update', label: 'Update', icon: ArrowUpRight, confirm: true },
]

// Actions that bring a service up: keep the light amber until its HTTP endpoint answers.
const UP_ACTIONS: ServiceAction[] = ['up', 'restart', 'update']
const AWAIT_POLL_MS = 3000
const HEALTHY_WAIT_TIMEOUT_MS = 90_000

const ACTION_DETAILS: Record<ServiceAction, { title: string; description: string; confirmLabel: string }> = {
  up: { title: 'Start {name}?', description: 'This will run docker compose up -d to start the service.', confirmLabel: 'Start' },
  stop: { title: 'Stop {name}?', description: 'This will run docker compose stop to stop the service.', confirmLabel: 'Stop' },
  restart: { title: 'Restart {name}?', description: 'This will run docker compose restart to restart the service.', confirmLabel: 'Restart' },
  pull: { title: 'Pull {name}?', description: 'This will run docker compose pull to fetch the latest images.', confirmLabel: 'Pull' },
  update: { title: 'Update {name}?', description: 'This will run docker compose pull && docker compose up -d to pull the latest images and recreate containers.', confirmLabel: 'Update' },
}

export function ServiceCard({ service }: ServiceCardProps) {
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<ServiceAction | null>(null)
  const [showDestroy, setShowDestroy] = useState(false)
  const [destroyConfirm, setDestroyConfirm] = useState('')
  const [confirmAction, setConfirmAction] = useState<ServiceAction | null>(null)
  const [awaitingHealthy, setAwaitingHealthy] = useState(false)

  // Clear the amber "coming up" light once reality is known:
  // - HTTP answers (healthy) → green
  // - no HTTP health configured but containers running → green
  // - service went down / never came up → show actual state
  useEffect(() => {
    if (!awaitingHealthy) return
    if (
      service.healthy === true ||
      (service.healthy === null && service.state === 'running') ||
      service.state === 'stopped' ||
      service.state === 'absent'
    ) {
      setAwaitingHealthy(false)
    }
  }, [awaitingHealthy, service.healthy, service.state])

  // While waiting: poll services every few seconds; bail out on timeout.
  useEffect(() => {
    if (!awaitingHealthy) return
    const poll = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
    }, AWAIT_POLL_MS)
    const timeout = setTimeout(() => setAwaitingHealthy(false), HEALTHY_WAIT_TIMEOUT_MS)
    return () => {
      clearInterval(poll)
      clearTimeout(timeout)
    }
  }, [awaitingHealthy, queryClient])

  const url = getServiceUrl(service)
  const iconUrl = getServiceIconUrl(service.id)

  const handleAction = async (action: ServiceAction) => {
    setPendingAction(action)
    try {
      const approval = await createApproval(service.id, action)
      const result = await serviceAction(service.id, action, approval)
      if (result.ok) {
        toast.success(`${service.display_name} ${action} completed`)
        if (UP_ACTIONS.includes(action)) setAwaitingHealthy(true)
      } else {
        toast.error(`${service.display_name} ${action} failed: ${result.output}`)
      }
    } catch (err) {
      toast.error(`${service.display_name} ${action} failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setPendingAction(null)
      queryClient.invalidateQueries({ queryKey: ['services'] })
    }
  }

  const handleConfirmAction = async () => {
    if (!confirmAction) return
    const action = confirmAction
    setConfirmAction(null)
    await handleAction(action)
  }

  const handleDestroy = async () => {
    if (destroyConfirm !== service.id) return
    try {
      const result = await serviceDestroy(service.id, destroyConfirm)
      if (result.ok) {
        toast.success(`${service.display_name} destroyed`)
        setShowDestroy(false)
        setDestroyConfirm('')
      } else {
        toast.error(`Destroy failed: ${result.output}`)
      }
    } catch (err) {
      toast.error(`Destroy failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const isPending = (action: ServiceAction) => pendingAction === action

  return (
    <article className="card-hover p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="relative w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-surface-2">
          <img
            src={iconUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
              e.currentTarget.nextElementSibling?.classList.remove('hidden')
            }}
          />
          <span className="hidden absolute inset-0 flex items-center justify-center text-2xl">{service.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{service.display_name}</h3>
          <p className="text-sm text-unknown truncate">{service.description}</p>
        </div>
        <StatusDot state={service.state} healthy={service.healthy} size="lg" pending={pendingAction !== null || awaitingHealthy} />
      </div>

      <div className="flex items-center gap-2 text-xs text-unknown">
        <span className="font-mono-tabular">{service.containers.length} container{service.containers.length !== 1 ? 's' : ''}</span>
        {service.healthy !== null && (
          <>
            <span className="px-1.5 py-0.5 rounded-btn bg-surface-2">
              {service.healthy ? '✓ HTTP' : '✗ HTTP'}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-border">
        {service.launch_available ? <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-unknown bg-surface-2 rounded-btn hover:bg-surface-1 hover:text-white transition-fast"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open
        </a> : <button disabled title={service.launch_reason || 'This app cannot be opened yet'} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-unknown bg-surface-2 rounded-btn opacity-50 cursor-not-allowed"><ExternalLink className="h-3.5 w-3.5" />Unavailable</button>}
        <div className="flex items-center gap-1">
          {ACTIONS.map(({ action, label, icon: Icon, confirm }) => (
            <button
              key={action}
              onClick={() => confirm ? setConfirmAction(action) : handleAction(action)}
              disabled={isPending(action) || pendingAction !== null}
              className={`p-2 rounded-btn transition-fast ${
                isPending(action)
                  ? 'bg-accent/20 text-accent cursor-wait'
                  : 'text-unknown hover:text-white hover:bg-surface-2'
              }`}
              title={label}
              aria-label={label}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          <button
            onClick={() => setShowDestroy(true)}
            disabled={pendingAction !== null}
            className="p-2 rounded-btn text-unknown hover:text-err hover:bg-surface-2 transition-fast disabled:opacity-50 disabled:cursor-not-allowed"
            title="Destroy"
            aria-label="Destroy"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6 space-y-4 animate-in zoom-in-95 fade-in duration-200">
            <h4 className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warn" />
              {ACTION_DETAILS[confirmAction].title.replace('{name}', service.display_name)}
            </h4>
            <p className="text-sm text-unknown">
              {ACTION_DETAILS[confirmAction].description}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-sm font-medium text-unknown bg-surface-2 rounded-btn hover:bg-surface-1 transition-fast"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                className="px-4 py-2 text-sm font-medium text-bg-base bg-accent rounded-btn hover:opacity-90 transition-fast"
              >
                {ACTION_DETAILS[confirmAction].confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDestroy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6 space-y-4 animate-in zoom-in-95 fade-in duration-200">
            <h4 className="text-lg font-semibold">Destroy {service.display_name}?</h4>
            <p className="text-sm text-unknown">
              This will run <code className="font-mono-tabular bg-surface-2 px-1.5 py-0.5 rounded">docker compose down</code>
              and remove all containers and networks for this service.
            </p>
            <p className="text-sm text-warn">
              Type <code className="font-mono-tabular bg-surface-2 px-1.5 py-0.5 rounded">{service.id}</code> to confirm:
            </p>
            <input
              type="text"
              value={destroyConfirm}
              onChange={(e) => setDestroyConfirm(e.target.value)}
              placeholder={service.id}
              className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-btn focus:outline-none focus:ring-2 focus:ring-accent"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowDestroy(false); setDestroyConfirm('') }}
                className="px-4 py-2 text-sm font-medium text-unknown bg-surface-2 rounded-btn hover:bg-surface-1 transition-fast"
              >
                Cancel
              </button>
              <button
                onClick={handleDestroy}
                disabled={destroyConfirm !== service.id}
                className="px-4 py-2 text-sm font-medium text-bg-base bg-err rounded-btn hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-fast"
              >
                Destroy
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}
